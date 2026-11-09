import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, money } from "@/lib/utils";
import { Badge, Card, CardTitle } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { RpcAction } from "@/components/admin/rpc-action";

export const dynamic = "force-dynamic";

const DOC_LABEL: Record<string, string> = {
  driver_licence: "Driver licence", vehicle_registration: "Vehicle registration", insurance: "Insurance",
  national_id: "National ID", profile_photo: "Profile photo", vehicle_photo: "Vehicle photo", other: "Other",
};

export default async function DriverDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: d } = await supabase
    .from("drivers")
    .select("*, profiles!drivers_id_fkey(full_name, phone, email, is_suspended, created_at)")
    .eq("id", id)
    .maybeSingle();
  if (!d) notFound();
  const [{ data: vehicles }, { data: docs }, { data: earnings }, { data: trips }] = await Promise.all([
    supabase.from("vehicles").select("id, make, model, year, color, plate_number, status, review_note, vehicle_categories(name)").eq("driver_id", id),
    supabase.from("driver_documents").select("id, doc_type, status, storage_path, mime_type, review_note, created_at, expires_at").eq("driver_id", id).order("created_at", { ascending: false }),
    supabase.from("driver_earnings").select("currency, net_minor, commission_minor").eq("driver_id", id),
    supabase.from("bookings").select("id, code, status, created_at, final_fare_minor, currency").eq("driver_id", id).order("created_at", { ascending: false }).limit(15),
  ]);

  // Short-lived signed URLs for private documents (staff can read via storage RLS).
  const signed = new Map<string, string>();
  for (const doc of docs ?? []) {
    const { data } = await supabase.storage.from("driver-documents").createSignedUrl(doc.storage_path, 300);
    if (data?.signedUrl) signed.set(doc.id, data.signedUrl);
  }

  const p = d.profiles as unknown as { full_name: string | null; phone: string | null; email: string | null; is_suspended: boolean };
  const totals = (earnings ?? []).reduce<Record<string, { net: number; comm: number }>>((acc, e) => {
    const t = acc[e.currency] ?? { net: 0, comm: 0 };
    t.net += Number(e.net_minor); t.comm += Number(e.commission_minor);
    return { ...acc, [e.currency]: t };
  }, {});

  return (
    <>
      <PageHeader title={p?.full_name ?? "Driver"}>
        <div className="flex flex-wrap gap-2">
          {d.status !== "approved" && <RpcAction fn="admin_review_driver" args={{ p_driver_id: id, p_decision: "approved", p_note: null }} label="Approve driver" variant="success" confirm="Approve this driver? Make sure the licence, registration and vehicle are approved." />}
          {d.status === "pending" && <RpcAction fn="admin_review_driver" args={{ p_driver_id: id, p_decision: "rejected" }} prompt="Reason for rejection (shown to the driver):" promptArg="p_note" label="Reject" />}
          {d.status !== "suspended" && <RpcAction fn="admin_review_driver" args={{ p_driver_id: id, p_decision: "suspended" }} prompt="Reason for suspension:" promptArg="p_note" label="Suspend" variant="danger" />}
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>Profile</CardTitle>
          <dl className="mt-2 space-y-1 text-sm">
            <div><dt className="text-muted inline">Status: </dt><dd className="inline"><Badge tone={d.status === "approved" ? "ok" : "warn"}>{d.status}</Badge> {d.is_online && <Badge tone="ok">online</Badge>}</dd></div>
            <div><dt className="text-muted inline">Phone: </dt><dd className="inline">{p?.phone ?? "—"}</dd></div>
            <div><dt className="text-muted inline">Licence: </dt><dd className="inline font-mono">{d.licence_number}</dd> <span className="text-muted">exp {d.licence_expiry ?? "—"}</span></div>
            <div><dt className="text-muted inline">Date of birth: </dt><dd className="inline">{d.date_of_birth ?? "—"}</dd></div>
            <div><dt className="text-muted inline">Area: </dt><dd className="inline">{d.address_text ?? "—"}</dd></div>
            <div><dt className="text-muted inline">Trips / rating: </dt><dd className="inline">{d.completed_trips} · {d.rating_avg ?? "—"}</dd></div>
            <div><dt className="text-muted inline">Acceptance: </dt><dd className="inline">{d.acceptance_offers ? Math.round((d.acceptance_accepts * 100) / d.acceptance_offers) + "%" : "—"}</dd></div>
            {d.review_note && <div><dt className="text-muted inline">Note: </dt><dd className="inline">{d.review_note}</dd></div>}
          </dl>
          <p className="text-muted mt-3 text-xs">Earnings: {Object.entries(totals).map(([c, t]) => `${money(t.net, c)} net · ${money(t.comm, c)} commission`).join(" | ") || "none"}</p>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Vehicles</CardTitle>
          <ul className="mt-2 space-y-2 text-sm">
            {(vehicles ?? []).map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2">
                <span>{(v.vehicle_categories as unknown as { name: string } | null)?.name} · {v.color} {v.make} {v.model} {v.year ?? ""} · <span className="font-mono">{v.plate_number}</span> <Badge tone={v.status === "approved" ? "ok" : v.status === "rejected" ? "danger" : "warn"}>{v.status}</Badge></span>
                <span className="flex gap-2">
                  {v.status !== "approved" && <RpcAction fn="admin_review_vehicle" args={{ p_vehicle_id: v.id, p_decision: "approved", p_note: null }} label="Approve" variant="success" />}
                  {v.status !== "rejected" && <RpcAction fn="admin_review_vehicle" args={{ p_vehicle_id: v.id, p_decision: "rejected" }} prompt="Reason:" promptArg="p_note" label="Reject" />}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <h2 className="mb-2 mt-6 font-semibold">Documents</h2>
      <Table head={["Document", "Status", "Uploaded", "File", "Actions"]}>
        {(docs ?? []).map((doc) => (
          <tr key={doc.id}>
            <Td>{DOC_LABEL[doc.doc_type] ?? doc.doc_type}{doc.review_note && <span className="text-muted block text-xs">{doc.review_note}</span>}</Td>
            <Td><Badge tone={doc.status === "approved" ? "ok" : doc.status === "rejected" ? "danger" : "warn"}>{doc.status}</Badge></Td>
            <Td className="text-muted">{formatDateTime(doc.created_at)}</Td>
            <Td>{signed.get(doc.id) ? <a href={signed.get(doc.id)} target="_blank" rel="noreferrer noopener" className="underline">View ({doc.mime_type?.split("/")[1]})</a> : "unavailable"}</Td>
            <Td>
              <span className="flex gap-2">
                {doc.status !== "approved" && <RpcAction fn="admin_review_document" args={{ p_document_id: doc.id, p_decision: "approved", p_note: null }} label="Approve" variant="success" />}
                {doc.status !== "rejected" && <RpcAction fn="admin_review_document" args={{ p_document_id: doc.id, p_decision: "rejected" }} prompt="What is wrong with this document? (shown to the driver)" promptArg="p_note" label="Reject" />}
              </span>
            </Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Recent trips</h2>
      <Table head={["Trip", "Status", "Fare", "Date"]}>
        {(trips ?? []).map((t) => (
          <tr key={t.id}><Td><a className="underline" href={`/admin/bookings/${t.id}`}>{t.code}</a></Td><Td>{t.status}</Td><Td>{money(t.final_fare_minor, t.currency)}</Td><Td className="text-muted">{formatDateTime(t.created_at)}</Td></tr>
        ))}
      </Table>
    </>
  );
}
