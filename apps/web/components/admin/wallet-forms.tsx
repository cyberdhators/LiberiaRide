"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseMajor } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Button, Input, Select } from "@/components/ui";

/** Record money a driver paid in (office cash, MoMo transfer, bank). Idempotent on the receipt reference. */
export function TopupForm({ driverId, currency }: { driverId: string; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ amount: "", method: "cash", reference: "", note: "" });

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record top-up</Button>;
  return (
    <form className="mt-2 grid gap-2 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        let minor: bigint;
        try { minor = parseMajor(f.amount, currency as "USD" | "LRD").minor; } catch { minor = 0n; }
        if (minor <= 0n) return setError("Enter the amount received.");
        setBusy(true);
        setError(null);
        const { error } = await createClient().rpc("admin_record_driver_topup", {
          p_driver_id: driverId, p_currency: currency, p_amount_minor: Number(minor), p_method: f.method,
          p_reference: f.reference, p_note: f.note || null,
        });
        setBusy(false);
        if (error) return setError(userMessage(error, error.message));
        setOpen(false);
        setF({ amount: "", method: "cash", reference: "", note: "" });
        router.refresh();
      }}>
      <Input inputMode="decimal" placeholder={`Amount (${currency})`} aria-label="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
      <Select aria-label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
        <option value="cash">Cash at office</option>
        <option value="mtn_momo">MTN MoMo transfer</option>
        <option value="orange_money">Orange Money transfer</option>
        <option value="bank">Bank</option>
        <option value="other">Other</option>
      </Select>
      <Input placeholder="Receipt / transaction no." aria-label="Reference" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} required minLength={3} />
      <Input placeholder="Note (optional)" aria-label="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

/** Signed correction to a driver's balance (e.g. reverse an over-credit). Reason required; audited. */
export function AdjustForm({ driverId, currency }: { driverId: string; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ direction: "debit", amount: "", reason: "" });

  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Correct balance</Button>;
  return (
    <form className="mt-2 grid gap-2 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        let minor: bigint;
        try { minor = parseMajor(f.amount, currency as "USD" | "LRD").minor; } catch { minor = 0n; }
        if (minor <= 0n) return setError("Enter the amount.");
        setBusy(true);
        setError(null);
        const { error } = await createClient().rpc("admin_wallet_adjustment", {
          p_driver_id: driverId, p_currency: currency, p_amount_minor: Number(f.direction === "debit" ? -minor : minor), p_reason: f.reason,
        });
        setBusy(false);
        if (error) return setError(userMessage(error, error.message));
        setOpen(false);
        setF({ direction: "debit", amount: "", reason: "" });
        router.refresh();
      }}>
      <Select aria-label="Direction" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
        <option value="debit">Deduct from driver</option>
        <option value="credit">Add to driver</option>
      </Select>
      <Input inputMode="decimal" placeholder={`Amount (${currency})`} aria-label="Adjustment amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
      <Input className="sm:col-span-2" placeholder="Reason (shown to the driver)" aria-label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} />
      {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
