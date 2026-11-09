import { z } from "zod";
import { normalizePhone } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProviderId, paymentProvider, PaymentProviderError, redact } from "@/lib/payments";
import { fail, json, requireApiUser } from "@/lib/api";

const Body = z.object({ bookingId: z.uuid(), msisdn: z.string().min(6).max(20) });

/** Passenger starts a mobile-money collection for a completed trip. Never marks it paid. */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Invalid request.");
  const msisdn = normalizePhone(parsed.data.msisdn);
  if (!msisdn) return fail(400, "Enter a valid mobile-money number.");

  // Ownership check through RLS: the passenger can only see their own payment.
  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, booking_id, method, status, amount_minor, currency, bookings(code, status)")
    .eq("booking_id", parsed.data.bookingId)
    .eq("idempotency_key", `fare:${parsed.data.bookingId}`)
    .eq("payer_id", auth.userId)
    .maybeSingle();
  if (!payment) return fail(404, "No payment due for this trip.");
  if (!isProviderId(payment.method)) return fail(400, "This trip is paid in cash.");
  if (payment.status === "succeeded") return json({ status: "succeeded" });
  if (payment.status === "initiated" || payment.status === "processing") return json({ status: payment.status });

  const provider = paymentProvider(payment.method);
  const unavailable = provider.unavailableReason();
  if (unavailable) return fail(503, unavailable, "provider_unavailable");

  try {
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
    const result = await provider.initiate({
      paymentId: payment.id,
      amountMinor: BigInt(payment.amount_minor),
      currency: payment.currency as "USD" | "LRD",
      msisdn,
      description: `LiberiaRide trip ${(payment.bookings as unknown as { code: string } | null)?.code ?? ""}`.trim(),
      callbackUrl: `${origin}/api/payments/${payment.method}/callback`,
    });
    const admin = createAdminClient();
    const { error } = await admin.rpc("payment_mark_initiated", {
      p_payment_id: payment.id, p_provider: payment.method, p_provider_reference: result.providerReference,
      p_payer_msisdn: msisdn, p_payload: redact(result.raw),
    });
    if (error) return fail(409, "Payment could not be started.");
    return json({ status: "initiated", message: "Approve the payment prompt on your phone." });
  } catch (err) {
    if (err instanceof PaymentProviderError) return fail(502, "The mobile-money service did not accept the request. Try again or pay cash.", "provider_error");
    console.error("[payments] initiate failed", err);
    return fail(500, "Payment could not be started.");
  }
}
