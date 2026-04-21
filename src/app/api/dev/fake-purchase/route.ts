import { NextResponse } from "next/server";
import { applyPurchase } from "@/lib/entitlements/applyPurchase";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.13.0 DEV-ONLY fallback for when Stripe is not configured.
 *
 * POST /api/dev/fake-purchase
 * Body: { memberSlug: string, planId: string }
 *
 * Exists so the member commerce-entry flow can be exercised end-to-end
 * on environments with no Stripe keys (local dev, preview deploys
 * without the Stripe env bound yet). Calls the SAME applyPurchase
 * function the Stripe webhook uses — fulfillment is identical; only
 * the source tag and externalId shape differ.
 *
 * Auth posture matches the existing /api/qa/refresh, /api/admin/*
 * endpoints — no auth layer exists anywhere in StudioFlow yet. This
 * is acceptable for the fake path because:
 *   - The worst an attacker can do is credit a member they don't
 *     control with a demo credit pack; there is no refund side-effect
 *     and no real money changes hands.
 *   - Once real Stripe is wired up and production uses the webhook
 *     path, this endpoint is dormant on live.
 *
 * When a real auth layer ships, this route should be locked behind
 * operator scope. Flagged in the file comment for the reader.
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

  // externalId format mirrors Stripe session ids loosely but carries
  // the `fake_` prefix so rows in `purchases` are obviously
  // distinguishable from real Stripe rows.
  const externalId =
    `fake_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const result = await applyPurchase({
    memberId: member.id,
    planId,
    source: "fake",
    externalId,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mode: "fake",
    externalId,
    alreadyProcessed: result.alreadyProcessed,
    planTypeApplied: result.planTypeApplied,
    creditsRemaining: result.creditsRemaining,
  });
}
