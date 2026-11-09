"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseMajor, type Currency } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

type Row = Record<string, unknown>;

const toMajor = (minor: unknown) => (minor === null || minor === undefined ? "" : (Number(minor) / 100).toFixed(2));

function useRpc() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  async function call(fn: string, args: Record<string, unknown>, success: string) {
    setBusy(true); setError(null); setOk(null);
    const { error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) { setError(userMessage(error, error.message)); return false; }
    setOk(success);
    router.refresh();
    return true;
  }
  return { busy, error, ok, setError, call };
}

export function FareRuleEditor({ rule, categoryCode, categories }: {
  rule: Row | null; categoryCode: string; categories?: { id: string; code: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const { busy, error, ok, setError, call } = useRpc();
  const [currency, setCurrency] = useState<Currency>((rule?.currency as Currency) ?? "USD");
  const [categoryId, setCategoryId] = useState<string>((rule?.category_id as string) ?? categories?.[0]?.id ?? "");
  const [f, setF] = useState<Record<string, string>>({
    base_fare_minor: toMajor(rule?.base_fare_minor), per_km_minor: toMajor(rule?.per_km_minor), per_minute_minor: toMajor(rule?.per_minute_minor),
    minimum_fare_minor: toMajor(rule?.minimum_fare_minor), booking_fee_minor: toMajor(rule?.booking_fee_minor ?? 0), per_stop_minor: toMajor(rule?.per_stop_minor ?? 0),
    waiting_per_minute_minor: toMajor(rule?.waiting_per_minute_minor ?? 0), cancellation_fee_minor: toMajor(rule?.cancellation_fee_minor ?? 0),
    rounding_increment_minor: toMajor(rule?.rounding_increment_minor ?? 1),
    waiting_free_minutes: String(rule?.waiting_free_minutes ?? 3), cancellation_grace_seconds: String(rule?.cancellation_grace_seconds ?? 120),
    commission_pct: rule ? (Number(rule.commission_bps) / 100).toString() : "15",
    bid_min_pct: String(rule?.bid_min_pct ?? 80), bid_max_pct: String(rule?.bid_max_pct ?? 150), reason: "",
  });
  const [bidding, setBidding] = useState(Boolean(rule?.bidding_enabled));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{rule ? "Edit" : "New fare rule"}</Button>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const minor = (k: string) => parseMajor(f[k] || "0", currency).minor.toString();
      const payload = {
        category_id: categoryId, currency, geofence_id: (rule?.geofence_id as string) ?? null,
        base_fare_minor: minor("base_fare_minor"), per_km_minor: minor("per_km_minor"), per_minute_minor: minor("per_minute_minor"),
        minimum_fare_minor: minor("minimum_fare_minor"), booking_fee_minor: minor("booking_fee_minor"), per_stop_minor: minor("per_stop_minor"),
        waiting_per_minute_minor: minor("waiting_per_minute_minor"), cancellation_fee_minor: minor("cancellation_fee_minor"),
        rounding_increment_minor: minor("rounding_increment_minor"),
        waiting_free_minutes: Number(f.waiting_free_minutes), cancellation_grace_seconds: Number(f.cancellation_grace_seconds),
        commission_bps: Math.round(Number(f.commission_pct) * 100), bidding_enabled: bidding,
        bid_min_pct: Number(f.bid_min_pct), bid_max_pct: Number(f.bid_max_pct), reason: f.reason || null,
      };
      if (!payload.category_id) return setError("Choose a category.");
      if (await call("admin_upsert_fare_rule", { p_rule: payload }, "Fare rule saved as a new version.")) setOpen(false);
    } catch {
      setError("Amounts must be numbers with at most 2 decimals.");
    }
  }

  const money = (k: string, label: string) => (
    <Field label={`${label} (${currency})`} htmlFor={`${k}-${categoryCode}`}><Input id={`${k}-${categoryCode}`} inputMode="decimal" value={f[k]} onChange={set(k)} required /></Field>
  );

  return (
    <form onSubmit={save} className="surface w-[min(90vw,720px)] space-y-3 whitespace-normal rounded-xl border border-line p-3 shadow-lg">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {categories ? (
          <Field label="Category" htmlFor="cat"><Select id="cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select></Field>
        ) : null}
        <Field label="Currency" htmlFor={`cur-${categoryCode}`}><Select id={`cur-${categoryCode}`} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} disabled={Boolean(rule)}>
          <option>USD</option><option>LRD</option></Select></Field>
        {money("base_fare_minor", "Base")}{money("per_km_minor", "Per km")}{money("per_minute_minor", "Per minute")}
        {money("minimum_fare_minor", "Minimum")}{money("booking_fee_minor", "Booking fee")}{money("per_stop_minor", "Per stop")}
        {money("waiting_per_minute_minor", "Waiting / min")}{money("cancellation_fee_minor", "Cancel fee")}{money("rounding_increment_minor", "Round to")}
        <Field label="Free waiting (min)" htmlFor={`w-${categoryCode}`}><Input id={`w-${categoryCode}`} inputMode="numeric" value={f.waiting_free_minutes} onChange={set("waiting_free_minutes")} /></Field>
        <Field label="Cancel grace (s)" htmlFor={`g-${categoryCode}`}><Input id={`g-${categoryCode}`} inputMode="numeric" value={f.cancellation_grace_seconds} onChange={set("cancellation_grace_seconds")} /></Field>
        <Field label="Commission %" htmlFor={`c-${categoryCode}`}><Input id={`c-${categoryCode}`} inputMode="decimal" value={f.commission_pct} onChange={set("commission_pct")} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bidding} onChange={(e) => setBidding(e.target.checked)} /> Allow passenger price offers (bidding)</label>
      {bidding && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lowest offer (% of estimate)" htmlFor={`bmin-${categoryCode}`}><Input id={`bmin-${categoryCode}`} inputMode="numeric" value={f.bid_min_pct} onChange={set("bid_min_pct")} /></Field>
          <Field label="Highest offer (% of estimate)" htmlFor={`bmax-${categoryCode}`}><Input id={`bmax-${categoryCode}`} inputMode="numeric" value={f.bid_max_pct} onChange={set("bid_max_pct")} /></Field>
        </div>
      )}
      <Field label="Reason for change (audit log)" htmlFor={`r-${categoryCode}`}><Input id={`r-${categoryCode}`} value={f.reason} onChange={set("reason")} required /></Field>
      {error && <Alert tone="danger">{error}</Alert>}
      {ok && <Alert tone="ok">{ok}</Alert>}
      <div className="flex gap-2"><Button type="submit" loading={busy}>Save new version</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
    </form>
  );
}

export function PromotionForm({ categories }: { categories: string[] }) {
  const { busy, error, ok, setError, call } = useRpc();
  const [f, setF] = useState({ name: "", code: "", type: "percent", value: "10", currency: "USD", max: "", min: "", category: "", ends: "", limit: "", perUser: "1" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const cur = f.currency as Currency;
      const ok = await call("admin_create_promotion", {
        p_name: f.name, p_discount_type: f.type,
        p_discount_value: f.type === "percent" ? Math.round(Number(f.value) * 100) : parseMajor(f.value, cur).minor.toString(),
        p_currency: f.type === "fixed" || f.max || f.min ? cur : null,
        p_max_discount_minor: f.max ? parseMajor(f.max, cur).minor.toString() : null,
        p_min_fare_minor: f.min ? parseMajor(f.min, cur).minor.toString() : null,
        p_category_code: f.category || null, p_starts_at: null, p_ends_at: f.ends ? new Date(f.ends).toISOString() : null,
        p_usage_limit: f.limit ? Number(f.limit) : null, p_per_user_limit: Number(f.perUser) || 1, p_coupon_code: f.code,
      }, `Promo ${f.code.toUpperCase()} created.`);
      if (ok) setF((x) => ({ ...x, name: "", code: "" }));
    } catch {
      setError("Check the amounts.");
    }
  }

  return (
    <form onSubmit={save} className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
      <Input placeholder="Name" value={f.name} onChange={set("name")} required aria-label="Promotion name" />
      <Input placeholder="CODE" value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase() }))} pattern="[A-Z0-9_-]{3,32}" required aria-label="Coupon code" />
      <Select value={f.type} onChange={set("type")} aria-label="Discount type"><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></Select>
      <Input placeholder={f.type === "percent" ? "% off" : "Amount off"} inputMode="decimal" value={f.value} onChange={set("value")} required aria-label="Discount value" />
      <Select value={f.currency} onChange={set("currency")} aria-label="Currency"><option>USD</option><option>LRD</option></Select>
      <Input placeholder="Max discount (optional)" inputMode="decimal" value={f.max} onChange={set("max")} aria-label="Max discount" />
      <Select value={f.category} onChange={set("category")} aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</Select>
      <Input type="date" value={f.ends} onChange={set("ends")} aria-label="Ends on" />
      <Input placeholder="Total uses (optional)" inputMode="numeric" value={f.limit} onChange={set("limit")} aria-label="Usage limit" />
      <Input placeholder="Uses per person" inputMode="numeric" value={f.perUser} onChange={set("perUser")} aria-label="Per user limit" />
      {error && <Alert tone="danger" className="col-span-2">{error}</Alert>}
      {ok && <Alert tone="ok" className="col-span-2">{ok}</Alert>}
      <Button type="submit" loading={busy} className="col-span-2">Create promotion</Button>
    </form>
  );
}

export function ConfigEditor({ settings }: { settings: { key: string; value: unknown; description: string | null; updated_at: string }[] }) {
  return (
    <div className="surface divide-y divide-[var(--line)] rounded-xl border border-line">
      {settings.map((s) => <ConfigRow key={s.key} setting={s} />)}
    </div>
  );
}

function ConfigRow({ setting }: { setting: { key: string; value: unknown; description: string | null } }) {
  const { busy, error, ok, call } = useRpc();
  const [value, setValue] = useState(typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value));
  const kind = typeof setting.value;
  async function save() {
    let v: unknown = value;
    if (kind === "number") v = Number(value);
    if (kind === "boolean") v = value === "true";
    await call("admin_set_config", { p_key: setting.key, p_value: v, p_reason: null }, "Saved");
  }
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
      <div className="min-w-60 flex-1">
        <p className="font-mono text-xs">{setting.key}</p>
        <p className="text-muted text-xs">{setting.description}</p>
      </div>
      {kind === "boolean" ? (
        <Select className="h-9 w-28" value={value} onChange={(e) => setValue(e.target.value)} aria-label={setting.key}><option>true</option><option>false</option></Select>
      ) : setting.key === "dispatch.default_strategy" ? (
        <Select className="h-9 w-36" value={value} onChange={(e) => setValue(e.target.value)} aria-label={setting.key}>
          {["nearest", "sequential", "soft", "broadcast", "manual"].map((s) => <option key={s}>{s}</option>)}
        </Select>
      ) : (
        <Input className="h-9 w-28" value={value} onChange={(e) => setValue(e.target.value)} aria-label={setting.key} />
      )}
      <Button size="sm" variant="secondary" loading={busy} onClick={save}>Save</Button>
      {error && <span className="text-xs text-signal-600">{error}</span>}
      {ok && <span className="text-xs text-ok-500">{ok}</span>}
    </div>
  );
}

export function AliasForm() {
  const { busy, error, ok, call } = useRpc();
  const [f, setF] = useState({ alias: "", address: "", lat: "", lng: "", qls: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await call("admin_upsert_alias", { p_alias: f.alias, p_address: f.address || null, p_lat: Number(f.lat), p_lng: Number(f.lng), p_qls_code: f.qls || null, p_verified: true }, "Landmark saved.")) {
      setF({ alias: "", address: "", lat: "", lng: "", qls: "" });
    }
  }
  return (
    <form onSubmit={save} className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
      <Input placeholder="Landmark (e.g. Red Light Market)" value={f.alias} onChange={set("alias")} required className="col-span-2" aria-label="Landmark name" />
      <Input placeholder="Area / description" value={f.address} onChange={set("address")} className="col-span-2" aria-label="Area" />
      <Input placeholder="Latitude" inputMode="decimal" value={f.lat} onChange={set("lat")} required aria-label="Latitude" />
      <Input placeholder="Longitude" inputMode="decimal" value={f.lng} onChange={set("lng")} required aria-label="Longitude" />
      <Input placeholder="QLS code (optional)" value={f.qls} onChange={set("qls")} className="col-span-2" aria-label="QLS code" />
      {error && <Alert tone="danger" className="col-span-2">{error}</Alert>}
      {ok && <Alert tone="ok" className="col-span-2">{ok}</Alert>}
      <Button type="submit" loading={busy} className="col-span-2">Add landmark</Button>
    </form>
  );
}
