import { notFound } from "next/navigation";
import { STATUS_LABELS, type BookingStatus } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, money } from "@/lib/utils";
import { Badge, Card, CardTitle } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { RpcAction } from "@/components/admin/rpc-action";

export const dynamic = "force-dynamic";

export default async function BookingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: view } = await supabase.rpc("get_booking_view", { p_booking_id: id });
  if (!view) notFound();
  const v = view as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const status = v.status as BookingStatus;

  const [{ data: events }, { data: offers }, { data: assignments }, { data: payments }, { data: candidates }, { data: extra }, { data: rider }] = await Promise.all([
    supabase.from("booking_events").select("id, from_status, to_status, actor_role, metadata, created_at").eq("booking_id", id).order("id"),
    supabase.from("booking_offers").select("id, driver_id, strategy, dispatch_round, status, pickup_distance_m, offered_at, responded_at, response_reason").eq("booking_id", id).order("offered_at"),
    supabase.from("booking_assignments").select("id, driver_id, method, assigned_at, released_at, release_reason").eq("booking_id", id).order("assigned_at"),
    supabase.from("payments").select("id, method, status, amount_minor, currency, provider_reference, idempotency_key, created_at").eq("booking_id", id),
    ["SEARCHING_DRIVER", "DRIVER_OFFERED"].includes(status) ? supabase.rpc("admin_assignable_drivers", { p_booking_id: id }) : Promise.resolve({ data: [] }),
    supabase.from("bookings").select("created_by, passenger_note, profiles!bookings_created_by_fkey(full_name)").eq("id", id).maybeSingle(),
    supabase.from("booking_riders").select("name, phone").eq("booking_id", id).maybeSingle(),
  ]);
  const operator = (extra?.profiles as unknown as { full_name: string | null } | null)?.full_name;

  const driverIds = [...new Set([...(offers ?? []).map((o) => o.driver_id), ...(assignments ?? []).map((a) => a.driver_id)])];
  const { data: names } = driverIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", driverIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = (id: string) => names?.find((n) => n.id === id)?.full_name ?? id.slice(0, 8);

  const canCancel = !["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"].includes(status);

  return (
    <>
      <PageHeader title={`Booking ${v.code}`}>
        <div className="flex gap-2">
          {canCancel && (
            <RpcAction fn="admin_cancel_booking" args={{ p_booking_id: id, p_charge_fee: false }} prompt={status === "IN_PROGRESS" ? "Reason for ending this trip (marks it FAILED):" : "Reason for cancelling:"} promptArg="p_reason"
              label={status === "IN_PROGRESS" ? "End trip (failed)" : "Cancel booking"} variant="danger" />
          )}
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>Summary</CardTitle>
          <dl className="mt-2 space-y-1 text-sm">
            <div><Badge tone="brand">{STATUS_LABELS[status]}</Badge> <span className="text-muted">via {v.channel}</span></div>
            {v.scheduled_for && <div><dt className="text-muted inline">Pickup at </dt><dd className="inline font-semibold">{formatDateTime(v.scheduled_for)}</dd></div>}
            {extra?.created_by && <div><dt className="text-muted inline">Booked by operator </dt><dd className="inline">{operator ?? extra.created_by.slice(0, 8)}</dd></div>}
            {Number(v.surge_multiplier) > 1 && <div><dt className="text-muted inline">Busy hours </dt><dd className="inline">×{Number(v.surge_multiplier).toFixed(2)}</dd></div>}
            {Number(v.outstanding_fee_minor) > 0 && <div><dt className="text-muted inline">Carried fee </dt><dd className="inline">{money(v.outstanding_fee_minor, v.currency)}</dd></div>}
            {extra?.passenger_note && <div><dt className="text-muted inline">Note </dt><dd className="inline">{extra.passenger_note}</dd></div>}
            <div><dt className="text-muted inline">From </dt><dd className="inline">{v.pickup.address}</dd></div>
            <div><dt className="text-muted inline">To </dt><dd className="inline">{v.dropoff.address}</dd></div>
            <div><dt className="text-muted inline">Estimate </dt><dd className="inline">{money(v.estimated_fare_minor, v.currency)} · {(v.estimated_distance_m / 1000).toFixed(1)} km</dd></div>
            {v.agreed_fare_minor && <div><dt className="text-muted inline">Agreed </dt><dd className="inline">{money(v.agreed_fare_minor, v.currency)}</dd></div>}
            {v.final_fare_minor !== null && <div><dt className="text-muted inline">Final </dt><dd className="inline font-semibold">{money(v.final_fare_minor, v.currency)}</dd></div>}
            <div><dt className="text-muted inline">Payment </dt><dd className="inline">{v.payment_method} · {v.payment_status}</dd></div>
            {v.cancel_reason && <div><dt className="text-muted inline">Cancelled </dt><dd className="inline">{v.cancel_reason}</dd></div>}
          </dl>
        </Card>
        <Card>
          <CardTitle>People</CardTitle>
          <div className="mt-2 space-y-2 text-sm">
            {rider ? (
              <>
                <p><span className="text-muted">Rider:</span> {rider.name} <a className="underline" href={`tel:${rider.phone}`}>{rider.phone}</a></p>
                <p><span className="text-muted">Booked by passenger:</span> {v.passenger?.booked_by}</p>
              </>
            ) : (
              <p><span className="text-muted">Passenger:</span> {v.passenger?.name} {v.passenger?.phone && <a className="underline" href={`tel:${v.passenger.phone}`}>{v.passenger.phone}</a>}</p>
            )}
            {v.driver ? (
              <p><span className="text-muted">Driver:</span> <a className="underline" href={`/admin/drivers/${v.driver.id}`}>{v.driver.name}</a> {v.driver.phone} · {v.driver.vehicle?.plate}</p>
            ) : <p className="text-muted">No driver assigned.</p>}
          </div>
        </Card>
        <Card>
          <CardTitle>Payments</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {(payments ?? []).map((p) => (
              <li key={p.id}>{money(p.amount_minor, p.currency)} · {p.method} · <Badge tone={p.status === "succeeded" ? "ok" : "warn"}>{p.status}</Badge>
                <span className="text-muted block text-xs">{p.idempotency_key}{p.provider_reference ? ` · ref ${p.provider_reference}` : ""}</span></li>
            ))}
            {!payments?.length && <li className="text-muted">None yet.</li>}
          </ul>
        </Card>
      </div>

      {(candidates ?? []).length > 0 && (
        <>
          <h2 className="mb-2 mt-6 font-semibold">Manual assignment</h2>
          <Table head={["Driver", "Distance to pickup", "GPS age", "Plate", "Rating", ""]}>
            {(candidates as { driver_id: string; name: string | null; phone: string | null; distance_m: number; location_age_s: number; plate: string; rating: number | null }[]).map((c) => (
              <tr key={c.driver_id}>
                <Td>{c.name}<span className="text-muted block text-xs">{c.phone}</span></Td>
                <Td>{(c.distance_m / 1000).toFixed(1)} km</Td>
                <Td>{c.location_age_s}s</Td>
                <Td className="font-mono">{c.plate}</Td>
                <Td>{c.rating ?? "—"}</Td>
                <Td><RpcAction fn="admin_assign_driver" args={{ p_booking_id: id, p_driver_id: c.driver_id }} prompt="Reason for manual assignment (audit log):" promptArg="p_reason" label="Assign" variant="primary" /></Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <h2 className="mb-2 mt-6 font-semibold">State history</h2>
      <Table head={["When", "Transition", "Actor", "Details"]}>
        {(events ?? []).map((e) => (
          <tr key={e.id}>
            <Td className="text-muted">{formatDateTime(e.created_at)}</Td>
            <Td>{e.from_status ?? "—"} → <strong>{e.to_status}</strong></Td>
            <Td>{e.actor_role}</Td>
            <Td className="text-muted max-w-96 truncate font-mono text-xs">{JSON.stringify(e.metadata)}</Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Allocation history</h2>
      <Table head={["Offered", "Driver", "Strategy", "Round", "Distance", "Result"]}>
        {(offers ?? []).map((o) => (
          <tr key={o.id}>
            <Td className="text-muted">{formatDateTime(o.offered_at)}</Td>
            <Td>{nameOf(o.driver_id)}</Td>
            <Td>{o.strategy}</Td>
            <Td>{o.dispatch_round}</Td>
            <Td>{(o.pickup_distance_m / 1000).toFixed(1)} km</Td>
            <Td><Badge tone={o.status === "accepted" ? "ok" : o.status === "pending" ? "brand" : "neutral"}>{o.status}</Badge> <span className="text-muted text-xs">{o.response_reason}</span></Td>
          </tr>
        ))}
        {(assignments ?? []).map((a) => (
          <tr key={a.id}>
            <Td className="text-muted">{formatDateTime(a.assigned_at)}</Td>
            <Td>{nameOf(a.driver_id)}</Td>
            <Td>assignment ({a.method})</Td>
            <Td>—</Td><Td>—</Td>
            <Td>{a.released_at ? `released: ${a.release_reason}` : <Badge tone="ok">active</Badge>}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
