import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  canTransition,
  isTerminal,
  passengerCanCancel,
  type BookingStatus,
} from "./booking-state";

const migrationsDir = join(__dirname, "../../../supabase/migrations");

function sqlTransitionTable(): Record<string, string[]> {
  const file = readdirSync(migrationsDir).find((f) => f.endsWith("_booking_engine.sql"));
  if (!file) throw new Error("booking engine migration not found");
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const fn = sql.slice(sql.indexOf("function public.booking_transition_allowed"));
  const body = fn.slice(0, fn.indexOf("$$;"));
  const table: Record<string, string[]> = {};
  for (const m of body.matchAll(/when '([A-Z_]+)'\s+then p_to in \(([^)]*)\)/g)) {
    table[m[1]!] = [...m[2]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!);
  }
  return table;
}

describe("booking state machine", () => {
  it("matches the SQL state machine exactly (parity)", () => {
    const sql = sqlTransitionTable();
    for (const status of BOOKING_STATUSES) {
      expect([...(sql[status] ?? [])].sort(), status).toEqual([...BOOKING_TRANSITIONS[status]].sort());
    }
  });

  it("enumerates the SQL enum values in order", () => {
    const file = readdirSync(migrationsDir).find((f) => f.endsWith("_extensions_and_types.sql"))!;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const enumBody = sql.slice(sql.indexOf("type public.booking_status as enum"));
    const values = [...enumBody.slice(0, enumBody.indexOf(");")).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...BOOKING_STATUSES]);
  });

  it("has no transitions out of terminal states", () => {
    for (const s of BOOKING_STATUSES.filter(isTerminal)) {
      expect(BOOKING_TRANSITIONS[s]).toHaveLength(0);
    }
  });

  it("every state can reach a terminal state", () => {
    for (const start of BOOKING_STATUSES) {
      const seen = new Set<BookingStatus>([start]);
      const queue: BookingStatus[] = [start];
      while (queue.length) {
        const s = queue.shift()!;
        for (const n of BOOKING_TRANSITIONS[s]) {
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      expect([...seen].some(isTerminal), start).toBe(true);
    }
  });

  it("accepts the happy path", () => {
    const path: BookingStatus[] = [
      "DRAFT", "FARE_ESTIMATED", "PENDING_CONFIRMATION", "SEARCHING_DRIVER", "DRIVER_OFFERED",
      "DRIVER_ASSIGNED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED",
    ];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });

  it("forbids skipping to completion or cancelling a running trip", () => {
    expect(canTransition("SEARCHING_DRIVER", "COMPLETED")).toBe(false);
    expect(canTransition("DRIVER_ASSIGNED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("IN_PROGRESS", "CANCELLED")).toBe(false);
    expect(passengerCanCancel("IN_PROGRESS")).toBe(false);
    expect(passengerCanCancel("DRIVER_ARRIVED")).toBe(true);
  });
});
