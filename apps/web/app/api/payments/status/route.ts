import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProviderId, paymentProvider, PaymentProviderError, redact } from "@/lib/payments";
import { fail, json, requireApiUser } from "@/lib/api";

const Body = z.object({ bookingId: z.uuid() });

/** Passenger polls; the server asks the PROVIDER and records only a verified result. */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Invalid request.");

  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, method, status, provider_reference")
    .eq("booking_id", parsed.data.bookingId)
    .eq("idempotency_key", `fare:${parsed.data.bookingId}`)
    .eq("payer_id", auth.userId)
    .maybeSingle();
  if (!payment) return fail(404, "No payment for this trip.");
  if (payment.status === "succeeded" || payment.status === "failed" || !payment.provider_reference || !isProviderId(payment.method)) {
    return json({ status: payment.status });
  }

  try {
    const result = await paymentProvider(payment.method).checkStatus(payment.provider_reference);
    if (result.status === "pending") return json({ status: payment.status });
    const { data, error } = await createAdminClient().rpc("payment_record_result", {
      p_provider: payment.method, p_provider_reference: payment.provider_reference,
      p_status: result.status, p_kind: "verify", p_failure_reason: result.reason ?? null,
      p_payload: redact(result.raw), p_signature_valid: null,
    });
    if (error) return fail(500, "Could not record the payment result.");
    return json({ status: (data as { status: string }).status, reason: result.reason ?? null });
  } catch (err) {
    if (err instanceof PaymentProviderError) return json({ status: payment.status, notice: "Still waiting for the mobile-money service." });
    throw err;
  }
}
