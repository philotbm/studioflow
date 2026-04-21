import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.13.1 GET-only purchase diagnostics.
 *
 * Safe to open in a browser. Read-only. No secrets exposed — the
 * stripe / webhook booleans report whether env vars are present,
 * not their values.
 *
 * Intended use cases:
 *   - Confirming Stripe env is wired up on a deployment (or not).
 *   - Sanity-checking the last few purchases without diving into
 *     Supabase.
 *   - Post-merge QA for the purchase path.
 *
 * POST is deliberately NOT exported — diagnostics should never mutate.
 */

export const runtime = "nodejs";

type PurchaseSummaryRow = {
  id: string;
  memberSlug: string | null;
  memberName: string | null;
  planId: string;
  source: "stripe" | "fake";
  externalId: string;
  createdAt: string;
};

export async function GET() {
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  // Fake mode fires from /api/stripe/create-checkout-session whenever
  // STRIPE_SECRET_KEY is missing. Webhook secret is relevant for the
  // real Stripe inbound path; we surface it too so the operator sees
  // whether that leg is wired.
  const fakeModeActive = !stripeConfigured;

  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json({
      ok: false,
      stripeConfigured,
      webhookConfigured,
      fakeModeActive,
      error: "Supabase not configured",
    }, { status: 503 });
  }

  // Count total purchases.
  const { count: totalPurchases, error: countErr } = await client
    .from("purchases")
    .select("id", { count: "exact", head: true });
  if (countErr) {
    return NextResponse.json({
      ok: false,
      stripeConfigured,
      webhookConfigured,
      fakeModeActive,
      error: `purchases count query failed: ${countErr.message}`,
    }, { status: 500 });
  }

  // Last 10 purchases with member slug/name for readability. Join via
  // the Supabase client's implicit foreign-key follow.
  const { data: recent, error: recentErr } = await client
    .from("purchases")
    .select(
      "id, plan_id, source, external_id, created_at, members(slug, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(10);
  if (recentErr) {
    return NextResponse.json({
      ok: false,
      stripeConfigured,
      webhookConfigured,
      fakeModeActive,
      totalPurchases: totalPurchases ?? 0,
      error: `purchases recent query failed: ${recentErr.message}`,
    }, { status: 500 });
  }

  type PurchaseJoinedRow = {
    id: string;
    plan_id: string;
    source: "stripe" | "fake";
    external_id: string;
    created_at: string;
    members: { slug: string | null; full_name: string | null } | null;
  };

  const rows: PurchaseSummaryRow[] = ((recent ?? []) as unknown as PurchaseJoinedRow[]).map((r) => ({
    id: r.id,
    memberSlug: r.members?.slug ?? null,
    memberName: r.members?.full_name ?? null,
    planId: r.plan_id,
    source: r.source,
    externalId: r.external_id,
    createdAt: r.created_at,
  }));

  return NextResponse.json({
    ok: true,
    stripeConfigured,
    webhookConfigured,
    fakeModeActive,
    totalPurchases: totalPurchases ?? 0,
    last10Purchases: rows,
    note:
      "Diagnostics only — read-only. The three purchase endpoints " +
      "(/api/stripe/create-checkout-session, /api/stripe/webhook, " +
      "/api/dev/fake-purchase) are POST-only and MUST NOT be opened " +
      "as browser QA URLs; they return HTTP 405 on GET.",
  });
}
