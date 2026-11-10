/**
 * Where tapping a notification (in-app or push) goes. Server-defined kinds;
 * unknown kinds have no link. Shared by the notification list and /api/push/latest.
 */
export function notificationHref(n: { kind: string; data: Record<string, unknown> | null }): string | null {
  const bookingId = typeof n.data?.booking_id === "string" ? n.data.booking_id : null;
  if (n.kind === "offer") return "/driver";
  if (n.kind === "driver.fleet_removed") return "/driver/earnings";
  if (n.kind === "booking.assigned" || n.kind.startsWith("driver.")) return "/driver";
  if (n.kind.startsWith("fleet.")) return "/fleet";
  if (bookingId) return `/passenger/trip/${bookingId}`;
  return null;
}
