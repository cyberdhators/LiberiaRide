import Link from "next/link";
import { BOOKING_STATUSES, STATUS_LABELS, type BookingStatus } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, money } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status, q } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("bookings")
    .select("id, code, status, channel, pickup_address, dropoff_address, currency, estimated_fare_minor, final_fare_minor, payment_method, allocation_strategy, created_at, driver_id, profiles!bookings_passenger_id_fkey(full_name, phone)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && (BOOKING_STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
  if (q) query = query.ilike("code", `%${q.replace(/[%_]/g, "").toUpperCase()}%`);
  const { data, error } = await query;

  return (
    <>
      <PageHeader title="Bookings">
        <form className="flex gap-2 text-sm">
          <select name="status" defaultValue={status ?? ""} className="surface h-9 rounded-lg border border-line px-2">
            <option value="">All statuses</option>
            {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <input name="q" defaultValue={q ?? ""} placeholder="Code e.g. LR-261109" className="surface h-9 rounded-lg border border-line px-2" />
          <button className="h-9 rounded-lg bg-brand-600 px-3 font-semibold text-white">Search</button>
        </form>
      </PageHeader>
      {error && <p className="text-sm text-signal-600">{error.message}</p>}
      <Table head={["Code", "Status", "Passenger", "Route", "Fare", "Payment", "Strategy", "Created"]}>
        {(data ?? []).map((b) => {
          const p = b.profiles as unknown as { full_name: string | null; phone: string | null } | null;
          return (
            <tr key={b.id}>
              <Td><Link href={`/admin/bookings/${b.id}`} className="font-medium underline">{b.code}</Link>{b.channel !== "web" && <Badge className="ml-1">{b.channel}</Badge>}</Td>
              <Td><Badge tone={b.status === "COMPLETED" ? "ok" : ["CANCELLED", "EXPIRED", "FAILED"].includes(b.status) ? "neutral" : "brand"}>{STATUS_LABELS[b.status as BookingStatus]}</Badge></Td>
              <Td>{p?.full_name ?? "—"}<span className="text-muted block text-xs">{p?.phone}</span></Td>
              <Td className="max-w-72 truncate whitespace-normal text-xs">{b.pickup_address} → {b.dropoff_address}</Td>
              <Td className="tabular-nums">{money(b.final_fare_minor ?? b.estimated_fare_minor, b.currency)}</Td>
              <Td>{b.payment_method.replace("_", " ")}</Td>
              <Td className="text-muted">{b.allocation_strategy}</Td>
              <Td className="text-muted">{formatDateTime(b.created_at)}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
