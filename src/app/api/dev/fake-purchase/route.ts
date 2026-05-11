import { NextResponse } from "next/server";
import { scopedQuery } from "@/lib/db";
import { applyPurchase, type PurchaseSource } from "@/lib/entitlements/applyPurchase";

/**
 * v0.13.0 / v0.15.0 dev + operator fulfilment fallback for when Stripe
 * is not configured.
 *
 *   ⚠ POST-ONLY. GET returns HTTP 405.
 *   Called from two places:
 *     - The member-home Buy button when /api/stripe/create-checkout-
 *       session responded with { mode: "fake" }. Source recorded as
 *       'dev_fake'. (Self-serve member, no Stripe configured.)
 *     - The operator test-purchase panel on /app/members/[id], which
 *       passes { source: "operator_manual" } so purchase history can
 *       label it explicitly as an operator-initiated test.
 *
 * POST /api/dev/fake-purchase
 * Body: {
 *   memberSlug: string,
 *   planId: string,
 *   source?: "dev_fake" | "operator_manual"   // defaults to 'dev_fake'
 * }
 *
 * Calls the SAME applyPurchase function the Stripe webhook uses —
 * fulfilment is identical; only the source tag and externalId shape
 * differ. Inactive plans are rejected by applyPurchase (returns
 * code: "inactive_plan") so a stale client cannot grant a stranded
 * entitlement here.
 *
 * Auth posture matches the existing /api/qa/refresh, /api/admin/*
 * endpoints — no auth layer exists anywhere in StudioFlow yet. When a
 * real auth layer ships, this route should be locked behind operator
 * scope.
 */

export const runtime = "nodejs";

type Body = {
  memberSlug?: string;
  planId?: string;
  source?: unknown;
};

const ALLOWED_SOURCES: ReadonlyArray<PurchaseSource> = [
  "dev_fake",
  "operator_manual",
];

function asAllowedSource(v: unknown): PurchaseSource {
  if (typeof v === "string" && (ALLOWED_SOURCES as readonly string[]).includes(v)) {
    return v as PurchaseSource;
  }
  return "dev_fake";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.memberSlug || !body?.planId) {
    return NextResponse.json(
      { ok: false, error: "memberSlug and planId required" },
      { status: 400 },
    );
  }
  const { memberSlug, planId } = body;
  const source = asAllowedSource(body.source);

  const client = await scopedQuery();
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

  // External-id prefix mirrors the source so operator_manual rows are
  // obviously distinguishable in the purchases table from member-home
  // self-serve dev fakes and from real Stripe sessions.
  const prefix = source === "operator_manual" ? "op" : "fake";
  const externalId =
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const result = await applyPurchase({
    memberId: member.id,
    planId,
    source,
    externalId,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mode: source,
    externalId,
    alreadyProcessed: result.alreadyProcessed,
    planTypeApplied: result.planTypeApplied,
    creditsRemaining: result.creditsRemaining,
    priceCentsPaid: result.priceCentsPaid,
    creditsGranted: result.creditsGranted,
  });
}
