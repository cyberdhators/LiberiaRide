"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Badge, Button, Input, Select } from "@/components/ui";

export interface SurgeWindow {
  id: string; label: string; multiplier: number; days: number[]; start_local: string; end_local: string; is_active: boolean;
  geofences: { code: string; name: string } | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (t: string) => t.slice(0, 5);

/** Busy-hour windows: list + add/edit. Times are Monrovia local time. */
export function SurgePanel({ windows, zones }: { windows: SurgeWindow[]; zones: { code: string; name: string }[] }) {
  const [editing, setEditing] = useState<SurgeWindow | "new" | null>(null);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-[var(--line)] text-sm">
        {windows.length === 0 && <li className="text-muted py-2">No busy-hour pricing. Every ride is charged the normal fare.</li>}
        {windows.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <strong>{w.label}</strong> · ×{Number(w.multiplier).toFixed(2)}
              <span className="text-muted block text-xs">
                {w.days.map((d) => DAYS[d]).join(", ")} · {hhmm(w.start_local)}–{hhmm(w.end_local)}{w.end_local < w.start_local ? " (next day)" : ""} · {w.geofences?.name ?? "everywhere"}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {w.is_active ? <Badge tone="warn">active</Badge> : <Badge>off</Badge>}
              <button className="text-xs text-brand-600 underline" onClick={() => setEditing(w)}>Edit</button>
            </span>
          </li>
        ))}
      </ul>
      {editing ? <SurgeEditor key={editing === "new" ? "new" : editing.id} window={editing === "new" ? null : editing} zones={zones} onClose={() => setEditing(null)} />
        : <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>Add busy hours</Button>}
    </div>
  );
}

function SurgeEditor({ window: w, zones, onClose }: { window: SurgeWindow | null; zones: { code: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    label: w?.label ?? "", zone: w?.geofences?.code ?? "", multiplier: String(w?.multiplier ?? "1.3"),
    days: w?.days ?? [1, 2, 3, 4, 5], start: hhmm(w?.start_local ?? "07:00"), end: hhmm(w?.end_local ?? "09:30"), active: w?.is_active ?? true,
  });
  const toggleDay = (d: number) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() });

  return (
    <form aria-label="Busy-hour window" className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const { error } = await createClient().rpc("admin_upsert_surge_window", {
          p_id: w?.id ?? null, p_label: f.label, p_geofence_code: f.zone || null, p_multiplier: Number(f.multiplier),
          p_days: f.days, p_start: f.start, p_end: f.end, p_active: f.active,
        });
        setBusy(false);
        if (error) return setError(userMessage(error, error.message));
        onClose();
        router.refresh();
      }}>
      <Input aria-label="Busy-hour label" placeholder="Label, e.g. Morning rush" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required minLength={2} />
      <Select aria-label="Busy-hour area" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}>
        <option value="">Everywhere</option>
        {zones.map((z) => <option key={z.code} value={z.code}>{z.name}</option>)}
      </Select>
      <label className="text-sm">Multiplier
        <Input aria-label="Busy-hour multiplier" type="number" step="0.05" min="1.05" max="3" value={f.multiplier} onChange={(e) => setF({ ...f, multiplier: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">From<Input aria-label="Busy-hour from" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
        <label className="text-sm">To<Input aria-label="Busy-hour to" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap gap-1 sm:col-span-2" role="group" aria-label="Days">
        {DAYS.map((d, i) => (
          <button type="button" key={d} aria-pressed={f.days.includes(i)} onClick={() => toggleDay(i)}
            className={`rounded-lg border px-2 py-1 text-xs ${f.days.includes(i) ? "border-brand-500 bg-brand-50" : "border-line"}`}>{d}</button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
      </label>
      <p className="text-muted text-xs sm:col-span-2">
        Monrovia time. An end before the start runs past midnight. Applies to new quotes only; rides already booked keep their price.
        Drivers earn the higher fare; commission is charged as usual.
      </p>
      {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
