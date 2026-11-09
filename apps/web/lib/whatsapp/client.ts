import "server-only";
import { serverEnv } from "@/lib/server-env";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";

export function whatsappConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN);
}

/** POST /{phone-number-id}/messages on the Graph API. Returns the WhatsApp message id. */
export async function sendWhatsApp(body: Record<string, unknown>): Promise<string> {
  const env = serverEnv();
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${json.error?.message ?? "unknown"}`);
  return json.messages?.[0]?.id ?? "";
}
