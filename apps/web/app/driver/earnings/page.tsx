import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, money } from "@/lib/utils";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";
import { FleetMembership } from "@/components/driver/fleet-membership";

export const metadata = { title: "Earnings" };

export default async function EarningsPage() {
  const user = await requireUser("/driver/earnings");
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: earnings }, { data: settlements }, { data: cash }, { data: driver }] = await Promise.all([
    supabase.from("driver_earnings").select("id, booking_id, currency, gross_minor, commission_minor, net_minor, payment_method, settlement_id, created_at, bookings(code)")
      .eq("driver_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("driver_settlements").select("id, currency, period_start, period_end, net_payable_minor, status, paid_at, payout_reference")
      .eq("driver_id", user.id).order("period_end", { ascending: false }).limit(20),
    supabase.from("cash_reconciliation").select("currency, expected_minor, collected_minor, status").eq("driver_id", user.id).is("settlement_id", null),
    supabase.from("drivers").select("fleet_id, fleets!drivers_fleet_id_fkey(name)").eq("id", user.id).maybeSingle(),
  ]);

  const week = (earnings ?? []).filter((e) => e.created_at >= weekAgo);
  const totals = (rows: typeof week, key: "net_minor" | "commission_minor") =>
    rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.currency]: (acc[r.currency] ?? 0) + Number(r[key]) }), {});
  const weekNet = totals(week, "net_minor");
  const owedCommission = (earnings ?? []).filter((e) => !e.settlement_id && e.payment_method === "cash")
    .reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.currency]: (acc[r.currency] ?? 0) + Number(r.commission_minor) }), {});
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(v, c)).join(" · ") || money(0, "USD");

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-xl font-bold">Earnings</h1>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Last 7 days" value={fmt(weekNet)} hint={`${week.length} trips`} />
        <Stat label="Commission owed (cash)" value={fmt(owedCommission)} hint="Settled with operations" />
      </div>
      {(cash ?? []).some((c) => c.status === "variance") && (
        <Card className="border-amber-300 text-sm">Some cash trips don&apos;t match the fare. Operations will contact you to reconcile.</Card>
      )}

      <section>
        <h2 className="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">Trips</h2>
        {!earnings?.length ? <EmptyState title="No completed trips yet" /> : (
          <ul className="surface divide-y divide-[var(--line)] rounded-xl border border-line">
            {earnings.map((e) => (
              <li key={e.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium">{(e.bookings as unknown as { code: string } | null)?.code}</p>
                  <p className="text-muted text-xs">{formatDateTime(e.created_at)} · {e.payment_method.replace("_", " ")}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(e.net_minor, e.currency)}</p>
                  <p className="text-muted text-xs">fare {money(e.gross_minor, e.currency)} − {money(e.commission_minor, e.currency)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">Settlements</h2>
        {!settlements?.length ? <EmptyState title="No settlements yet" /> : (
          <ul className="space-y-2">
            {settlements.map((s) => (
              <li key={s.id}><Card className="flex items-center justify-between p-3 text-sm">
                <span>{formatDateTime(s.period_start)} – {formatDateTime(s.period_end)}</span>
                <span className="text-right">
                  <span className="block font-semibold">{Number(s.net_payable_minor) >= 0 ? "You receive " : "You owe "}{money(Math.abs(Number(s.net_payable_minor)), s.currency)}</span>
                  <Badge tone={s.status === "paid" ? "ok" : "warn"}>{s.status}</Badge>
                </span>
              </Card></li>
            ))}
          </ul>
        )}
      </section>

      {driver && <FleetMembership fleetName={(driver.fleets as unknown as { name: string } | null)?.name ?? null} />}
    </main>
  );
}
