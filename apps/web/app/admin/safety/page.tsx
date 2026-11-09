import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { RpcAction } from "@/components/admin/rpc-action";

export const metadata = { title: "Safety" };
export const dynamic = "force-dynamic";

export default async function SafetyPage() {
  const supabase = await createClient();
  const [{ data: incidents }, { data: complaints }] = await Promise.all([
    supabase.from("safety_incidents").select("id, booking_id, reporter_id, reporter_role, kind, severity, status, description, resolution, created_at, profiles!safety_incidents_reporter_id_fkey(full_name, phone)")
      .order("status").order("created_at", { ascending: false }).limit(100),
    supabase.from("complaints").select("id, booking_id, category, description, status, resolution, created_at, profiles!complaints_complainant_id_fkey(full_name, phone)")
      .order("created_at", { ascending: false }).limit(100),
  ]);
  const reporterIds = (incidents ?? []).filter((i) => i.kind === "sos").map((i) => i.reporter_id);
  const { data: contacts } = reporterIds.length
    ? await supabase.from("emergency_contacts").select("user_id, name, phone, relationship").in("user_id", reporterIds)
    : { data: [] as { user_id: string; name: string; phone: string; relationship: string | null }[] };

  const caseActions = (table: string, id: string, status: string) => (
    <span className="flex flex-wrap gap-1">
      {status === "open" && <RpcAction fn="admin_update_case" args={{ p_table: table, p_id: id, p_status: "acknowledged", p_assign_to: null, p_resolution: null }} label="Acknowledge" variant="primary" />}
      {!["resolved", "closed"].includes(status) && <RpcAction fn="admin_update_case" args={{ p_table: table, p_id: id, p_status: "resolved", p_assign_to: null }} prompt="Resolution notes:" promptArg="p_resolution" label="Resolve" />}
    </span>
  );

  return (
    <>
      <PageHeader title="Safety & complaints" />
      <h2 className="mb-2 font-semibold">SOS & incidents</h2>
      <Table head={["When", "Type", "Reporter", "Trip", "Details", "Status", ""]}>
        {(incidents ?? []).map((i) => {
          const p = i.profiles as unknown as { full_name: string | null; phone: string | null } | null;
          const ec = (contacts ?? []).filter((c) => c.user_id === i.reporter_id);
          return (
            <tr key={i.id} className={i.kind === "sos" && i.status === "open" ? "bg-red-50" : ""}>
              <Td className="text-muted">{formatDateTime(i.created_at)}</Td>
              <Td><Badge tone={i.kind === "sos" ? "danger" : "warn"}>{i.kind}</Badge> <span className="text-muted text-xs">sev {i.severity}</span></Td>
              <Td>{p?.full_name ?? "—"} ({i.reporter_role})
                {p?.phone && <a href={`tel:${p.phone}`} className="block text-xs underline">{p.phone}</a>}
                {ec.map((c) => <span key={c.phone} className="text-muted block text-xs">EC: {c.name} {c.phone}</span>)}
              </Td>
              <Td>{i.booking_id ? <Link className="underline" href={`/admin/bookings/${i.booking_id}`}>view</Link> : "—"}</Td>
              <Td className="max-w-80 whitespace-normal text-xs">{i.description ?? "—"}{i.resolution && <span className="text-muted block">↳ {i.resolution}</span>}</Td>
              <Td><Badge tone={i.status === "resolved" || i.status === "closed" ? "ok" : "warn"}>{i.status}</Badge></Td>
              <Td>{caseActions("safety_incidents", i.id, i.status)}</Td>
            </tr>
          );
        })}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Complaints</h2>
      <Table head={["When", "Category", "From", "Trip", "Details", "Status", ""]}>
        {(complaints ?? []).map((c) => {
          const p = c.profiles as unknown as { full_name: string | null; phone: string | null } | null;
          return (
            <tr key={c.id}>
              <Td className="text-muted">{formatDateTime(c.created_at)}</Td>
              <Td>{c.category.replaceAll("_", " ")}</Td>
              <Td>{p?.full_name ?? "—"}<span className="text-muted block text-xs">{p?.phone}</span></Td>
              <Td>{c.booking_id ? <Link className="underline" href={`/admin/bookings/${c.booking_id}`}>view</Link> : "—"}</Td>
              <Td className="max-w-80 whitespace-normal text-xs">{c.description}{c.resolution && <span className="text-muted block">↳ {c.resolution}</span>}</Td>
              <Td><Badge tone={c.status === "resolved" || c.status === "closed" ? "ok" : "warn"}>{c.status}</Badge></Td>
              <Td>{caseActions("complaints", c.id, c.status)}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
