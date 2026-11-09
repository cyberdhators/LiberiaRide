import { createClient } from "@/lib/supabase/server";
import { getSessionUser, hasAnyRole, type AppRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { Alert, Badge } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { RpcAction } from "@/components/admin/rpc-action";

export const metadata = { title: "Staff & roles" };
export const dynamic = "force-dynamic";

// Roles managed on this page. passenger/driver come from sign-up and driver onboarding.
const MANAGED: { role: AppRole; label: string; superOnly: boolean }[] = [
  { role: "support_agent", label: "Support agent", superOnly: false },
  { role: "fleet_operator", label: "Fleet operator", superOnly: false },
  { role: "admin", label: "Administrator", superOnly: true },
  { role: "super_admin", label: "Super admin", superOnly: true },
];
const labelOf = (r: string) => MANAGED.find((m) => m.role === r)?.label ?? r;

type Profile = { id: string; full_name: string | null; phone: string | null; email: string | null; is_suspended: boolean };

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = (await getSessionUser())!;
  if (!hasAnyRole(me, ["admin", "super_admin"])) {
    return (
      <>
        <PageHeader title="Staff & roles" />
        <Alert tone="warn">Only administrators can manage staff roles.</Alert>
      </>
    );
  }
  const isSuper = me.roles.includes("super_admin");
  const { q } = await searchParams;
  const supabase = await createClient();

  // Everyone who currently holds a managed role. Database authorises every change (admin_set_role).
  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("user_id, role, created_at")
    .in("role", MANAGED.map((m) => m.role))
    .order("created_at", { ascending: true });
  const staffIds = [...new Set((roleRows ?? []).map((r) => r.user_id))];

  let results: Profile[] = [];
  if (q?.trim()) {
    const term = q.replace(/[%_,()]/g, "").trim();
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, phone, email, is_suspended")
      .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
      .limit(20);
    results = data ?? [];
  }

  const ids = [...new Set([...staffIds, ...results.map((p) => p.id)])];
  const [{ data: staffProfiles }, { data: allRoles }] = ids.length
    ? await Promise.all([
        supabase.from("profiles").select("id, full_name, phone, email, is_suspended").in("id", staffIds),
        supabase.from("user_roles").select("user_id, role").in("user_id", ids),
      ])
    : [{ data: [] as Profile[] }, { data: [] as { user_id: string; role: string }[] }];
  const rolesOf = (id: string) => (allRoles ?? []).filter((r) => r.user_id === id).map((r) => r.role);
  const sinceOf = (id: string) => (roleRows ?? []).find((r) => r.user_id === id)?.created_at;
  const canChange = (role: AppRole) => isSuper || !MANAGED.find((m) => m.role === role)!.superOnly;

  function RoleControls({ p }: { p: Profile }) {
    const held = rolesOf(p.id);
    return (
      <div className="flex flex-wrap gap-2">
        {MANAGED.filter((m) => canChange(m.role)).map((m) =>
          held.includes(m.role) ? (
            <RpcAction key={m.role} fn="admin_set_role" args={{ p_user_id: p.id, p_role: m.role, p_grant: false }}
              label={`Remove ${m.label.toLowerCase()}`} variant="danger"
              confirm={`Remove the ${m.label} role from ${p.full_name ?? p.email ?? p.phone ?? "this user"}?`} />
          ) : (
            <RpcAction key={m.role} fn="admin_set_role" args={{ p_user_id: p.id, p_role: m.role, p_grant: true }}
              label={`Make ${m.label.toLowerCase()}`}
              confirm={m.superOnly ? `Give ${p.full_name ?? p.email ?? p.phone ?? "this user"} the ${m.label} role? This grants full operational control.` : undefined} />
          ),
        )}
      </div>
    );
  }

  function Who({ p }: { p: Profile }) {
    return (
      <>
        {p.full_name ?? "—"}{p.id === me.id && <span className="text-muted"> (you)</span>}
        <span className="text-muted block text-xs">{p.email ?? p.phone}</span>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Staff & roles">
        <form className="flex gap-2 text-sm">
          <input name="q" defaultValue={q ?? ""} placeholder="Find a user by name, phone or email" aria-label="Find a user"
            className="surface h-9 w-64 rounded-lg border border-line px-2" />
          <button className="h-9 rounded-lg bg-brand-600 px-3 font-semibold text-white">Search</button>
        </form>
      </PageHeader>

      <p className="text-muted mb-4 text-sm">
        People sign up first (as passengers), then you give them a staff role here. Every change is recorded in the audit log.
        {!isSuper && " Only a super admin can grant or remove administrator roles."}
      </p>
      {error && <Alert tone="danger" className="mb-4">{error.message}</Alert>}

      {q?.trim() && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Search results</h2>
          {results.length === 0 ? (
            <p className="text-muted text-sm">No account matches “{q}”. They need to sign in once before they can be given a role.</p>
          ) : (
            <Table head={["User", "Current roles", "Change"]}>
              {results.map((p) => (
                <tr key={p.id}>
                  <Td><Who p={p} /></Td>
                  <Td><RoleBadges roles={rolesOf(p.id)} suspended={p.is_suspended} /></Td>
                  <Td>{p.is_suspended ? <span className="text-muted text-xs">Reinstate the account first</span> : <RoleControls p={p} />}</Td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      )}

      <h2 className="mb-2 font-semibold">Current staff ({staffIds.length})</h2>
      <Table head={["User", "Roles", "Since", "Change"]}>
        {(staffProfiles ?? [])
          .sort((a, b) => staffIds.indexOf(a.id) - staffIds.indexOf(b.id))
          .map((p) => (
            <tr key={p.id}>
              <Td><Who p={p} /></Td>
              <Td><RoleBadges roles={rolesOf(p.id)} suspended={p.is_suspended} /></Td>
              <Td className="text-muted">{formatDateTime(sinceOf(p.id) ?? null)}</Td>
              <Td><RoleControls p={p} /></Td>
            </tr>
          ))}
      </Table>
    </>
  );
}

function RoleBadges({ roles, suspended }: { roles: string[]; suspended: boolean }) {
  const shown = roles.filter((r) => r !== "passenger");
  return (
    <span className="flex flex-wrap gap-1">
      {shown.length === 0 && <Badge>passenger only</Badge>}
      {shown.map((r) => (
        <Badge key={r} tone={r === "super_admin" || r === "admin" ? "brand" : r === "driver" ? "neutral" : "ok"}>{r === "driver" ? "driver" : labelOf(r)}</Badge>
      ))}
      {suspended && <Badge tone="danger">suspended</Badge>}
    </span>
  );
}
