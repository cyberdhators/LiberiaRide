import { timingSafeEqual } from "node:crypto";
import { whatsappConfigured } from "@/lib/whatsapp/client";
import { flushOutbox } from "@/lib/whatsapp/bot";

/**
 * Delivers queued WhatsApp booking updates. Called by Vercel Cron (Authorization: Bearer CRON_SECRET)
 * and opportunistically after every inbound webhook.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!whatsappConfigured()) return Response.json({ skipped: "whatsapp not configured" });
  return Response.json(await flushOutbox(50));
}
