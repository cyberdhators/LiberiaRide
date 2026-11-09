// Client-generated idempotency keys. One key per *intent* (one tap on "Confirm ride"),
// reused on every retry of that intent, so network retries cannot create duplicate bookings.

export function newIdempotencyKey(prefix = "bk"): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : fallbackUuid();
  return `${prefix}_${uuid}`;
}

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= 8 && key.length <= 100 && /^[A-Za-z0-9_:-]+$/.test(key);
}
