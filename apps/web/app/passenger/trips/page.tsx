import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { STATUS_LABELS, type BookingStatus } from "@liberia-ride/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, money } from "@/lib/utils";
import { Badge, EmptyState } from "@/components/ui";

export const metadata = { title: "Your trips" };

export default async function TripsPage() {
  const user = await requireUser("/passenger/trips");
  const supabase = await createClient();
  const { data: upcoming } = await supabase.rpc("my_scheduled_rides");
  const { data: trips } = await supabase
    .from("bookings")
    .select("id, code, status, pickup_address, dropoff_address, currency, estimated_fare_minor, final_fare_minor, created_at")
    .eq("passenger_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="text-xl font-bold">Your trips</h1>
      {(upcoming ?? []).length > 0 && (
        <section className="mt-4">
          <h2 className="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">Upcoming</h2>
          <ul className="space-y-2">
            {(upcoming as { id: string; code: string; scheduled_for: string; dropoff_address: string; pickup_address: string; currency: string; estimated_fare_minor: number; category: string }[]).map((u) => (
              <li key={u.id}>
                <Link href={`/passenger/trip/${u.id}`} className="surface flex items-center gap-3 rounded-xl border border-brand-200 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{formatDateTime(u.scheduled_for)}</p>
                    <p className="truncate text-sm">{u.dropoff_address}</p>
                    <p className="text-muted truncate text-xs">from {u.pickup_address} · {u.category}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{money(u.estimated_fare_minor, u.currency)}</p>
                  <ChevronRight className="text-muted h-4 w-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!trips?.length ? (
        <div className="mt-6"><EmptyState title="No trips yet">Your completed and cancelled rides will appear here.</EmptyState></div>
      ) : (
        <ul className="mt-4 space-y-2">
          {trips.map((t) => (
            <li key={t.id}>
              <Link href={`/passenger/trip/${t.id}`} className="surface flex items-center gap-3 rounded-xl border border-line p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.dropoff_address}</p>
                  <p className="text-muted truncate text-xs">from {t.pickup_address}</p>
                  <p className="text-muted mt-1 text-xs">{formatDateTime(t.created_at)} · {t.code}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{money(t.final_fare_minor ?? t.estimated_fare_minor, t.currency)}</p>
                  <Badge tone={t.status === "COMPLETED" ? "ok" : t.status === "CANCELLED" || t.status === "EXPIRED" ? "neutral" : "brand"}>
                    {STATUS_LABELS[t.status as BookingStatus]}
                  </Badge>
                </div>
                <ChevronRight className="text-muted h-4 w-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
