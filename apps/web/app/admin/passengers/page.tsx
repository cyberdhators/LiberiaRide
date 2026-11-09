import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { RpcAction } from "@/components/admin/rpc-action";

export const metadata = { title: "Passengers" };
export const dynamic = "force-dynamic";

export default async function PassengersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("passengers")
    .select("id, rating_avg, completed_trips, created_at, profiles!inner(full_name, phone, email, is_suspended, suspended_reason)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (q) {
    const term = q.replace(/[%_,()]/g, "");
    query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`, { referencedTable: "profiles" });
  }
  const { data, error } = await query;
  const ids = (data ?? []).map((p) => p.id);
  const { data: complaints } = ids.length
    ? await supabase.from("complaints").select("against_user_id").in("against_user_id", ids)
    : { data: [] as { against_user_id: string | null }[] };
  const complaintCount = (id: string) => (complaints ?? []).filter((c) => c.against_user_id === id).length;

  return (
    <>
      <PageHeader title="Passengers">
        <form className="flex gap-2 text-sm">
          <input name="q" defaultValue={q ?? ""} placeholder="Name, phone or email" className="surface h-9 rounded-lg border border-line px-2" />
          <button className="h-9 rounded-lg bg-brand-600 px-3 font-semibold text-white">Search</button>
        </form>
      </PageHeader>
      {error && <p className="text-sm text-signal-600">{error.message}</p>}
      <Table head={["Passenger", "Trips", "Rating", "Complaints", "Joined", "Status", ""]}>
        {(data ?? []).map((row) => {
          const p = row.profiles as unknown as { full_name: string | null; phone: string | null; email: string | null; is_suspended: boolean; suspended_reason: string | null };
          return (
            <tr key={row.id}>
              <Td>{p.full_name ?? "—"}<span className="text-muted block text-xs">{p.phone ?? p.email}</span></Td>
              <Td>{row.completed_trips}</Td>
              <Td>{row.rating_avg ?? "—"}</Td>
              <Td>{complaintCount(row.id) || "—"}</Td>
              <Td className="text-muted">{formatDateTime(row.created_at)}</Td>
              <Td>{p.is_suspended ? <Badge tone="danger" title={p.suspended_reason ?? ""}>suspended</Badge> : <Badge tone="ok">active</Badge>}</Td>
              <Td>
                {p.is_suspended
                  ? <RpcAction fn="admin_set_user_suspension" args={{ p_user_id: row.id, p_suspended: false, p_reason: "reinstated" }} label="Reinstate" />
                  : <RpcAction fn="admin_set_user_suspension" args={{ p_user_id: row.id, p_suspended: true }} prompt="Reason for suspension:" promptArg="p_reason" label="Suspend" variant="danger" />}
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
