// Isolated test of the MTN MoMo adapter with a mocked HTTP layer (no real money moves).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { MtnMomoProvider } = await import("./mtn-momo");

const cfg = { baseUrl: "https://momo.test", subscriptionKey: "sub", apiUser: "user", apiKey: "key", targetEnvironment: "mtnliberia" };

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init ?? {}));
}

describe("MtnMomoProvider", () => {
  it("is unavailable until fully configured (no production defaults)", () => {
    expect(new MtnMomoProvider({}).unavailableReason()).toMatch(/not configured/);
    expect(new MtnMomoProvider(cfg).unavailableReason()).toBeNull();
  });

  it("requests a token, then a requesttopay with the documented headers", async () => {
    const f = mockFetch((url) => {
      if (url.endsWith("/collection/token/")) return Response.json({ access_token: "tok", expires_in: 3600 });
      if (url.endsWith("/collection/v1_0/requesttopay")) return new Response(null, { status: 202 });
      return new Response("no", { status: 404 });
    });
    const p = new MtnMomoProvider({ ...cfg, fetchImpl: f as unknown as typeof fetch });
    const res = await p.initiate({ paymentId: "11111111-1111-1111-1111-111111111111", amountMinor: 92500n, currency: "LRD", msisdn: "+231886123456", description: "Trip LR-1" });

    expect(res.providerReference).toMatch(/^[0-9a-f-]{36}$/);
    const [tokenUrl, tokenInit] = f.mock.calls[0]!;
    expect(tokenUrl).toBe("https://momo.test/collection/token/");
    expect((tokenInit!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("user:key").toString("base64")}`);

    const [, payInit] = f.mock.calls[1]!;
    const h = payInit!.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["X-Target-Environment"]).toBe("mtnliberia");
    expect(h["X-Reference-Id"]).toBe(res.providerReference);
    expect(h["Ocp-Apim-Subscription-Key"]).toBe("sub");
    const body = JSON.parse(String(payInit!.body));
    expect(body).toMatchObject({ amount: "925", currency: "LRD", externalId: "11111111-1111-1111-1111-111111111111", payer: { partyIdType: "MSISDN", partyId: "231886123456" } });
    // The stored payload masks the payer number.
    expect(JSON.stringify(res.raw)).not.toContain("231886123456");
  });

  it("treats anything but 202 as a rejection", async () => {
    const f = mockFetch((url) => url.endsWith("/token/") ? Response.json({ access_token: "t", expires_in: 3600 }) : new Response("bad", { status: 400 }));
    const p = new MtnMomoProvider({ ...cfg, fetchImpl: f as unknown as typeof fetch });
    await expect(p.initiate({ paymentId: "x", amountMinor: 100n, currency: "USD", msisdn: "+231886123456", description: "d" })).rejects.toThrow(/rejected/);
  });

  it.each([
    ["SUCCESSFUL", "succeeded"],
    ["FAILED", "failed"],
    ["PENDING", "pending"],
  ])("maps status %s → %s", async (momo, ours) => {
    const f = mockFetch((url) => url.endsWith("/token/") ? Response.json({ access_token: "t", expires_in: 3600 })
      : Response.json({ status: momo, reason: momo === "FAILED" ? "PAYER_LIMIT_REACHED" : undefined, financialTransactionId: "ft1" }));
    const p = new MtnMomoProvider({ ...cfg, fetchImpl: f as unknown as typeof fetch });
    const r = await p.checkStatus("ref-1");
    expect(r.status).toBe(ours);
    if (momo === "FAILED") expect(r.reason).toBe("PAYER_LIMIT_REACHED");
  });
});
