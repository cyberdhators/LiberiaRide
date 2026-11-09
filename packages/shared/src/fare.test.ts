import { describe, expect, it } from "vitest";
import { bidWindow, computeFare, type FareRule } from "./fare";
import { divRoundHalfUp, formatMoney, parseMajor, roundToIncrement } from "./money";

// Mirrors the seeded USD "car" rule in …_reference_data.sql.
const carUsd: FareRule = {
  currency: "USD",
  baseFareMinor: 100n,
  perKmMinor: 50n,
  perMinuteMinor: 5n,
  minimumFareMinor: 250n,
  bookingFeeMinor: 0n,
  perStopMinor: 50n,
  waitingFreeMinutes: 3,
  waitingPerMinuteMinor: 5n,
  roundingIncrementMinor: 25n,
  commissionBps: 1500,
};

describe("money helpers", () => {
  it("rounds half up like Postgres round()", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divRoundHalfUp(5n, 3n)).toBe(2n);
    expect(divRoundHalfUp(0n, 7n)).toBe(0n);
  });

  it("rounds to increments like public.round_minor", () => {
    expect(roundToIncrement(1234n, 25n)).toBe(1225n);
    expect(roundToIncrement(1238n, 25n)).toBe(1250n);
    expect(roundToIncrement(1237n, 25n)).toBe(1225n);
    expect(roundToIncrement(1237n, 1n)).toBe(1237n);
  });

  it("parses and formats amounts without floats", () => {
    expect(parseMajor("12.5", "USD").minor).toBe(1250n);
    expect(parseMajor("1,250", "LRD").minor).toBe(125000n);
    expect(() => parseMajor("1.234", "USD")).toThrow();
    expect(formatMoney({ minor: 1250n, currency: "USD" })).toBe("US$12.50");
    expect(formatMoney({ minor: 240000n, currency: "LRD" })).toBe("L$2,400");
    expect(formatMoney({ minor: 240050n, currency: "LRD" })).toBe("L$2,400.50");
  });
});

describe("computeFare", () => {
  it("prices a 6.2 km / 18 min trip", () => {
    const f = computeFare(carUsd, { distanceM: 6200, durationS: 18 * 60 });
    expect(f.distanceMinor).toBe(310n);
    expect(f.timeMinor).toBe(90n);
    expect(f.grossMinor).toBe(500n);
    expect(f.totalMinor).toBe(500n);
    expect(f.commissionMinor).toBe(75n);
    expect(f.driverNetMinor).toBe(425n);
    expect(f.minimumAdjustmentMinor).toBe(0n);
  });

  it("applies the minimum fare", () => {
    const f = computeFare(carUsd, { distanceM: 800, durationS: 120 });
    expect(f.minimumAdjustmentMinor).toBe(100n);
    expect(f.grossMinor).toBe(250n);
  });

  it("rounds to the configured increment and reports the rounding", () => {
    const f = computeFare(carUsd, { distanceM: 6333, durationS: 1000 });
    const raw = 100n + 317n + 83n;
    expect(f.grossMinor % 25n).toBe(0n);
    expect(f.roundingMinor).toBe(f.grossMinor - raw);
  });

  it("charges waiting only beyond the free minutes, per started minute", () => {
    expect(computeFare(carUsd, { distanceM: 6200, durationS: 1080, waitingS: 180 }).waitingMinor).toBe(0n);
    expect(computeFare(carUsd, { distanceM: 6200, durationS: 1080, waitingS: 181 }).waitingMinor).toBe(5n);
    expect(computeFare(carUsd, { distanceM: 6200, durationS: 1080, waitingS: 480 }).waitingMinor).toBe(25n);
  });

  it("adds per-stop charges", () => {
    expect(computeFare(carUsd, { distanceM: 6200, durationS: 1080, extraStops: 2 }).stopsMinor).toBe(100n);
  });

  it("caps discounts at the fare and keeps commission on the gross", () => {
    const f = computeFare(carUsd, { distanceM: 6200, durationS: 1080, discountMinor: 10_000n });
    expect(f.discountMinor).toBe(f.grossMinor);
    expect(f.totalMinor).toBe(0n);
    expect(f.commissionMinor).toBe(75n);
    expect(f.driverNetMinor).toBe(425n);
  });

  it("treats negative or fractional inputs safely", () => {
    const f = computeFare(carUsd, { distanceM: -5, durationS: 59.9, discountMinor: -100n });
    expect(f.distanceMinor).toBe(0n);
    expect(f.discountMinor).toBe(0n);
    expect(f.grossMinor).toBe(250n);
  });

  it("works for LRD with 10-LRD rounding", () => {
    const carLrd: FareRule = {
      ...carUsd, currency: "LRD", baseFareMinor: 19000n, perKmMinor: 9500n,
      perMinuteMinor: 1000n, minimumFareMinor: 48000n, roundingIncrementMinor: 1000n,
    };
    const f = computeFare(carLrd, { distanceM: 6200, durationS: 1080 });
    expect(f.grossMinor % 1000n).toBe(0n);
    expect(f.currency).toBe("LRD");
  });
});

describe("bidWindow", () => {
  it("computes the allowed bid range", () => {
    expect(bidWindow(500n, 80, 150)).toEqual({ min: 400n, max: 750n });
  });
});
