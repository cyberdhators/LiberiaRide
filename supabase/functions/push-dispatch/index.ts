// push-dispatch — sends queued Web Push alerts (see migration 0028).
//
// Called by the database (pg_net) with the `x-push-key` shared secret from
// Vault; deployed with verify_jwt = false because that key is the auth.
// Pushes carry no payload: the service worker fetches the text from
// /api/push/latest with the user's own session, so nothing private crosses
// the push service and no payload encryption is needed.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { generateVapidKeys, vapidAuthorization } from "./vapid.ts";

interface Vapid { private_jwk: JsonWebKey; public_key: string; subject: string }
interface Job { outbox_id: number; subscription_id: string; endpoint: string; urgent: boolean; ttl_seconds: number }

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: allowed } = await db.rpc("push_check_key", { p_key: req.headers.get("x-push-key") ?? "" });
  if (allowed !== true) return new Response("forbidden", { status: 403 });

  // The key pair is created on the first run and kept in Vault.
  let { data: vapid } = await db.rpc("push_vapid") as { data: Vapid | null };
  if (!vapid?.public_key) {
    const k = await generateVapidKeys();
    ({ data: vapid } = await db.rpc("push_set_vapid", { p_private_jwk: k.privateJwk, p_public_key: k.publicKey }) as { data: Vapid | null });
  }
  if (!vapid?.public_key) return Response.json({ error: "vapid keys unavailable" }, { status: 500 });

  const statuses: Record<string, number> = {};
  for (let round = 0; round < 5; round++) {
    const { data: jobs, error } = await db.rpc("push_claim_batch", { p_limit: 100 }) as { data: Job[] | null; error: unknown };
    if (error) return Response.json({ error: String((error as { message?: string }).message ?? error) }, { status: 500 });
    if (!jobs?.length) break;

    const results = await Promise.all(jobs.map(async (j) => {
      let status = 0;
      try {
        const res = await fetch(j.endpoint, {
          method: "POST",
          headers: {
            Authorization: await vapidAuthorization(j.endpoint, vapid!.private_jwk, vapid!.public_key, vapid!.subject),
            TTL: String(Math.max(0, j.ttl_seconds)),
            Urgency: j.urgent ? "high" : "normal",
            "Content-Length": "0",
          },
        });
        status = res.status;
        await res.body?.cancel();
      } catch {
        status = 0; // network error: counted as a failure, retried on the next push
      }
      statuses[status] = (statuses[status] ?? 0) + 1;
      return { subscription_id: j.subscription_id, status };
    }));
    await db.rpc("push_report", { p_results: results });
  }
  return Response.json({ statuses });
});
