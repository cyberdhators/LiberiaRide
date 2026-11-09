import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";

export const metadata = { title: "Drivers" };
export const dynamic = "force-dynamic";

const STATUSES = ["pending", "approved", "rejected", "suspended"] as const;

export default async function DriversPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status, q } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("drivers")
    .select("id, status, is_online, licence_number, rating_avg, completed_trips, created_at, profiles!drivers_id_fkey(full_name, phone), vehicles!drivers_current_vehicle_fk(plate_number, make, model, status), driver_locations(received_at)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && (STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
  if (q) query = query.ilike("licence_number", `%${q.replace(/[%_]/g, "")}%`);
  const { data: drivers, error } = await query;

  return (
    <>
      <PageHeader title="Drivers">
        <form className="flex gap-2 text-sm">
          <select name="status" defaultValue={status ?? ""} className="surface h-9 rounded-lg border border-line px-2">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input name="q" defaultValue={q ?? ""} placeholder="Licence no." className="surface h-9 rounded-lg border border-line px-2" />
          <button className="h-9 rounded-lg bg-brand-600 px-3 font-semibold text-white">Filter</button>
        </form>
      </PageHeader>
      {error && <p className="text-signal-600 text-sm">{error.message}</p>}
      <Table head={["Driver", "Status", "Vehicle", "Online", "Last GPS", "Trips", "Rating", "Joined"]}>
        {(drivers ?? []).map((d) => {
          const p = d.profiles as unknown as { full_name: string | null; phone: string | null } | null;
          const v = d.vehicles as unknown as { plate_number: string; make: string; model: string; status: string } | null;
          const loc = d.driver_locations as unknown as { received_at: string } | null;
          return (
            <tr key={d.id}>
              <Td><Link href={`/admin/drivers/${d.id}`} className="font-medium underline">{p?.full_name ?? "—"}</Link><span className="text-muted block text-xs">{p?.phone} · {d.licence_number}</span></Td>
              <Td><Badge tone={d.status === "approved" ? "ok" : d.status === "pending" ? "warn" : "danger"}>{d.status}</Badge></Td>
              <Td>{v ? <>{v.make} {v.model} <span className="font-mono">{v.plate_number}</span> <Badge tone={v.status === "approved" ? "ok" : "warn"}>{v.status}</Badge></> : "—"}</Td>
              <Td>{d.is_online ? <Badge tone="ok">online</Badge> : <span className="text-muted">offline</span>}</Td>
              <Td className="text-muted">{loc ? timeAgo(loc.received_at) : "—"}</Td>
              <Td>{d.completed_trips}</Td>
              <Td>{d.rating_avg ?? "—"}</Td>
              <Td className="text-muted">{formatDateTime(d.created_at)}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
