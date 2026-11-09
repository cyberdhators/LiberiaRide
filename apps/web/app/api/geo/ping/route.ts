import { z } from "zod";
import { normalizePingInput } from "@liberia-ride/geospatial";
import { qls } from "@/lib/qls";
import { fail, json, qlsBudgetExceeded, qlsFailure, requireApiUser } from "@/lib/api";

const Body = z.object({ pin: z.string().trim().min(3).max(200) });

/** Resolve a shared QuantumLoc Ping (live pin). Never cached: pins move and can be switched off. */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !normalizePingInput(parsed.data.pin)) {
    return fail(400, "Paste a Ping link like https://quantumloc.io/p/abc123.");
  }
  const budget = await qlsBudgetExceeded(auth.userId);
  if (budget) return fail(429, budget, "rate_limited");
  const providers = qls(auth.userId);
  if (!providers.configured) return fail(503, "Ping lookup is temporarily unavailable.", "not_configured");
  try {
    return json({ result: await providers.location.resolvePing(parsed.data.pin) });
  } catch (err) {
    return qlsFailure(err);
  }
}
