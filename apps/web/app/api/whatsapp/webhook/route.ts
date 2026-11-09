import { after } from "next/server";
import { serverEnv } from "@/lib/server-env";
import { whatsappConfigured } from "@/lib/whatsapp/client";
import { parseWebhook, verifySignature } from "@/lib/whatsapp/protocol";
import { flushOutbox, handleInbound } from "@/lib/whatsapp/bot";
import { createAdminClient } from "@/lib/supabase/admin";

/** Meta webhook verification handshake. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = serverEnv().WHATSAPP_VERIFY_TOKEN;
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Inbound messages. The raw body is HMAC-verified with the app secret before anything is parsed.
 * We acknowledge immediately (Meta expects a fast 200) and process after the response.
 */
export async function POST(request: Request) {
  if (!whatsappConfigured()) return new Response("Not configured", { status: 503 });
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), serverEnv().WHATSAPP_APP_SECRET!)) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const { messages, statuses } = parseWebhook(payload);

  after(async () => {
    for (const m of messages) {
      try {
        await handleInbound(m);
      } catch (err) {
        console.error("[whatsapp] handling failed", m.id, err);
      }
    }
    if (statuses.length) {
      const admin = createAdminClient();
      for (const s of statuses) await admin.from("whatsapp_messages").update({ status: s.status }).eq("wa_message_id", s.id);
    }
    await flushOutbox().catch(() => undefined);
  });
  return new Response("OK", { status: 200 });
}
