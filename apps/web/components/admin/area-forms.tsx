"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Map, type MapArea } from "@/components/map";

function useRpc() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  async function call(fn: string, args: Record<string, unknown>, success: string) {
    setBusy(true); setError(null); setOk(null);
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) { setError(userMessage(error, error.message)); return null; }
    setOk(success);
    router.refresh();
    return data ?? true;
  }
  return { busy, error, ok, call };
}

export interface CategoryRow { code: string; name: string; description: string | null; seats: number; sort_order: number; is_active: boolean; priced: boolean }

export function CategoryEditor({ category }: { category: CategoryRow | null }) {
  const [open, setOpen] = useState(false);
  const { busy, error, ok, call } = useRpc();
  const [f, setF] = useState({
    code: category?.code ?? "", name: category?.name ?? "", description: category?.description ?? "",
    seats: String(category?.seats ?? 4), sort: String(category?.sort_order ?? 50), active: category?.is_active ?? false,
  });

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{category ? "Edit" : "Add ride type"}</Button>;
  return (
    <form className="surface mt-2 grid max-w-xl gap-3 rounded-xl border border-line p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const done = await call("admin_upsert_category", {
          p_code: f.code, p_name: f.name, p_description: f.description, p_seats: Number(f.seats), p_sort: Number(f.sort), p_active: f.active,
        }, "Saved.");
        if (done) setOpen(false);
      }}>
      <Field label="Code" htmlFor={`code-${f.code}`} hint="Lowercase, never changes (e.g. keke)">
        <Input id={`code-${f.code}`} value={f.code} disabled={Boolean(category)} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} required />
      </Field>
      <Field label="Name" htmlFor={`name-${f.code}`}><Input id={`name-${f.code}`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Description" htmlFor={`desc-${f.code}`}><Input id={`desc-${f.code}`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Seats" htmlFor={`seats-${f.code}`}><Input id={`seats-${f.code}`} type="number" min={1} max={20} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></Field>
        <Field label="Order" htmlFor={`sort-${f.code}`}><Input id={`sort-${f.code}`} type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        Offered to passengers {category && !category.priced && <span className="text-muted">(needs an active fare rule first — Fares &amp; config)</span>}
      </label>
      {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
      {ok && <Alert tone="ok" className="sm:col-span-2">{ok}</Alert>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

export interface AreaRow {
  id: string; code: string; name: string; kind: string; is_active: boolean; area_km2: number;
  geojson: MapArea["geojson"]; updated_at: string;
}

const KIND_COLOR: Record<string, string> = { service_area: "#143f85", airport: "#7c3aed", restricted: "#c8102e", pricing_zone: "#c77700" };
const KIND_LABEL: Record<string, string> = { service_area: "Service area", airport: "Airport", restricted: "Restricted", pricing_zone: "Pricing zone" };

export function AreasPanel({ areas }: { areas: AreaRow[] }) {
  const [editing, setEditing] = useState<AreaRow | "new" | null>(null);
  const [preview, setPreview] = useState<MapArea | null>(null);
  const mapAreas: MapArea[] = [
    ...areas.filter((a) => !(editing && editing !== "new" && editing.id === a.id && preview))
      .map((a) => ({ id: a.id, geojson: a.geojson, color: KIND_COLOR[a.kind], dimmed: !a.is_active })),
    ...(preview ? [{ ...preview, color: "#138a52" }] : []),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="surface h-[420px] overflow-hidden rounded-xl border border-line">
        <Map areas={mapAreas} />
      </div>
      <div className="space-y-2">
        <ul className="surface divide-y divide-[var(--line)] rounded-xl border border-line text-sm">
          {areas.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 p-3">
              <span>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[a.kind] }} />
                <strong>{a.name}</strong>
                <span className="text-muted block text-xs">{KIND_LABEL[a.kind]} · {a.area_km2} km² · <code>{a.code}</code></span>
              </span>
              <span className="flex flex-col items-end gap-1">
                {a.is_active ? <Badge tone="ok">active</Badge> : <Badge>off</Badge>}
                <button className="text-xs text-brand-600 underline" onClick={() => { setPreview(null); setEditing(a); }}>Edit</button>
              </span>
            </li>
          ))}
        </ul>
        {!editing && <Button size="sm" variant="secondary" onClick={() => { setPreview(null); setEditing("new"); }}>Add area</Button>}
        {editing && (
          <AreaEditor key={editing === "new" ? "new" : editing.id} area={editing === "new" ? null : editing}
            onPreview={setPreview} onClose={() => { setEditing(null); setPreview(null); }} />
        )}
      </div>
    </div>
  );
}

function AreaEditor({ area, onPreview, onClose }: { area: AreaRow | null; onPreview: (a: MapArea | null) => void; onClose: () => void }) {
  const { busy, error, ok, call } = useRpc();
  const [f, setF] = useState({ code: area?.code ?? "", name: area?.name ?? "", kind: area?.kind ?? "service_area", active: area?.is_active ?? true });
  const [text, setText] = useState("");
  const [shapeError, setShapeError] = useState<string | null>(null);

  /** Parse pasted/uploaded GeoJSON for a map preview; the database validates it again on save. */
  function readShape(raw: string): MapArea["geojson"] | null {
    setShapeError(null);
    if (!raw.trim()) { onPreview(null); return null; }
    try {
      const j = JSON.parse(raw);
      const geoms = j.type === "FeatureCollection" ? j.features.map((x: { geometry: unknown }) => x.geometry)
        : j.type === "Feature" ? [j.geometry] : [j];
      const polys = geoms.filter((g: { type?: string }) => g?.type === "Polygon" || g?.type === "MultiPolygon");
      if (!polys.length) throw new Error("No polygon found.");
      const geojson = polys.length === 1 ? polys[0] : { type: "MultiPolygon", coordinates: polys.flatMap((g: { type: string; coordinates: unknown[] }) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates)) };
      onPreview({ id: "preview", geojson });
      return j;
    } catch (e) {
      setShapeError(`Not valid GeoJSON: ${(e as Error).message}`);
      onPreview(null);
      return null;
    }
  }

  return (
    <form className="surface space-y-3 rounded-xl border border-line p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const geojson = text.trim() ? readShape(text) : null;
        if (text.trim() && !geojson) return;
        const res = await call("admin_upsert_geofence", { p_code: f.code, p_name: f.name, p_kind: f.kind, p_geojson: geojson, p_active: f.active },
          area ? "Saved." : "Area created.");
        if (res) onClose();
      }}>
      <p className="font-semibold">{area ? `Edit ${area.name}` : "New area"}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Code" htmlFor="area-code"><Input id="area-code" value={f.code} disabled={Boolean(area)} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} required /></Field>
        <Field label="Kind" htmlFor="area-kind">
          <Select id="area-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Name" htmlFor="area-name"><Input id="area-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label={area ? "New shape (optional)" : "Shape"} htmlFor="area-geojson"
        hint="Paste GeoJSON or upload a .geojson file — draw it at geojson.io. Leave empty to keep the current shape.">
        <Textarea id="area-geojson" rows={4} value={text} placeholder='{"type":"Polygon","coordinates":[...]}'
          onChange={(e) => setText(e.target.value)} onBlur={() => readShape(text)} className="font-mono text-xs" />
      </Field>
      <input type="file" accept=".geojson,.json,application/geo+json,application/json" className="text-xs"
        onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const t = await file.text(); setText(t); readShape(t); } }} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
      </label>
      {f.kind === "service_area" && <p className="text-muted text-xs">Pickups outside every active service area are refused when quoting a fare.</p>}
      {shapeError && <Alert tone="warn">{shapeError}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {ok && <Alert tone="ok">{ok}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
