import { createAdminClient } from "@/lib/supabase/admin";
import { isProviderId, paymentProvider, PaymentProviderError, redact } from "@/lib/payments";
import { json } from "@/lib/api";

/**
 * Provider callback (webhook). MTN MoMo callbacks are not signed, so the body is treated as an
 * untrusted HINT: we look the payment up and re-query the provider before recording anything.
 * Always 200 so providers don't retry forever; failures are logged in payment_transactions.
 */
async function handle(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProviderId(provider)) return json({ ok: false }, 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const externalId = typeof body.externalId === "string" ? body.externalId : null;
  if (!externalId || !/^[0-9a-f-]{36}$/i.test(externalId)) return json({ ok: true });

  const admin = createAdminClient();
  const { data: payment } = await admin.from("payments").select("id, provider, provider_reference, status").eq("id", externalId).maybeSingle();
  if (!payment?.provider_reference || payment.provider !== provider) return json({ ok: true });

  try {
    const verified = await paymentProvider(provider).checkStatus(payment.provider_reference);
    if (verified.status !== "pending") {
      await admin.rpc("payment_record_result", {
        p_provider: provider, p_provider_reference: payment.provider_reference, p_status: verified.status,
        p_kind: "webhook", p_failure_reason: verified.reason ?? null,
        p_payload: { callback: redact(body), verified: redact(verified.raw) }, p_signature_valid: null,
      });
    }
  } catch (err) {
    if (!(err instanceof PaymentProviderError)) console.error("[payments] callback error", err);
  }
  return json({ ok: true });
}

export { handle as POST, handle as PUT };
