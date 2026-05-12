import { NextResponse } from "next/server";
import Stripe from "stripe";
import { applyPurchase } from "@/lib/entitlements/applyPurchase";
import { logger } from "@/lib/logger";
import { getSupabaseServiceClient } from "@/lib/supabase";

import { wrapRouteHandlerWithSentry } from "@sentry/nextjs";
/**
 * POST /api/stripe/webhook
 *
 *   ⚠ POST-ONLY. GET returns HTTP 405.
 *   Called ONLY by Stripe's backend with a signed `stripe-signature`
 *   header. DO NOT open in a browser; diagnostics for the purchase
 *   path live at /api/admin/purchase-health instead.
 *
 * Single event handled: `checkout.session.completed`.
 *
 * Signature verification via STRIPE_WEBHOOK_SECRET is mandatory — if
 * either STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY is missing we
 * return 503 and Stripe retries later. This route is a no-op in fake
 * mode (no webhooks fire).
 *
 * Idempotency is handled by applyPurchase via the
 * UNIQUE(external_id) constraint on the `purchases` table. Stripe
 * retries the same event up to 3 times with the same session id, and
 * every retry beyond the first short-circuits to
 * { alreadyProcessed: true } with NO mutation to the members row.
 */

export const runtime = "nodejs";

export const POST = wrapRouteHandlerWithSentry(
  async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !stripeKey) {
    return NextResponse.json(
      { received: false, error: "Stripe webhook not configured" },
      { status: 503 },
    );
  }

  // Read raw body BEFORE any JSON parsing — Stripe signature
  // verification requires the exact bytes Stripe sent.
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { received: false, error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  const stripe = new Stripe(stripeKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid Stripe signature";
    logger.error({ event: "stripe_webhook_signature_verify_failed", message });
    return NextResponse.json(
      { received: false, error: `Invalid signature: ${message}` },
      { status: 400 },
    );
  }

  if (event.type !== "checkout.session.completed") {
    // Acknowledge everything else so Stripe stops retrying. Only the
    // one event type matters for fulfillment today.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const memberSlug = session.metadata?.memberSlug;
  const planId = session.metadata?.planId;

  if (!memberSlug || !planId) {
    // Metadata was lost or this session wasn't created by our
    // /api/stripe/create-checkout-session. 200 so Stripe stops
    // retrying; we can't do anything useful with it anyway.
    return NextResponse.json({
      received: true,
      skipped: "missing memberSlug/planId metadata",
    });
  }

  // Intentional cross-tenant exception (v0.23.0 / ADR-0001 Decision 1):
  // the Stripe webhook is server-to-server with no caller session, so
  // current_studio_id() would return NULL and every RLS-gated query
  // would yield empty results. Service role bypasses RLS — required
  // for this surface. studio_id comes from event metadata (Sprint C)
  // / the member row, not from current_studio_id(). Do NOT switch to
  // scopedQuery() or getSupabaseClient() here.
  const client = getSupabaseServiceClient();
  if (!client) {
    // 500 so Stripe retries — Supabase should be configured in prod.
    // SUPABASE_SERVICE_ROLE_KEY must be set in Vercel Production scope.
    return NextResponse.json(
      { received: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }

  const { data: member } = await client
    .from("members")
    .select("id")
    .eq("slug", memberSlug)
    .single();
  if (!member) {
    // Don't retry — the member doesn't exist and won't spontaneously
    // appear. 200 keeps Stripe's retry queue clean.
    return NextResponse.json({
      received: true,
      skipped: `member not found: ${memberSlug}`,
    });
  }

  const result = await applyPurchase({
    memberId: member.id,
    planId,
    source: "stripe",
    externalId: session.id,
  });

  if (!result.ok) {
    // 500 so Stripe retries — this is a real failure, not a
    // known-skip case.
    logger.error({
      event: "stripe_webhook_apply_purchase_failed",
      error: result.error,
    });
    return NextResponse.json(
      { received: false, error: result.error },
      { status: 500 },
    );
  }

  return NextResponse.json({
    received: true,
    alreadyProcessed: result.alreadyProcessed,
    purchaseId: result.purchaseId,
    planTypeApplied: result.planTypeApplied,
    creditsRemaining: result.creditsRemaining,
  });
},
  { method: "POST", parameterizedRoute: "/api/stripe/webhook" },
);
