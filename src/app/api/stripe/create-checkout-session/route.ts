import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";
import { findPlan } from "@/lib/plans";

/**
 * POST /api/stripe/create-checkout-session
 *
 *   ⚠ POST-ONLY. GET returns HTTP 405.
 *   DO NOT present this as a browser QA URL — use the member-home
 *   Buy button (which POSTs here) or /api/admin/purchase-health for
 *   GET-safe diagnostics.
 *
 * Body: { memberSlug: string, planId: string }
 *
 * Flow:
 *   1. Validate body + resolve plan from PLAN_OPTIONS.
 *   2. Resolve member by slug. 404 if missing.
 *   3. If STRIPE_SECRET_KEY present → create a test-mode Stripe
 *      Checkout Session with price_data line item + metadata
 *      (memberSlug, planId) + success/cancel URLs. Return { mode:
 *      "stripe", url }.
 *   4. Else → return { mode: "fake", ok: true } so the client can
 *      follow up with /api/dev/fake-purchase.
 *
 * Stripe secret never leaves the server.
 */

export const runtime = "nodejs";

type Body = { memberSlug?: string; planId?: string };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.memberSlug || !body?.planId) {
    return NextResponse.json(
      { ok: false, error: "memberSlug and planId required" },
      { status: 400 },
    );
  }
  const { memberSlug, planId } = body;

  const plan = findPlan(planId);
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: `Unknown plan: ${planId}` },
      { status: 400 },
    );
  }

  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 503 },
    );
  }

  const { data: member, error: memErr } = await client
    .from("members")
    .select("id, slug")
    .eq("slug", memberSlug)
    .single();
  if (memErr || !member) {
    return NextResponse.json(
      { ok: false, error: `Member not found: ${memberSlug}` },
      { status: 404 },
    );
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    // Fake mode. The client is expected to follow up with a POST
    // to /api/dev/fake-purchase so the outcome card + store refresh
    // fire in the same tab. We intentionally do NOT call applyPurchase
    // here — keeping the two endpoints cleanly separated per the v0.13.0
    // spec.
    return NextResponse.json({ ok: true, mode: "fake", planId: plan.id });
  }

  const stripe = new Stripe(stripeKey);
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: plan.price ?? 5000,
            product_data: {
              name: plan.name,
              description: plan.description,
            },
          },
        },
      ],
      success_url: `${baseUrl}/my/${memberSlug}?purchase=success&plan=${encodeURIComponent(plan.id)}`,
      cancel_url: `${baseUrl}/my/${memberSlug}?purchase=cancel`,
      metadata: {
        memberSlug,
        planId: plan.id,
      },
    });
    return NextResponse.json({
      ok: true,
      mode: "stripe",
      url: session.url,
      sessionId: session.id,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stripe session create failed";
    console.error("[create-checkout-session] Stripe error:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
