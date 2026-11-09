import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, money } from "@/lib/utils";
import { Alert, Badge, Card, CardTitle, EmptyState, Stat } from "@/components/ui";
import { PageHeader } from "@/components/admin/table";
import { OpsFeed } from "@/components/admin/ops-feed";

export const metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

type Stats = Record<string, number> & { revenue: Record<string, number>; commissions: Record<string, number> };

export default async function AdminHome() {
  const supabase = await createClient();
  const [{ data: s }, { data: sos }, { data: pending }] = await Promise.all([
    supabase.rpc("admin_dashboard_stats"),
    supabase.from("safety_incidents").select("id, kind, severity, status, booking_id, reporter_role, created_at")
      .in("status", ["open", "acknowledged"]).order("created_at", { ascending: false }).limit(5),
    supabase.from("drivers").select("id, licence_number, created_at, profiles!drivers_id_fkey(full_name, phone)").eq("status", "pending").order("created_at").limit(8),
  ]);
  const stats = (s ?? {}) as Stats;
  const fmt = (m: Record<string, number> | undefined) => Object.entries(m ?? {}).map(([c, v]) => money(v, c)).join(" · ") || "—";

  return (
    <>
      <PageHeader title="Operations overview" />
      {(stats.open_sos ?? 0) > 0 && (
        <Alert tone="danger" className="mb-4" title={`${stats.open_sos} open SOS alert${stats.open_sos === 1 ? "" : "s"}`}>
          <Link href="/admin/safety" className="underline">Open safety console</Link>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active rides" value={stats.rides_active ?? 0} />
        <Stat label="Drivers online" value={stats.drivers_online ?? 0} hint={`${stats.drivers_verified ?? 0} verified · ${stats.drivers_registered ?? 0} registered`} />
        <Stat label="Completed today" value={stats.rides_completed_today ?? 0} hint={`${stats.rides_completed ?? 0} all time`} />
        <Stat label="Passengers" value={stats.passengers ?? 0} />
        <Stat label="Revenue (all time)" value={<span className="text-lg">{fmt(stats.revenue)}</span>} />
        <Stat label="Commissions" value={<span className="text-lg">{fmt(stats.commissions)}</span>} />
        <Stat label="Cancelled / expired" value={`${stats.rides_cancelled ?? 0} / ${stats.rides_expired ?? 0}`} />
        <Stat label="QLS calls (24 h)" value={stats.qls_calls_24h ?? 0} hint="≈ US$0.10 each" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Live operations feed</CardTitle>
          <OpsFeed />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardTitle>Drivers awaiting review ({stats.drivers_pending ?? 0})</CardTitle>
            {!pending?.length ? <p className="text-muted mt-2 text-sm">None.</p> : (
              <ul className="mt-2 divide-y divide-[var(--line)] text-sm">
                {pending.map((d) => {
                  const p = d.profiles as unknown as { full_name: string | null; phone: string | null } | null;
                  return (
                    <li key={d.id} className="py-2">
                      <Link className="font-medium underline" href={`/admin/drivers/${d.id}`}>{p?.full_name ?? d.licence_number}</Link>
                      <span className="text-muted block text-xs">{formatDateTime(d.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Open safety cases</CardTitle>
            {!sos?.length ? <div className="mt-2"><EmptyState title="All clear" /></div> : (
              <ul className="mt-2 space-y-2 text-sm">
                {sos.map((i) => (
                  <li key={i.id} className="flex items-center justify-between">
                    <span><Badge tone={i.kind === "sos" ? "danger" : "warn"}>{i.kind}</Badge> <span className="text-muted text-xs">{formatDateTime(i.created_at)}</span></span>
                    <Link className="text-xs underline" href="/admin/safety">Handle</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
