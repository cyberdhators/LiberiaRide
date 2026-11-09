import { createClient } from "@/lib/supabase/server";
import { getSessionUser, hasAnyRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { Alert, Badge } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { RpcAction } from "@/components/admin/rpc-action";

export const metadata = { title: "Fleets" };
export const dynamic = "force-dynamic";

type Profile = { id: string; full_name: string | null; phone: string | null; email: string | null; is_suspended: boolean };

export default async function FleetsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = (await getSessionUser())!;
  const canManage = hasAnyRole(me, ["admin", "super_admin"]);
  const { q } = await searchParams;
  const supabase = await createClient();

  const { data: fleets, error } = await supabase.from("fleets")
    .select("id, name, owner_id, phone, is_active, join_code, created_at").order("created_at", { ascending: false });
  const fleetIds = (fleets ?? []).map((f) => f.id);
  const ownerIds = [...new Set((fleets ?? []).map((f) => f.owner_id))];

  let results: Profile[] = [];
  if (canManage && q?.trim()) {
    const term = q.replace(/[%_,()]/g, "").trim();
    const { data } = await supabase.from("profiles").select("id, full_name, phone, email, is_suspended")
      .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`).limit(20);
    results = data ?? [];
  }

  const [{ data: owners }, { data: members }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, email, is_suspended").in("id", ownerIds),
    supabase.from("drivers").select("fleet_id, is_online").in("fleet_id", fleetIds),
  ]);
  const ownerOf = (id: string) => (owners ?? []).find((o) => o.id === id);
  const count = (id: string, online = false) => (members ?? []).filter((m) => m.fleet_id === id && (!online || m.is_online)).length;

  return (
    <>
      <PageHeader title="Fleets">
        {canManage && (
          <form className="flex gap-2 text-sm">
            <input name="q" defaultValue={q ?? ""} placeholder="Find the owner by name, phone or email" aria-label="Find fleet owner"
              className="surface h-9 w-64 rounded-lg border border-line px-2" />
            <button className="h-9 rounded-lg bg-brand-600 px-3 font-semibold text-white">Search</button>
          </form>
        )}
      </PageHeader>
      <p className="text-muted mb-4 text-sm">
        A fleet owner manages drivers who drive their vehicles. Creating a fleet makes the owner a fleet operator; drivers join
        with the fleet&apos;s code from their Earnings page, and the owner sees them at <code>/fleet</code>.
      </p>
      {error && <Alert tone="danger" className="mb-4">{error.message}</Alert>}

      {canManage && q?.trim() && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Create a fleet for…</h2>
          {results.length === 0 ? (
            <p className="text-muted text-sm">No account matches “{q}”. The owner needs to sign in once first.</p>
          ) : (
            <Table head={["User", "Contact", ""]}>
              {results.map((p) => (
                <tr key={p.id}>
                  <Td>{p.full_name ?? "—"} {p.is_suspended && <Badge tone="danger">suspended</Badge>}</Td>
                  <Td className="text-muted">{p.email ?? p.phone}</Td>
                  <Td>
                    {!p.is_suspended && (
                      <RpcAction fn="admin_create_fleet" args={{ p_owner_id: p.id }} label="Create fleet"
                        prompt={`Fleet name for ${p.full_name ?? p.email ?? p.phone}:`} promptArg="p_name" />
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      )}

      <Table head={["Fleet", "Owner", "Drivers", "Join code", "Created", "Status", ""]}>
        {(fleets ?? []).map((f) => {
          const o = ownerOf(f.owner_id);
          return (
            <tr key={f.id}>
              <Td className="font-medium">{f.name}</Td>
              <Td>{o?.full_name ?? "—"}<span className="text-muted block text-xs">{f.phone ?? o?.phone ?? o?.email}</span></Td>
              <Td>{count(f.id)} <span className="text-muted text-xs">({count(f.id, true)} online)</span></Td>
              <Td><code>{f.join_code}</code></Td>
              <Td className="text-muted">{formatDateTime(f.created_at)}</Td>
              <Td>{f.is_active ? <Badge tone="ok">active</Badge> : <Badge tone="danger">inactive</Badge>}</Td>
              <Td>
                {canManage && (f.is_active
                  ? <RpcAction fn="admin_set_fleet_active" args={{ p_fleet_id: f.id, p_active: false }} label="Deactivate" variant="danger"
                      confirm={`Deactivate ${f.name}? New drivers can't join; current drivers keep driving.`} />
                  : <RpcAction fn="admin_set_fleet_active" args={{ p_fleet_id: f.id, p_active: true }} label="Activate" />)}
              </Td>
            </tr>
          );
        })}
      </Table>
      {fleets?.length === 0 && <p className="text-muted mt-2 text-sm">No fleets yet.</p>}
    </>
  );
}
