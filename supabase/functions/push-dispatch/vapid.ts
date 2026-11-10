// VAPID (RFC 8292) for payload-less Web Push. WebCrypto only, so it runs in
// Deno (Edge Functions) and in Node 20+ (unit tests) unchanged.

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** New P-256 key pair: private key as JWK, public key as base64url uncompressed point (applicationServerKey). */
export async function generateVapidKeys(): Promise<{ privateJwk: JsonWebKey; publicKey: string }> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { privateJwk, publicKey: b64url(raw) };
}

/** `Authorization` header value for one push request (ES256 JWT, 12 h validity). */
export async function vapidAuthorization(
  endpoint: string, privateJwk: JsonWebKey, publicKey: string, subject: string, nowS = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowS + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto returns the raw r||s (64 bytes) signature that JWS ES256 expects.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${publicKey}`;
}
