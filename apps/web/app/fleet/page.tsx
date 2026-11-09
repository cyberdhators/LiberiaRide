import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money, timeAgo } from "@/lib/utils";
import { Alert, Badge, Card, CardTitle, EmptyState, Stat } from "@/components/ui";
import { RpcAction } from "@/components/admin/rpc-action";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Fleet" };
export const dynamic = "force-dynamic";

interface FleetDriver {
  driver_id: string; name: string | null; phone: string | null; status: string; online: boolean;
  completed_trips: number; rating: number | null; received_at: string | null; plate: string | null;
  trips_7d: number; net_7d: Record<string, string>;
}
interface Fleet { id: string; name: string; join_code: string; is_active: boolean; drivers: FleetDriver[] }

const sumNet = (drivers: FleetDriver[]) =>
  drivers.reduce<Record<string, bigint>>((acc, d) => {
    for (const [c, v] of Object.entries(d.net_7d)) acc[c] = (acc[c] ?? 0n) + BigInt(v);
    return acc;
  }, {});
const fmt = (m: Record<string, bigint | string>) => Object.entries(m).map(([c, v]) => money(v, c)).join(" · ") || money(0, "USD");

export default async function FleetPage() {
  const user = await requireUser("/fleet");
  if (!user.roles.includes("fleet_operator")) redirect("/forbidden");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fleet_overview");
  const fleets = (data ?? []) as Fleet[];

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center gap-2">
        <Link href="/" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--surface-muted)]" aria-label="Home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold">Fleet</h1>
      </div>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {fleets.length === 0 && !error && (
        <EmptyState title="No fleet yet">LiberiaRide operations will set up your fleet and send you a join code.</EmptyState>
      )}

      {fleets.map((f) => {
        const online = f.drivers.filter((d) => d.online).length;
        return (
          <section key={f.id} className="space-y-3" aria-labelledby={`fleet-${f.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`fleet-${f.id}`} className="text-lg font-semibold">{f.name}</h2>
              {!f.is_active && <Badge tone="danger">inactive — new drivers cannot join</Badge>}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Stat label="Drivers" value={f.drivers.length} />
              <Stat label="Online now" value={online} />
              <Stat label="Net, 7 days" value={fmt(sumNet(f.drivers))} hint={`${f.drivers.reduce((n, d) => n + d.trips_7d, 0)} trips`} />
            </div>

            <Card>
              <CardTitle>Join code</CardTitle>
              <p className="text-muted mt-1 text-sm">Drivers enter this in the driver app under Earnings → Fleet. Change it if it was shared too widely.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-lg font-bold tracking-widest">{f.join_code}</code>
                <CopyButton text={f.join_code} label="Copy" />
                <RpcAction fn="fleet_regenerate_code" args={{ p_fleet_id: f.id }} label="New code"
                  confirm="Create a new join code? The old code stops working; drivers already in the fleet stay." />
              </div>
            </Card>

            {f.drivers.length === 0 ? (
              <p className="text-muted text-sm">No drivers yet. Share the join code with your drivers.</p>
            ) : (
              <ul className="surface divide-y divide-[var(--line)] rounded-xl border border-line">
                {f.drivers.map((d) => (
                  <li key={d.driver_id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {d.name ?? "Driver"}{" "}
                        {d.online ? <Badge tone="ok">online</Badge> : <Badge>offline</Badge>}{" "}
                        {d.status !== "approved" && <Badge tone="warn">{d.status}</Badge>}
                      </p>
                      <p className="text-muted text-xs">
                        {[d.phone, d.plate, d.rating ? `★ ${d.rating}` : null, `${d.completed_trips} trips`, `seen ${timeAgo(d.received_at)}`]
                          .filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 text-xs">Last 7 days: <strong>{fmt(d.net_7d)}</strong> from {d.trips_7d} trips</p>
                    </div>
                    <RpcAction fn="fleet_remove_driver" args={{ p_driver_id: d.driver_id }} label="Remove" variant="danger"
                      confirm={`Remove ${d.name ?? "this driver"} from ${f.name}? They will be notified.`} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </main>
  );
}
