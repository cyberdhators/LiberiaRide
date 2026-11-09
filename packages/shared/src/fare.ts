// Mirror of public.compute_fare (supabase/migrations/…_booking_engine.sql).
// The database computes every price that is charged; this copy exists for previews
// (e.g. admin "what would this rule charge?") and is unit-tested for parity.
import { divRoundHalfUp, roundToIncrement, type Currency } from "./money";

export interface FareRule {
  currency: Currency;
  baseFareMinor: bigint;
  perKmMinor: bigint;
  perMinuteMinor: bigint;
  minimumFareMinor: bigint;
  bookingFeeMinor: bigint;
  perStopMinor: bigint;
  waitingFreeMinutes: number;
  waitingPerMinuteMinor: bigint;
  roundingIncrementMinor: bigint;
  /** Commission in basis points (1500 = 15%). */
  commissionBps: number;
}

export interface FareInput {
  distanceM: number;
  durationS: number;
  extraStops?: number;
  waitingS?: number;
  discountMinor?: bigint;
}

export interface FareBreakdown {
  currency: Currency;
  baseMinor: bigint;
  distanceMinor: bigint;
  timeMinor: bigint;
  stopsMinor: bigint;
  waitingMinor: bigint;
  bookingFeeMinor: bigint;
  minimumAdjustmentMinor: bigint;
  roundingMinor: bigint;
  grossMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
  commissionMinor: bigint;
  driverNetMinor: bigint;
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

function nonNegInt(n: number | undefined, name: string): bigint {
  const v = n ?? 0;
  if (!Number.isFinite(v)) throw new RangeError(`${name} must be finite`);
  return BigInt(Math.max(0, Math.trunc(v)));
}

export function computeFare(rule: FareRule, input: FareInput): FareBreakdown {
  const distanceM = nonNegInt(input.distanceM, "distanceM");
  const durationS = nonNegInt(input.durationS, "durationS");
  const stops = nonNegInt(input.extraStops, "extraStops");
  const waitingS = nonNegInt(input.waitingS, "waitingS");

  const distanceMinor = divRoundHalfUp(rule.perKmMinor * distanceM, 1000n);
  const timeMinor = divRoundHalfUp(rule.perMinuteMinor * durationS, 60n);
  const stopsMinor = rule.perStopMinor * stops;

  // Billable waiting minutes = ceil((waiting − free) / 60), floored at 0.
  const chargeableWaitS = max(0n, waitingS - BigInt(rule.waitingFreeMinutes) * 60n);
  const waitMinutes = chargeableWaitS === 0n ? 0n : (chargeableWaitS + 59n) / 60n;
  const waitingMinor = rule.waitingPerMinuteMinor * waitMinutes;

  const raw = rule.baseFareMinor + distanceMinor + timeMinor + stopsMinor + waitingMinor + rule.bookingFeeMinor;
  const minimumAdjustmentMinor = max(0n, rule.minimumFareMinor - raw);
  const preRound = raw + minimumAdjustmentMinor;
  const grossMinor = roundToIncrement(preRound, rule.roundingIncrementMinor);
  const discountMinor = min(max(input.discountMinor ?? 0n, 0n), grossMinor);
  const totalMinor = grossMinor - discountMinor;
  // Commission on gross: promotions are platform-funded.
  const commissionMinor = divRoundHalfUp(grossMinor * BigInt(rule.commissionBps), 10000n);

  return {
    currency: rule.currency,
    baseMinor: rule.baseFareMinor,
    distanceMinor,
    timeMinor,
    stopsMinor,
    waitingMinor,
    bookingFeeMinor: rule.bookingFeeMinor,
    minimumAdjustmentMinor,
    roundingMinor: grossMinor - preRound,
    grossMinor,
    discountMinor,
    totalMinor,
    commissionMinor,
    driverNetMinor: grossMinor - commissionMinor,
  };
}

/** Allowed passenger-offer / driver-counter window for bidding (mirrors SQL). */
export function bidWindow(estimateMinor: bigint, minPct: number, maxPct: number): { min: bigint; max: bigint } {
  return {
    min: divRoundHalfUp(estimateMinor * BigInt(minPct), 100n),
    max: divRoundHalfUp(estimateMinor * BigInt(maxPct), 100n),
  };
}

/** Convert a fare_rules row (snake_case, numeric strings from PostgREST) into a FareRule. */
export function fareRuleFromRow(row: Record<string, unknown>): FareRule {
  const b = (k: string) => BigInt(String(row[k] ?? 0));
  return {
    currency: row.currency as Currency,
    baseFareMinor: b("base_fare_minor"),
    perKmMinor: b("per_km_minor"),
    perMinuteMinor: b("per_minute_minor"),
    minimumFareMinor: b("minimum_fare_minor"),
    bookingFeeMinor: b("booking_fee_minor"),
    perStopMinor: b("per_stop_minor"),
    waitingFreeMinutes: Number(row.waiting_free_minutes ?? 0),
    waitingPerMinuteMinor: b("waiting_per_minute_minor"),
    roundingIncrementMinor: b("rounding_increment_minor"),
    commissionBps: Number(row.commission_bps ?? 0),
  };
}
