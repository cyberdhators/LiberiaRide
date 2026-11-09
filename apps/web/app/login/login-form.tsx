"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizePhone } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/client";
import { Alert, Button, Field, Input } from "@/components/ui";

type Channel = "phone" | "email";

function safeNext(raw: string | null): string {
  // Only allow same-site relative paths (prevents open redirects).
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/passenger";
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [channel, setChannel] = useState<Channel>("phone");
  const [identifier, setIdentifier] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") === "link" ? "That sign-in link is invalid or expired. Request a new one." : null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();
    setBusy(true);
    try {
      if (channel === "phone") {
        const phone = normalizePhone(identifier);
        if (!phone) throw new Error("Enter a valid phone number, e.g. 077 012 3456.");
        const { error } = await supabase.auth.signInWithOtp({ phone });
        if (error) throw error;
        setSentTo(phone);
      } else {
        const email = identifier.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address.");
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) throw error;
        setSentTo(email);
      }
    } catch (err) {
      const msg = (err as Error).message ?? "";
      setError(
        /sms|phone provider|unsupported phone/i.test(msg)
          ? "SMS sign-in is not available yet. Please use email instead."
          : /rate|too many/i.test(msg)
            ? "Too many attempts. Please wait a minute and try again."
            : msg || "Could not send the code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error } =
      channel === "phone"
        ? await supabase.auth.verifyOtp({ phone: sentTo, token: code.trim(), type: "sms" })
        : await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) {
      setError("That code is wrong or has expired.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (sentTo) {
    return (
      <form onSubmit={verify} className="mt-6 space-y-4">
        <Alert tone="info">
          {channel === "phone" ? <>Enter the code sent to <strong>{sentTo}</strong>.</> : <>Open the link we emailed to <strong>{sentTo}</strong>, or enter the code from that email.</>}
        </Alert>
        <Field label="Code" htmlFor="code">
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Verify and continue</Button>
        <button type="button" className="text-muted w-full text-sm underline" onClick={() => { setSentTo(null); setCode(""); }}>
          Use a different {channel === "phone" ? "number" : "email"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={send} className="mt-6 space-y-4">
      <div className="surface grid grid-cols-2 rounded-xl border border-line p-1 text-sm font-semibold" role="tablist">
        {(["phone", "email"] as const).map((c) => (
          <button key={c} type="button" role="tab" aria-selected={channel === c}
            className={`rounded-lg py-2 ${channel === c ? "bg-brand-600 text-white" : "text-muted"}`}
            onClick={() => { setChannel(c); setIdentifier(""); setError(null); }}>
            {c === "phone" ? "Phone" : "Email"}
          </button>
        ))}
      </div>
      {channel === "phone" ? (
        <Field label="Phone number" htmlFor="id" hint="Liberian numbers can start with 0 — we add +231.">
          <Input id="id" type="tel" inputMode="tel" autoComplete="tel" placeholder="077 012 3456"
            value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        </Field>
      ) : (
        <Field label="Email" htmlFor="id">
          <Input id="id" type="email" autoComplete="email" placeholder="you@example.com"
            value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        </Field>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" className="w-full" loading={busy}>Send code</Button>
    </form>
  );
}
