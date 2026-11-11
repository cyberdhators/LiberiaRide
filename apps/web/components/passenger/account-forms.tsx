"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Home, Plus, Trash2 } from "lucide-react";
import { formatPhone, normalizePhone } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { getCurrentFix } from "@/hooks/use-geolocation";
import { reverseLabel } from "@/lib/geo-client";
import { Alert, Button, Card, CardTitle, Field, Input, Select } from "@/components/ui";
import type { Place, SavedPlace } from "./booking-flow";
import { LocationSearch, savedIcon } from "./location-search";

interface Profile {
  full_name: string; phone: string | null; email: string | null; preferred_currency: "USD" | "LRD";
  default_payment_method: string; rating: number | null; trips: number;
}
interface Contact { id: string; name: string; phone: string; relationship: string | null }

export function AccountForms({ profile, contacts, places, isDriver }: {
  profile: Profile; contacts: Contact[]; places: SavedPlace[]; isDriver: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(profile.full_name);
  const [currency, setCurrency] = useState(profile.preferred_currency);
  const [payment, setPayment] = useState(profile.default_payment_method);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cRel, setCRel] = useState("");
  const [cErr, setCErr] = useState<string | null>(null);

  // Label being set via the location picker ("Home", "Work" or a custom name).
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [placeErr, setPlaceErr] = useState<string | null>(null);
  const saved = places.filter((p) => p.kind === "saved");
  const has = (label: string) => saved.some((p) => p.label.toLowerCase() === label.toLowerCase());

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user!.id;
    const [p, q] = await Promise.all([
      supabase.from("profiles").update({ full_name: name.trim() || null, preferred_currency: currency }).eq("id", uid),
      supabase.from("passengers").update({ default_payment_method: payment }).eq("id", uid),
    ]);
    setSaving(false);
    const err = p.error ?? q.error;
    setMsg(err ? { tone: "danger", text: userMessage(err) } : { tone: "ok", text: "Saved." });
    router.refresh();
  }

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    setCErr(null);
    const phone = normalizePhone(cPhone);
    if (!phone) return setCErr("Enter a valid phone number.");
    if (!cName.trim()) return setCErr("Enter a name.");
    const { error } = await supabase.from("emergency_contacts").insert({ name: cName.trim(), phone, relationship: cRel.trim() || null });
    if (error) return setCErr(userMessage(error));
    setCName(""); setCPhone(""); setCRel("");
    router.refresh();
  }

  async function removeContact(id: string) {
    await supabase.from("emergency_contacts").delete().eq("id", id);
    router.refresh();
  }
  async function removePlace(id: string) {
    await supabase.from("saved_locations").delete().eq("id", id);
    router.refresh();
  }
  function startPlace(label: string | null) {
    const name = label ?? window.prompt("Name this place (e.g. School, Mum's house)", "")?.trim();
    if (!name) return;
    setPlaceErr(null);
    setPlaceLabel(name);
  }
  async function savePlace(p: Place) {
    const label = placeLabel!;
    setPlaceLabel(null);
    const { error } = await supabase.rpc("save_location", {
      p_kind: "saved", p_label: label, p_address: p.address, p_lat: p.lat, p_lng: p.lng, p_qls_code: p.qlsRef ?? undefined,
    });
    if (error) return setPlaceErr(userMessage(error));
    router.refresh();
  }
  async function placeFromGps(): Promise<string | null> {
    try {
      const fix = await getCurrentFix();
      await savePlace(await reverseLabel(fix.lat, fix.lng));
      return null;
    } catch (e) {
      return (e as Error).message;   // shown inside the search screen
    }
  }

  return (
    <>
      <Card>
        <CardTitle>Profile</CardTitle>
        <p className="text-muted mt-1 text-xs">
          {profile.phone ? formatPhone(profile.phone) : profile.email} · {profile.trips} trips{profile.rating ? ` · ★ ${profile.rating}` : ""}
        </p>
        <form onSubmit={saveProfile} className="mt-3 space-y-3">
          <Field label="Full name" htmlFor="name"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency" htmlFor="cur">
              <Select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "LRD")}>
                <option value="USD">USD</option><option value="LRD">LRD</option>
              </Select>
            </Field>
            <Field label="Default payment" htmlFor="pay">
              <Select id="pay" value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="cash">Cash</option><option value="orange_money">Orange Money</option><option value="mtn_momo">MTN MoMo</option>
              </Select>
            </Field>
          </div>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button type="submit" loading={saving}>Save</Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Emergency contacts</CardTitle>
        <p className="text-muted mt-1 text-xs">Share your trip with them from the trip screen. Operations can see them if you press SOS.</p>
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-sm">
              <span>{c.name} <span className="text-muted">· {formatPhone(c.phone)}{c.relationship ? ` · ${c.relationship}` : ""}</span></span>
              <button onClick={() => removeContact(c.id)} aria-label={`Remove ${c.name}`} className="text-muted p-2"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
        <form onSubmit={addContact} className="mt-2 grid grid-cols-2 gap-2">
          <Input placeholder="Name" value={cName} onChange={(e) => setCName(e.target.value)} aria-label="Contact name" />
          <Input placeholder="Phone" type="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)} aria-label="Contact phone" />
          <Input placeholder="Relationship (optional)" value={cRel} onChange={(e) => setCRel(e.target.value)} aria-label="Relationship" className="col-span-2" />
          {cErr && <p className="col-span-2 text-xs text-signal-600">{cErr}</p>}
          <Button type="submit" variant="secondary" className="col-span-2">Add contact</Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Saved places</CardTitle>
        {saved.length === 0 && <p className="text-muted mt-1 text-sm">Save Home and Work to book in one tap. You can also star a recent place while booking.</p>}
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {saved.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="text-muted">{savedIcon(p.label)}</span>
              <span className="min-w-0 flex-1"><strong>{p.label}</strong> <span className="text-muted">· {p.address_text}</span></span>
              <button onClick={() => startPlace(p.label)} className="text-muted px-2 text-xs underline">Change</button>
              <button onClick={() => removePlace(p.id)} aria-label={`Remove ${p.label}`} className="text-muted p-2"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          {!has("Home") && <Button size="sm" variant="secondary" onClick={() => startPlace("Home")}><Home className="h-4 w-4" /> Add Home</Button>}
          {!has("Work") && <Button size="sm" variant="secondary" onClick={() => startPlace("Work")}><Briefcase className="h-4 w-4" /> Add Work</Button>}
          <Button size="sm" variant="secondary" onClick={() => startPlace(null)}><Plus className="h-4 w-4" /> Add place</Button>
        </div>
        {placeErr && <Alert tone="danger" className="mt-2">{placeErr}</Alert>}
        {placeLabel && (
          <LocationSearch title={`Set ${placeLabel}`} savedPlaces={places.filter((p) => p.kind === "recent")}
            onUseGps={placeFromGps} onPick={savePlace} onClose={() => setPlaceLabel(null)} />
        )}
      </Card>

      <Card>
        <CardTitle>Drive with LiberiaRide</CardTitle>
        <p className="text-muted mt-1 text-sm">{isDriver ? "Open your driver console." : "Earn with your keke or car. Registration takes a few minutes."}</p>
        <Link href="/driver" className="mt-3 inline-block"><Button variant="secondary">{isDriver ? "Driver console" : "Become a driver"}</Button></Link>
      </Card>
    </>
  );
}
