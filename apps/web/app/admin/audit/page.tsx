import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, Table, Td } from "@/components/admin/table";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, actor_id, actor_role, action, entity_type, entity_id, before, after, reason, created_at, profiles(full_name)")
    .order("id", { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader title="Audit log" />
      {error && <p className="text-sm text-signal-600">Only administrators can view the audit log.</p>}
      <Table head={["When", "Actor", "Action", "Entity", "Reason", "Change"]}>
        {(data ?? []).map((a) => (
          <tr key={a.id}>
            <Td className="text-muted">{formatDateTime(a.created_at)}</Td>
            <Td>{(a.profiles as unknown as { full_name: string | null } | null)?.full_name ?? "system"}<span className="text-muted block text-xs">{a.actor_role}</span></Td>
            <Td className="font-medium">{a.action}</Td>
            <Td className="text-muted text-xs">{a.entity_type} {a.entity_id?.slice(0, 12)}</Td>
            <Td className="max-w-60 whitespace-normal text-xs">{a.reason ?? "—"}</Td>
            <Td className="max-w-96 truncate font-mono text-xs">{a.before ? `${JSON.stringify(a.before)} → ` : ""}{JSON.stringify(a.after)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
