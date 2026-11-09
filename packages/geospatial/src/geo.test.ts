import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, haversineMeters, isFresh, toEwkt } from "./geo";
import { pinnedLabel, ReverseGeocodingAdapter } from "./adapters/reverse";

describe("geo helpers", () => {
  it("measures Monrovia distances sensibly", () => {
    // Executive Mansion → ELWA Junction ≈ 11.5 km straight line
    const d = haversineMeters({ lat: 6.3002, lng: -10.7983 }, { lat: 6.2394, lng: -10.7066 });
    expect(d).toBeGreaterThan(11_000);
    expect(d).toBeLessThan(12_500);
  });

  it("formats distance and duration", () => {
    expect(formatDistance(420)).toBe("420 m");
    expect(formatDistance(6234)).toBe("6.2 km");
    expect(formatDuration(30)).toBe("1 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
  });

  it("detects stale positions", () => {
    const now = Date.parse("2026-11-09T10:00:00Z");
    expect(isFresh("2026-11-09T09:59:30Z", 45, now)).toBe(true);
    expect(isFresh("2026-11-09T09:59:00Z", 45, now)).toBe(false);
    expect(isFresh(null, 45, now)).toBe(false);
  });

  it("writes EWKT lng-first", () => {
    expect(toEwkt({ lat: 6.3, lng: -10.8 })).toBe("SRID=4326;POINT(-10.8 6.3)");
  });
});

describe("ReverseGeocodingAdapter (QLS gap)", () => {
  const p = { lat: 6.3, lng: -10.8 };
  it("prefers verified aliases, then cache, then a neutral pin label", async () => {
    const withAlias = new ReverseGeocodingAdapter({
      nearestAlias: async () => ({ label: "Red Light Market", qlsRef: null, point: p }),
      nearestCached: async () => null,
    });
    expect((await withAlias.reverse(p)).label).toBe("Near Red Light Market");

    const none = new ReverseGeocodingAdapter({ nearestAlias: async () => null, nearestCached: async () => null });
    expect((await none.reverse(p)).label).toBe(pinnedLabel(p));
  });
});
