"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Crosshair, History, Home, Link2, MapPin, Search, Star, X } from "lucide-react";
import type { ResolvedLocation } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Button, Input, Spinner } from "@/components/ui";
import type { Place, SavedPlace } from "./booking-flow";

interface Props {
  title: string;
  savedPlaces: SavedPlace[];
  onPick: (p: Place) => void;
  onUseGps?: () => void;
  onChooseOnMap?: () => void;
  onClose: () => void;
}

/**
 * Search runs on SUBMIT, not on every keystroke: each QLS lookup costs a credit
 * (docs/QLS_INTEGRATION.md §2). Local landmarks and saved/recent places are free.
 */
export function LocationSearch({ title, savedPlaces, onPick, onUseGps, onChooseOnMap, onClose }: Props) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<ResolvedLocation[] | null>(null);
  const isPing = /quantumloc\.io\/p\//i.test(q);

  const localMatches = q.trim().length >= 2
    ? savedPlaces.filter((p) => (p.label + " " + p.address_text).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 4)
    : [];

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (text.length < 3) {
      setError("Type at least 3 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(isPing ? "/api/geo/ping" : "/api/geo/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isPing ? { pin: text } : { q: text, kind: "auto" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setResults([]);
        setError(body?.error?.message ?? "Search failed.");
        return;
      }
      setResults(isPing ? [body.result] : body.results);
      if (body.notice) setNotice(body.notice);
    } catch {
      setError("You appear to be offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const pickResolved = (r: ResolvedLocation) =>
    onPick({ lat: r.point.lat, lng: r.point.lng, address: r.label, qlsRef: r.qlsRef ?? null, source: r.source });
  const pickSaved = (s: SavedPlace) =>
    onPick({ lat: s.lat, lng: s.lng, address: s.address_text, qlsRef: s.qls_code, source: "saved" });

  const saved = savedPlaces.filter((p) => p.kind === "saved");
  const recent = savedPlaces.filter((p) => p.kind === "recent").slice(0, 5);

  return (
    <div className="surface fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center gap-2 border-b border-line p-3">
        <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--surface-muted)]" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <h2 className="font-semibold">{title}</h2>
      </div>

      <form onSubmit={search} className="flex gap-2 p-3">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Landmark, “street, city” or Ping link"
          aria-label="Search location" enterKeyHint="search" />
        <Button type="submit" size="icon" loading={busy} aria-label="Search">{!busy && <Search className="h-5 w-5" />}</Button>
      </form>
      <p className="text-muted -mt-1 px-4 text-xs">
        Tip: addresses need a comma — e.g. “1848 Capitol Hill, Monrovia”. Landmarks work too.
      </p>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          {onUseGps && (
            <Button variant="secondary" onClick={onUseGps}><Crosshair className="h-4 w-4" /> My location</Button>
          )}
          {onChooseOnMap && (
            <Button variant="secondary" onClick={onChooseOnMap} className={onUseGps ? "" : "col-span-2"}>
              <MapPin className="h-4 w-4" /> Choose on map
            </Button>
          )}
        </div>

        {error && <Alert tone="warn" className="mt-3">{error}</Alert>}
        {notice && <Alert tone="info" className="mt-3">{notice}</Alert>}
        {busy && <div className="mt-6 grid place-items-center"><Spinner /></div>}

        {results && results.length > 0 && (
          <Section title="Results">
            {results.map((r, i) => (
              <Row key={`${r.qlsRef ?? ""}-${i}`} icon={r.source === "qls_ping" ? <Link2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                title={r.label} subtitle={r.qlsRef ? `QLS ${r.qlsRef}` : r.source === "alias" ? "Local landmark" : undefined}
                onClick={() => pickResolved(r)} />
            ))}
          </Section>
        )}

        {localMatches.length > 0 && (
          <Section title="Your places">
            {localMatches.map((s) => (
              <Row key={s.id} icon={s.kind === "saved" ? savedIcon(s.label) : <History className="h-4 w-4" />} title={s.label} subtitle={s.address_text} onClick={() => pickSaved(s)} />
            ))}
          </Section>
        )}

        {!results && !q && saved.length > 0 && (
          <Section title="Saved places">
            {saved.map((s) => (
              <Row key={s.id} icon={savedIcon(s.label)} title={s.label} subtitle={s.address_text} onClick={() => pickSaved(s)} />
            ))}
          </Section>
        )}
        {!results && !q && recent.length > 0 && (
          <Section title="Recent">
            {recent.map((s) => (
              <Row key={s.id} icon={<History className="h-4 w-4" />} title={s.address_text} onClick={() => pickSaved(s)}
                action={<SaveRecent place={s} />} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-muted mb-1 px-1 text-xs font-semibold uppercase tracking-wide">{title}</h3>
      <ul className="divide-y divide-[var(--line)]">{children}</ul>
    </section>
  );
}

function Row({ icon, title, subtitle, onClick, action }: {
  icon: React.ReactNode; title: string; subtitle?: string; onClick: () => void; action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-1">
      <button onClick={onClick} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-1 py-3 text-left hover:bg-[var(--surface-muted)]">
        <span className="text-muted mt-0.5">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          {subtitle && <span className="text-muted block truncate text-xs">{subtitle}</span>}
        </span>
      </button>
      {action}
    </li>
  );
}

export function savedIcon(label: string) {
  const l = label.trim().toLowerCase();
  if (l === "home") return <Home className="h-4 w-4" />;
  if (l === "work") return <Briefcase className="h-4 w-4" />;
  return <Star className="h-4 w-4" />;
}

/** Star on a recent place → save it as Home, Work or a named place (replaces an existing place with that name). */
function SaveRecent({ place }: { place: SavedPlace }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(label: string | null) {
    const name = label ?? window.prompt("Name this place", "")?.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("save_location", {
      p_kind: "saved", p_label: name, p_address: place.address_text, p_lat: place.lat, p_lng: place.lng, p_qls_code: place.qls_code ?? undefined,
    });
    setBusy(false);
    if (error) return setError(userMessage(error));
    setDone(name);
    setOpen(false);
    router.refresh();
  }

  if (done) return <span className="text-muted shrink-0 px-2 py-3 text-xs">Saved as {done}</span>;
  return (
    <div className="flex shrink-0 flex-col items-end py-2">
      {open ? (
        <div className="flex gap-1" role="group" aria-label="Save place as">
          {["Home", "Work"].map((l) => (
            <Button key={l} size="sm" variant="secondary" disabled={busy} onClick={() => save(l)}>{l}</Button>
          ))}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => save(null)}>Other…</Button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-muted grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--surface-muted)]"
          aria-label={`Save ${place.address_text}`}>
          <Star className="h-4 w-4" />
        </button>
      )}
      {error && <span className="mt-1 max-w-40 text-xs text-signal-600">{error}</span>}
    </div>
  );
}
