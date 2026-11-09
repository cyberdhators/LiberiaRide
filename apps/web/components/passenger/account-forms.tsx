"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { formatPhone, normalizePhone } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Button, Card, CardTitle, Field, Input, Select } from "@/components/ui";

interface Profile {
  full_name: string; phone: string | null; email: string | null; preferred_currency: "USD" | "LRD";
  default_payment_method: string; rating: number | null; trips: number;
}
interface Contact { id: string; name: string; phone: string; relationship: string | null }
interface PlaceRow { id: string; label: string; address_text: string }

export function AccountForms({ profile, contacts, places, isDriver }: {
  profile: Profile; contacts: Contact[]; places: PlaceRow[]; isDriver: boolean;
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
        {places.length === 0 ? <p className="text-muted mt-1 text-sm">Save Home or Work from a trip to book faster.</p> : (
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {places.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span><strong>{p.label}</strong> <span className="text-muted">· {p.address_text}</span></span>
                <button onClick={() => removePlace(p.id)} aria-label={`Remove ${p.label}`} className="text-muted p-2"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
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
