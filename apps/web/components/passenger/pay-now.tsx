"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizePhone } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Button, Card, Input } from "@/components/ui";

/** Mobile-money collection after the trip. Success is shown only after the server verified it with the provider. */
export function PayNow({ bookingId, method, status, defaultMsisdn }: {
  bookingId: string; method: string; status: string; defaultMsisdn: string | null;
}) {
  const router = useRouter();
  const [msisdn, setMsisdn] = useState(defaultMsisdn ?? "");
  const [state, setState] = useState(status);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger" | "ok"; text: string } | null>(null);
  const polls = useRef(0);

  useEffect(() => {
    if (state !== "initiated" && state !== "processing") return;
    const t = setInterval(async () => {
      polls.current++;
      const res = await fetch("/api/payments/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId }) });
      const body = await res.json().catch(() => ({}));
      if (body.status && body.status !== state) {
        setState(body.status);
        if (body.status === "succeeded") { setMessage({ tone: "ok", text: "Payment received. Thank you!" }); router.refresh(); }
        if (body.status === "failed") setMessage({ tone: "danger", text: body.reason ? `Payment failed: ${body.reason}` : "Payment failed or was declined." });
      }
      if (polls.current > 40) clearInterval(t); // ~3 minutes
    }, 4500);
    return () => clearInterval(t);
  }, [state, bookingId, router]);

  async function pay() {
    const phone = normalizePhone(msisdn);
    if (!phone) return setMessage({ tone: "danger", text: "Enter your mobile-money number." });
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/payments/initiate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId, msisdn: phone }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "danger", text: body?.error?.message ?? "Payment could not be started." });
    polls.current = 0;
    setState(body.status);
    setMessage({ tone: "info", text: body.message ?? "Approve the prompt on your phone." });
  }

  async function switchToCash() {
    setBusy(true);
    const { error } = await createClient().rpc("passenger_switch_to_cash", { p_booking_id: bookingId });
    setBusy(false);
    if (error) return setMessage({ tone: "danger", text: userMessage(error) });
    router.refresh();
  }

  if (state === "succeeded") return <Alert tone="ok">Paid with {method === "mtn_momo" ? "MTN MoMo" : "Orange Money"}.</Alert>;

  return (
    <Card className="space-y-2 p-3">
      <p className="font-semibold">Pay with {method === "mtn_momo" ? "MTN MoMo" : "Orange Money"}</p>
      {state === "initiated" || state === "processing" ? (
        <p className="text-muted text-sm">Waiting for you to approve the payment on your phone…</p>
      ) : (
        <div className="flex gap-2">
          <Input type="tel" inputMode="tel" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="088 123 4567" aria-label="Mobile-money number" />
          <Button loading={busy} onClick={pay}>Pay</Button>
        </div>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <button className="text-muted text-xs underline" onClick={switchToCash} disabled={busy}>Pay the driver in cash instead</button>
    </Card>
  );
}
