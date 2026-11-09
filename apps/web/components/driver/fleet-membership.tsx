"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Button, Card, CardTitle, Input } from "@/components/ui";

/** Driver joins a fleet with the operator's code (consent) or leaves it. All checks are in the database. */
export function FleetMembership({ fleetName }: { fleetName: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("driver_join_fleet", { p_code: code });
    setBusy(false);
    if (error) return setError(userMessage(error));
    setCode("");
    router.refresh();
  }

  async function leave() {
    if (!window.confirm(`Leave ${fleetName}? The fleet owner will be notified.`)) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("driver_leave_fleet");
    setBusy(false);
    if (error) return setError(userMessage(error));
    router.refresh();
  }

  return (
    <Card>
      <CardTitle>Fleet</CardTitle>
      {fleetName ? (
        <>
          <p className="mt-1 text-sm">You drive for <strong>{fleetName}</strong>. The fleet owner can see your status, trips and earnings.</p>
          <Button variant="secondary" size="sm" className="mt-3" loading={busy} onClick={leave}>Leave fleet</Button>
        </>
      ) : (
        <form onSubmit={join} className="mt-1 space-y-2">
          <p className="text-muted text-sm">Driving a fleet owner&apos;s keke or car? Enter the code they gave you. They will see your status, trips and earnings.</p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Fleet code" aria-label="Fleet code"
              maxLength={12} autoCapitalize="characters" autoComplete="off" required />
            <Button type="submit" loading={busy}>Join</Button>
          </div>
        </form>
      )}
      {error && <Alert tone="danger" className="mt-2">{error}</Alert>}
    </Card>
  );
}
