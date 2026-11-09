// Pure helpers for the Meta WhatsApp Cloud API (no I/O, unit-tested).
import { createHmac, timingSafeEqual } from "node:crypto";

/** Validate X-Hub-Signature-256 ("sha256=<hex>") = HMAC-SHA256(app secret, raw request body). */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type Inbound =
  | { kind: "text"; id: string; from: string; name: string | null; text: string; timestamp: number }
  | { kind: "location"; id: string; from: string; name: string | null; lat: number; lng: number; label: string | null; timestamp: number }
  | { kind: "button"; id: string; from: string; name: string | null; buttonId: string; title: string; timestamp: number }
  | { kind: "unsupported"; id: string; from: string; name: string | null; type: string; timestamp: number };

export interface StatusUpdate { id: string; status: string; recipient: string }

/** Flatten a webhook payload into inbound messages and delivery statuses. */
export function parseWebhook(payload: unknown): { messages: Inbound[]; statuses: StatusUpdate[] } {
  const messages: Inbound[] = [];
  const statuses: StatusUpdate[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contacts = (value.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
      const nameOf = (wa: string) => contacts.find((c) => c.wa_id === wa)?.profile?.name ?? null;
      for (const m of (value.messages as Record<string, unknown>[] | undefined) ?? []) {
        const base = { id: String(m.id), from: String(m.from), name: nameOf(String(m.from)), timestamp: Number(m.timestamp ?? 0) };
        if (m.type === "text") {
          messages.push({ ...base, kind: "text", text: String((m.text as { body?: string })?.body ?? "").slice(0, 500) });
        } else if (m.type === "location") {
          const l = m.location as { latitude: number; longitude: number; name?: string; address?: string };
          messages.push({ ...base, kind: "location", lat: Number(l.latitude), lng: Number(l.longitude), label: [l.name, l.address].filter(Boolean).join(", ") || null });
        } else if (m.type === "interactive") {
          const i = m.interactive as { type?: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
          const reply = i.button_reply ?? i.list_reply;
          if (reply) messages.push({ ...base, kind: "button", buttonId: reply.id, title: reply.title });
          else messages.push({ ...base, kind: "unsupported", type: `interactive:${i.type}` });
        } else {
          messages.push({ ...base, kind: "unsupported", type: String(m.type) });
        }
      }
      for (const s of (value.statuses as Record<string, unknown>[] | undefined) ?? []) {
        statuses.push({ id: String(s.id), status: String(s.status), recipient: String(s.recipient_id) });
      }
    }
  }
  return { messages, statuses };
}

export type Intent = "start" | "cancel" | "help" | "status" | "agent" | "other";

export function intentOf(text: string): Intent {
  const t = text.trim().toLowerCase();
  if (/^(hi|hello|hey|start|book|ride|menu|new)\b/.test(t)) return "start";
  if (/^(cancel|stop)\b/.test(t)) return "cancel";
  if (/^(help|\?)$/.test(t)) return "help";
  if (/^(status|where)\b/.test(t)) return "status";
  if (/^(agent|human|support)\b/.test(t)) return "agent";
  return "other";
}

// ----- outbound message bodies -----
export const text = (to: string, body: string) => ({
  messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: body.slice(0, 4096) },
});

export const buttons = (to: string, body: string, options: { id: string; title: string }[]) => ({
  messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive",
  interactive: {
    type: "button",
    body: { text: body.slice(0, 1024) },
    action: { buttons: options.slice(0, 3).map((o) => ({ type: "reply", reply: { id: o.id.slice(0, 256), title: o.title.slice(0, 20) } })) },
  },
});

export const locationRequest = (to: string, body: string) => ({
  messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive",
  interactive: { type: "location_request_message", body: { text: body.slice(0, 1024) }, action: { name: "send_location" } },
});
