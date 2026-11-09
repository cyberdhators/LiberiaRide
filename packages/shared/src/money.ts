// Money is integer minor units (cents) everywhere. Never use floats for amounts.

export const CURRENCIES = ["USD", "LRD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

export function money(minor: bigint | number, currency: Currency): Money {
  const value = typeof minor === "number" ? toBigIntStrict(minor) : minor;
  return { minor: value, currency };
}

function toBigIntStrict(n: number): bigint {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`minor-unit amount must be a safe integer, got ${n}`);
  }
  return BigInt(n);
}

/**
 * Integer division rounding half away from zero — matches Postgres round(numeric)
 * for the non-negative values the fare engine produces.
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return negative ? -q : q;
}

/** Mirror of public.round_minor(amount, increment). */
export function roundToIncrement(amount: bigint, increment: bigint): bigint {
  if (increment <= 1n) return amount;
  return divRoundHalfUp(amount, increment) * increment;
}

/** Parse a user-typed major amount ("12.50", "1,250") into minor units without floats. */
export function parseMajor(input: string, currency: Currency): Money {
  const cleaned = input.replace(/[,\s]/g, "").replace(/^(US)?\$|^L\$/i, "");
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new Error(`invalid amount: ${input}`);
  const whole = BigInt(match[1] ?? "0");
  const frac = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return { minor: whole * 100n + frac, currency };
}

const SYMBOL: Record<Currency, string> = { USD: "US$", LRD: "L$" };

/** "US$12.50", "L$2,400" (LRD shown without cents when whole). */
export function formatMoney(m: Money | { minor: bigint | number | string; currency: Currency }): string {
  const minor = BigInt(m.minor);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const showCents = m.currency === "USD" || cents !== 0n;
  const body = showCents ? `${wholeStr}.${cents.toString().padStart(2, "0")}` : wholeStr;
  return `${negative ? "-" : ""}${SYMBOL[m.currency]}${body}`;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error("currency mismatch");
  return { minor: a.minor + b.minor, currency: a.currency };
}
