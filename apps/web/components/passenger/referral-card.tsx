"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Share2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Badge, Button, Card, Input } from "@/components/ui";

export interface Referral {
  code: string; reward_bps: number; referred_by: string | null; can_apply: boolean; friends_rewarded: number;
  coupons: { code: string; used: boolean }[];
}

/** Invite friends (share my code), enter a friend's code once (new riders only), and my ride-discount codes. */
export function ReferralCard({ referral, siteUrl }: { referral: Referral; siteUrl: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const pct = `${referral.reward_bps / 100}%`;

  async function share() {
    const text = `Ride with LiberiaRide — use my code ${referral.code} and we both get ${pct} off a ride after your first trip.`;
    const url = siteUrl || window.location.origin;
    if (navigator.share) await navigator.share({ title: "LiberiaRide", text, url }).catch(() => undefined);
    else { await navigator.clipboard.writeText(`${text} ${url}`); setOk("Invite copied — paste it in a message."); }
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc("apply_referral_code", { p_code: code });
    setBusy(false);
    if (error) return setError(userMessage(error));
    setOk(`Code from ${(data as { referrer: string }).referrer} saved. You both get ${pct} off a ride after your first trip.`);
    router.refresh();
  }

  return (
    <Card className="space-y-3 p-3">
      <p className="flex items-center gap-2 font-semibold"><Gift className="h-4 w-4 text-brand-600" aria-hidden /> Invite friends</p>
      <p className="text-muted text-sm">When a friend uses your code and finishes their first ride, you both get {pct} off a ride.</p>
      <div className="flex items-center gap-2">
        <span className="rounded-lg border border-line px-3 py-2 font-mono text-lg font-bold tracking-widest" aria-label="Your referral code">{referral.code}</span>
        <Button variant="secondary" onClick={share}><Share2 className="h-4 w-4" /> Share</Button>
      </div>
      {referral.friends_rewarded > 0 && <p className="text-muted text-xs">{referral.friends_rewarded} friend{referral.friends_rewarded === 1 ? "" : "s"} rode with your code.</p>}

      {referral.can_apply && (
        <form className="flex gap-2" onSubmit={apply}>
          <Input aria-label="Friend's referral code" placeholder="Friend's code" value={code} maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <Button type="submit" variant="secondary" loading={busy} disabled={code.length !== 6}>Use code</Button>
        </form>
      )}
      {referral.referred_by && <p className="text-muted text-xs">Invited by {referral.referred_by}.</p>}

      {referral.coupons.length > 0 && (
        <div>
          <p className="text-sm font-medium">Your ride discounts</p>
          <ul className="mt-1 space-y-1">
            {referral.coupons.map((c) => (
              <li key={c.code} className="flex items-center justify-between text-sm">
                <span className="font-mono">{c.code}</span>
                {c.used ? <Badge>used</Badge> : <Badge tone="ok">{pct} off · enter it as a promo code</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {ok && <Alert tone="ok">{ok}</Alert>}
    </Card>
  );
}
