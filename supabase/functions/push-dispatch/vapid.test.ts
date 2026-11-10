import { describe, expect, it } from "vitest";
import { b64url, fromB64url, generateVapidKeys, vapidAuthorization } from "./vapid";

const dec = new TextDecoder();

describe("VAPID", () => {
  it("produces a verifiable ES256 JWT for the push service origin", async () => {
    const { privateJwk, publicKey } = await generateVapidKeys();
    const raw = fromB64url(publicKey);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(4); // uncompressed point, as PushManager.subscribe expects

    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc:def", privateJwk, publicKey, "mailto:ops@example.org", 1_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, s, k] = m!;
    expect(k).toBe(publicKey);
    expect(JSON.parse(dec.decode(fromB64url(h!)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(dec.decode(fromB64url(c!)))).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_000_000 + 43_200, sub: "mailto:ops@example.org" });

    const sig = fromB64url(s!);
    expect(sig.length).toBe(64);
    const pub = await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("base64url round-trips without padding", () => {
    const bytes = Uint8Array.from([0, 250, 251, 252, 253, 254, 255]);
    const s = b64url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect([...fromB64url(s)]).toEqual([...bytes]);
  });
});
