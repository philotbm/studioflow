import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { requireMemberAccessForRequest } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { planDescription, type Plan } from "@/lib/plans";

import { wrapRouteHandlerWithSentry } from "@sentry/nextjs";
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
 * v0.20.0 auth: requires an `Authorization: Bearer <access_token>`
 * header. The token is validated against Supabase Auth, then the
 * authenticated user must own the requested memberSlug
 * (members.user_id === auth.uid()). Mismatch → 403.
 *
 * Flow:
 *   1. Verify Bearer token + slug ownership (403 on miss).
 *   2. Validate body + resolve plan from the DB `plans` table.
 *   3. Resolve member by slug. 404 if missing.
 *   4. If STRIPE_SECRET_KEY present → create a test-mode Stripe
 *      Checkout Session with price_data line item + metadata
 *      (memberSlug, planId) + success/cancel URLs. Return { mode:
 *      "stripe", url }.
 *   5. Else → return { mode: "fake", ok: true } so the client can
 *      follow up with /api/dev/fake-purchase.
 *
 * Stripe secret never leaves the server. The webhook
 * (/api/stripe/webhook) is server-to-server and stays unauthenticated
 * here — it has its own signing-secret check.
 */

export const runtime = "nodejs";

type Body = { memberSlug?: string; planId?: string };

export const POST = wrapRouteHandlerWithSentry(
  async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.memberSlug || !body?.planId) {
    return NextResponse.json(
      { ok: false, error: "memberSlug and planId required" },
      { status: 400 },
    );
  }
  const { memberSlug, planId } = body;

  // v0.20.0: only the authenticated owner of memberSlug may start a
  // checkout session for it. requireMemberAccessForRequest validates
  // the Bearer token and the slug ownership in one call.
  const owner = await requireMemberAccessForRequest(req, memberSlug);
  if (!owner) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  // Intentional Bearer-auth exception (v0.23.0 / ADR-0001 Decision 1):
  // this route authenticates via the Authorization: Bearer header (the
  // member's access token validated above by requireMemberAccessForRequest),
  // not the cookie session that scopedQuery() relies on for
  // current_studio_id(). Service role bypasses RLS — required for this
  // surface. studio_id is resolved from the validated member row.
  // SUPABASE_SERVICE_ROLE_KEY must be set in Vercel Production scope.
  const client = getSupabaseServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 503 },
    );
  }

  const { data: member, error: memErr } = await client
    .from("members")
    .select("id, slug, studio_id")
    .eq("slug", memberSlug)
    .single();
  if (memErr || !member) {
    return NextResponse.json(
      { ok: false, error: `Member not found: ${memberSlug}` },
      { status: 404 },
    );
  }

  const { data: planRow, error: planErr } = await client
    .from("plans")
    .select("id, name, type, price_cents, credits, active, created_at")
    .eq("id", planId)
    .eq("studio_id", member.studio_id)
    .maybeSingle();
  if (planErr || !planRow) {
    return NextResponse.json(
      { ok: false, error: `Unknown plan: ${planId}` },
      { status: 400 },
    );
  }
  const plan: Plan = {
    id: planRow.id,
    name: planRow.name,
    type: planRow.type,
    priceCents: planRow.price_cents,
    credits: planRow.credits,
    active: planRow.active,
    createdAt: planRow.created_at,
  };
  if (!plan.active) {
    // v0.14.1: inactive plans are hidden from the member purchase
    // surface, but a stale client state could still POST one. Reject
    // loudly so the member doesn't get a confusing partial flow.
    return NextResponse.json(
      { ok: false, error: `This plan isn't available any more.` },
      { status: 400 },
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
            unit_amount: plan.priceCents,
            product_data: {
              name: plan.name,
              description: planDescription(plan),
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
    logger.error({ event: "stripe_create_checkout_session_failed", message });
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
},
  { method: "POST", parameterizedRoute: "/api/stripe/create-checkout-session" },
);
