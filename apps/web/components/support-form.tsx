"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Button, Card, CardTitle, Field, Select, Textarea } from "@/components/ui";

const COMPLAINT_CATEGORIES = [
  ["driver_behaviour", "Driver behaviour"], ["passenger_behaviour", "Passenger behaviour"], ["fare", "Fare or charge"],
  ["payment", "Payment"], ["vehicle", "Vehicle condition"], ["route", "Route taken"], ["lost_item", "Lost item"],
  ["app", "App problem"], ["other", "Other"],
] as const;

const INCIDENT_KINDS = [["safety", "Felt unsafe"], ["accident", "Accident"], ["harassment", "Harassment"], ["vehicle", "Vehicle problem"], ["other", "Other"]] as const;

/** Complaints and safety incident reports (shared by passenger and driver apps). */
export function SupportForm({ bookingId }: { bookingId: string | null }) {
  const [mode, setMode] = useState<"complaint" | "incident">("complaint");
  const [category, setCategory] = useState<string>("fare");
  const [kind, setKind] = useState<string>("safety");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 5) return setResult({ tone: "danger", text: "Please describe what happened." });
    setBusy(true);
    const supabase = createClient();
    const { error } = mode === "complaint"
      ? await supabase.rpc("file_complaint", { p_booking_id: bookingId, p_category: category, p_description: text.trim() })
      : await supabase.rpc("report_incident", { p_booking_id: bookingId, p_kind: kind, p_description: text.trim(), p_severity: 3 });
    setBusy(false);
    if (error) return setResult({ tone: "danger", text: userMessage(error) });
    setText("");
    setResult({ tone: "ok", text: "Thank you. Our team will review this and contact you if needed." });
  }

  return (
    <Card>
      <CardTitle>{bookingId ? "Report a problem with this trip" : "Contact support"}</CardTitle>
      <div className="surface-muted mt-3 grid grid-cols-2 rounded-xl p-1 text-sm font-semibold">
        <button type="button" onClick={() => setMode("complaint")} className={`rounded-lg py-2 ${mode === "complaint" ? "surface shadow-sm" : "text-muted"}`}>Complaint</button>
        <button type="button" onClick={() => setMode("incident")} className={`rounded-lg py-2 ${mode === "incident" ? "surface shadow-sm" : "text-muted"}`}>Safety incident</button>
      </div>
      <form onSubmit={submit} className="mt-3 space-y-3">
        {mode === "complaint" ? (
          <Field label="Topic" htmlFor="cat">
            <Select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {COMPLAINT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        ) : (
          <>
            <Alert tone="warn">In immediate danger? Use the SOS button on your trip screen or call 911.</Alert>
            <Field label="What happened" htmlFor="kind">
              <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {INCIDENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </>
        )}
        <Field label="Details" htmlFor="details">
          <Textarea id="details" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        </Field>
        {result && <Alert tone={result.tone}>{result.text}</Alert>}
        <Button type="submit" loading={busy}>Submit</Button>
      </form>
    </Card>
  );
}
