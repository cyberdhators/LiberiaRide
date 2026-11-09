// Mirror of public.booking_transition_allowed (supabase/migrations/…_booking_engine.sql).
// The database is authoritative; this copy drives UI affordances and is parity-tested.

export const BOOKING_STATUSES = [
  "DRAFT",
  "FARE_ESTIMATED",
  "PENDING_CONFIRMATION",
  "SEARCHING_DRIVER",
  "DRIVER_OFFERED",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  DRAFT: ["FARE_ESTIMATED", "CANCELLED"],
  FARE_ESTIMATED: ["PENDING_CONFIRMATION", "CANCELLED", "EXPIRED"],
  PENDING_CONFIRMATION: ["SEARCHING_DRIVER", "CANCELLED", "EXPIRED"],
  SEARCHING_DRIVER: ["DRIVER_OFFERED", "DRIVER_ASSIGNED", "CANCELLED", "EXPIRED", "FAILED"],
  DRIVER_OFFERED: ["DRIVER_ASSIGNED", "SEARCHING_DRIVER", "CANCELLED", "EXPIRED", "FAILED"],
  DRIVER_ASSIGNED: ["DRIVER_ARRIVING", "DRIVER_ARRIVED", "SEARCHING_DRIVER", "CANCELLED", "FAILED"],
  DRIVER_ARRIVING: ["DRIVER_ARRIVED", "SEARCHING_DRIVER", "CANCELLED", "FAILED"],
  DRIVER_ARRIVED: ["IN_PROGRESS", "SEARCHING_DRIVER", "CANCELLED", "FAILED"],
  IN_PROGRESS: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
};

export const TERMINAL_STATUSES: readonly BookingStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"];

/** Statuses in which a driver is attached and the ride is live. */
export const ACTIVE_RIDE_STATUSES: readonly BookingStatus[] = [
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
];

/** Statuses in which the passenger is waiting for a driver. */
export const SEARCHING_STATUSES: readonly BookingStatus[] = ["SEARCHING_DRIVER", "DRIVER_OFFERED"];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isActiveRide(status: BookingStatus): boolean {
  return ACTIVE_RIDE_STATUSES.includes(status);
}

/** Can the passenger cancel from the app in this status? (IN_PROGRESS requires SOS / completion.) */
export function passengerCanCancel(status: BookingStatus): boolean {
  return canTransition(status, "CANCELLED") && status !== "DRAFT";
}

export const STATUS_LABELS: Readonly<Record<BookingStatus, string>> = {
  DRAFT: "Draft",
  FARE_ESTIMATED: "Fare ready",
  PENDING_CONFIRMATION: "Confirm your ride",
  SEARCHING_DRIVER: "Finding a driver",
  DRIVER_OFFERED: "Contacting a driver",
  DRIVER_ASSIGNED: "Driver assigned",
  DRIVER_ARRIVING: "Driver on the way",
  DRIVER_ARRIVED: "Driver has arrived",
  IN_PROGRESS: "On trip",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "No driver found",
  FAILED: "Trip ended",
};

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (BOOKING_STATUSES as readonly string[]).includes(value);
}
