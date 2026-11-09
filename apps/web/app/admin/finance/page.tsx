import { createClient } from "@/lib/supabase/server";
import { formatDateTime, money } from "@/lib/utils";
import { Alert, Badge } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { RpcAction } from "@/components/admin/rpc-action";

export const metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const supabase = await createClient();
  const [{ data: payments }, { data: recon }, { data: unsettled }, { data: settlements }] = await Promise.all([
    supabase.from("payments").select("id, booking_id, method, status, amount_minor, currency, provider_reference, created_at, bookings(code)").order("created_at", { ascending: false }).limit(100),
    supabase.from("cash_reconciliation").select("id, driver_id, booking_id, currency, expected_minor, collected_minor, variance_minor, status, created_at").in("status", ["pending", "variance"]).order("created_at").limit(100),
    supabase.from("driver_earnings").select("driver_id, currency, gross_minor, commission_minor, payment_method").is("settlement_id", null).limit(2000),
    supabase.from("driver_settlements").select("id, driver_id, currency, period_start, period_end, gross_minor, commission_minor, cash_collected_minor, net_payable_minor, status, payout_reference").order("created_at", { ascending: false }).limit(50),
  ]);

  // Group unsettled earnings per driver+currency.
  const groups = new Map<string, { driver_id: string; currency: string; trips: number; gross: number; comm: number; cash: number }>();
  for (const e of unsettled ?? []) {
    const k = `${e.driver_id}:${e.currency}`;
    const g = groups.get(k) ?? { driver_id: e.driver_id, currency: e.currency, trips: 0, gross: 0, comm: 0, cash: 0 };
    g.trips++; g.gross += Number(e.gross_minor); g.comm += Number(e.commission_minor);
    if (e.payment_method === "cash") g.cash += Number(e.gross_minor);
    groups.set(k, g);
  }
  const driverIds = [...new Set([...groups.values()].map((g) => g.driver_id).concat((recon ?? []).map((r) => r.driver_id)).concat((settlements ?? []).map((s) => s.driver_id)))];
  const { data: names } = driverIds.length ? await supabase.from("profiles").select("id, full_name").in("id", driverIds) : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = (id: string) => names?.find((n) => n.id === id)?.full_name ?? id.slice(0, 8);

  return (
    <>
      <PageHeader title="Finance" />
      <Alert tone="info" className="mb-4">
        Mobile-money collection (Orange Money, MTN MoMo) is not live yet: merchant credentials are pending. Those payments stay
        <strong> pending</strong> and are never marked paid automatically. Cash is confirmed by drivers and reconciled here.
      </Alert>

      <h2 className="mb-2 font-semibold">Unsettled driver balances</h2>
      <Table head={["Driver", "Trips", "Gross", "Commission", "Cash held by driver", "Net (platform → driver)", ""]}>
        {[...groups.values()].map((g) => (
          <tr key={`${g.driver_id}:${g.currency}`}>
            <Td>{nameOf(g.driver_id)}</Td><Td>{g.trips}</Td>
            <Td>{money(g.gross, g.currency)}</Td><Td>{money(g.comm, g.currency)}</Td><Td>{money(g.cash, g.currency)}</Td>
            <Td className="font-semibold">{money(g.gross - g.comm - g.cash, g.currency)}</Td>
            <Td><RpcAction fn="admin_create_settlement" args={{ p_driver_id: g.driver_id, p_currency: g.currency }} label="Create settlement" confirm="Create a settlement for all unsettled trips of this driver in this currency?" /></Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Settlements</h2>
      <Table head={["Driver", "Period", "Net payable", "Status", ""]}>
        {(settlements ?? []).map((s) => (
          <tr key={s.id}>
            <Td>{nameOf(s.driver_id)}</Td>
            <Td className="text-muted">{formatDateTime(s.period_start)} – {formatDateTime(s.period_end)}</Td>
            <Td>{Number(s.net_payable_minor) >= 0 ? "Pay driver " : "Collect from driver "}{money(Math.abs(Number(s.net_payable_minor)), s.currency)}</Td>
            <Td><Badge tone={s.status === "paid" ? "ok" : "warn"}>{s.status}</Badge> <span className="text-muted text-xs">{s.payout_reference}</span></Td>
            <Td>{s.status === "pending" && <RpcAction fn="admin_mark_settlement_paid" args={{ p_settlement_id: s.id }} prompt="Payout / receipt reference:" promptArg="p_reference" label="Mark settled" />}</Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Cash reconciliation</h2>
      <Table head={["Driver", "Expected", "Collected", "Variance", "Status", ""]}>
        {(recon ?? []).map((r) => (
          <tr key={r.id}>
            <Td>{nameOf(r.driver_id)}</Td>
            <Td>{money(r.expected_minor, r.currency)}</Td>
            <Td>{r.collected_minor === null ? "—" : money(r.collected_minor, r.currency)}</Td>
            <Td className={Number(r.variance_minor) < 0 ? "text-signal-600" : ""}>{money(r.variance_minor, r.currency)}</Td>
            <Td><Badge tone={r.status === "variance" ? "danger" : "warn"}>{r.status}</Badge></Td>
            <Td><RpcAction fn="admin_reconcile_cash" args={{ p_reconciliation_id: r.id, p_collected_minor: r.collected_minor ?? r.expected_minor }} prompt="Reconciliation note:" promptArg="p_note" label="Resolve" /></Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Recent payments</h2>
      <Table head={["Trip", "Method", "Amount", "Status", "Reference", "Created"]}>
        {(payments ?? []).map((p) => (
          <tr key={p.id}>
            <Td>{(p.bookings as unknown as { code: string } | null)?.code}</Td>
            <Td>{p.method.replace("_", " ")}</Td>
            <Td>{money(p.amount_minor, p.currency)}</Td>
            <Td><Badge tone={p.status === "succeeded" ? "ok" : p.status === "failed" ? "danger" : "warn"}>{p.status}</Badge></Td>
            <Td className="text-muted font-mono text-xs">{p.provider_reference ?? "—"}</Td>
            <Td className="text-muted">{formatDateTime(p.created_at)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
