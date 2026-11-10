// Map Postgres/PostgREST errors from our RPCs to messages safe to show users.
// RPCs raise with explicit SQLSTATEs (see migrations): 22023 validation, 42501 permission,
// P0002 not found, 55000 state conflict, 23514 invalid transition, 28000 auth required.

export interface RpcErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

const KNOWN_SAFE_PREFIXES = [
  "pickup is outside the service area",
  "pickup and destination are too close",
  "fare estimate expired",
  "offer expired",
  "offer is no longer available",
  "booking is no longer available",
  "bid is no longer available",
  "counter-offer outside allowed range",
  "offer outside allowed range",
  "driver account is",
  "no approved vehicle selected",
  "documents missing or expired",
  "share your live location before going online",
  "you are ",
  "a ride in progress cannot be cancelled",
  "driver licence has expired",
  "drivers must be at least 18",
  "register as a driver first",
  "too many stops",
  "a reason is required",
  "rating window has closed",
  "coupon_",
  "account suspended",
  "driver is busy with another ride",
  "driver is not eligible",
  "nothing to settle",
  "cannot cancel in status",
  "your location is out of date",
  "you must be at the pickup point",
  "too many wrong pin attempts",
  "mark yourself arrived",
];

const COUPON_MESSAGES: Record<string, string> = {
  coupon_not_found: "That promo code is not valid.",
  coupon_inactive: "That promo code has expired.",
  coupon_category_mismatch: "That promo code does not apply to this vehicle type.",
  coupon_min_fare: "This trip is below the promo code's minimum fare.",
  coupon_currency_mismatch: "That promo code is for a different currency.",
  coupon_already_used: "You have already used this promo code.",
  coupon_exhausted: "That promo code has been fully redeemed.",
};

export function userMessage(err: RpcErrorLike | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;
  const msg = (err.message ?? "").trim();
  if (COUPON_MESSAGES[msg]) return COUPON_MESSAGES[msg]!;
  if (err.code === "28000") return "Please sign in again.";
  if (err.code === "42501" && msg.startsWith("permission denied")) return "You do not have permission to do that.";
  if (err.code === "23505") return "That already exists.";
  const safe = KNOWN_SAFE_PREFIXES.some((p) => msg.toLowerCase().startsWith(p));
  if (safe) return msg.charAt(0).toUpperCase() + msg.slice(1) + (msg.endsWith(".") ? "" : ".");
  if (err.code === "P0002") return "Not found. It may have been cancelled or reassigned.";
  return fallback;
}
