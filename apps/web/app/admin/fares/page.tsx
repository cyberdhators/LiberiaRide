import { createClient } from "@/lib/supabase/server";
import { formatDateTime, money } from "@/lib/utils";
import { Alert, Badge, Card, CardTitle } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { RpcAction } from "@/components/admin/rpc-action";
import { FareRuleEditor, PromotionForm, ConfigEditor, AliasForm } from "@/components/admin/fare-forms";

export const metadata = { title: "Fares & configuration" };
export const dynamic = "force-dynamic";

export default async function FaresPage() {
  const supabase = await createClient();
  const [{ data: rules }, { data: categories }, { data: promos }, { data: config }, { data: aliases }] = await Promise.all([
    supabase.from("fare_rules").select("*, vehicle_categories(code, name)").eq("is_active", true).order("currency"),
    supabase.from("vehicle_categories").select("id, code, name, is_active").order("sort_order"),
    supabase.from("promotions").select("id, name, discount_type, discount_value, currency, max_discount_minor, starts_at, ends_at, is_active, usage_limit, coupons(code, redeemed_count)").order("created_at", { ascending: false }).limit(50),
    supabase.from("configuration_settings").select("key, value, description, updated_at").order("key"),
    supabase.from("address_aliases").select("id, alias, address_text, qls_code, is_verified").order("alias").limit(200),
  ]);

  return (
    <>
      <PageHeader title="Fares & configuration" />
      <Alert tone="warn" className="mb-4" title="Launch prices are placeholders">
        The seeded fares are starting points, not market research. Review every category before go-live. Changes create a new rule version and are audited.
      </Alert>

      <h2 className="mb-2 font-semibold">Active fare rules</h2>
      <Table head={["Category", "Cur", "Base", "Per km", "Per min", "Minimum", "Per stop", "Waiting", "Cancel fee", "Commission", "Bidding", ""]}>
        {(rules ?? []).map((r) => {
          const c = r.vehicle_categories as unknown as { code: string; name: string };
          return (
            <tr key={r.id}>
              <Td className="font-medium">{c.name}</Td><Td>{r.currency}</Td>
              <Td>{money(r.base_fare_minor, r.currency)}</Td><Td>{money(r.per_km_minor, r.currency)}</Td><Td>{money(r.per_minute_minor, r.currency)}</Td>
              <Td>{money(r.minimum_fare_minor, r.currency)}</Td><Td>{money(r.per_stop_minor, r.currency)}</Td>
              <Td className="text-xs">{r.waiting_free_minutes} min free, then {money(r.waiting_per_minute_minor, r.currency)}/min</Td>
              <Td>{money(r.cancellation_fee_minor, r.currency)} <span className="text-muted text-xs">after {r.cancellation_grace_seconds}s</span></Td>
              <Td>{(r.commission_bps / 100).toFixed(1)}%</Td>
              <Td>{r.bidding_enabled ? <Badge tone="brand">{r.bid_min_pct}–{r.bid_max_pct}%</Badge> : "off"}</Td>
              <Td><FareRuleEditor rule={r} categoryCode={c.code} /></Td>
            </tr>
          );
        })}
      </Table>
      <p className="text-muted mt-2 text-xs">Need a rule for a new category or currency? Use the editor on any row and change category/currency.</p>
      <div className="mt-3"><FareRuleEditor rule={null} categoryCode={categories?.[0]?.code ?? "car"} categories={categories ?? []} /></div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Promotions</CardTitle>
          <ul className="mt-2 divide-y divide-[var(--line)] text-sm">
            {(promos ?? []).map((p) => {
              const coupons = p.coupons as unknown as { code: string; redeemed_count: number }[];
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <strong>{coupons.map((c) => c.code).join(", ")}</strong> · {p.name} ·{" "}
                    {p.discount_type === "percent" ? `${p.discount_value / 100}%` : money(p.discount_value, p.currency ?? "USD")}
                    <span className="text-muted block text-xs">
                      used {coupons.reduce((s, c) => s + c.redeemed_count, 0)}{p.usage_limit ? `/${p.usage_limit}` : ""} · until {p.ends_at ? formatDateTime(p.ends_at) : "no end"}
                    </span>
                  </span>
                  <RpcAction fn="admin_set_promotion_active" args={{ p_promotion_id: p.id, p_active: !p.is_active }} label={p.is_active ? "Deactivate" : "Activate"} />
                </li>
              );
            })}
          </ul>
          <PromotionForm categories={(categories ?? []).map((c) => c.code)} />
        </Card>

        <Card>
          <CardTitle>Landmarks (free local search)</CardTitle>
          <p className="text-muted mt-1 text-xs">Monrovia pickups are often described by landmark. Verified aliases are searched before QLS (saves credits) and label dropped pins.</p>
          <ul className="mt-2 max-h-64 divide-y divide-[var(--line)] overflow-y-auto text-sm">
            {(aliases ?? []).map((a) => (
              <li key={a.id} className="py-1.5">{a.alias} <span className="text-muted text-xs">{a.address_text}{a.qls_code ? ` · ${a.qls_code}` : ""}</span> {!a.is_verified && <Badge tone="warn">unverified</Badge>}</li>
            ))}
          </ul>
          <AliasForm />
        </Card>
      </div>

      <h2 className="mb-2 mt-8 font-semibold">Platform configuration</h2>
      <ConfigEditor settings={(config ?? []).map((c) => ({ key: c.key, value: c.value, description: c.description, updated_at: c.updated_at }))} />
    </>
  );
}
