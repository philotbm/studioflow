import { NextResponse } from "next/server";
import { scopedQuery } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * v0.16.0 operator refund endpoint.
 *
 *   ⚠ POST-ONLY. GET returns HTTP 405.
 *
 * POST /api/admin/refund-purchase
 * Body: { purchaseId: string }
 *
 * Calls sf_refund_purchase, which atomically:
 *   - Flips purchases.status to 'refunded'.
 *   - Decrements members.credits_remaining by the recorded
 *     credits_granted.
 *   - Appends a credit_transactions ledger row with
 *     reason_code='purchase_refund', source='system'.
 *
 * Idempotent: a duplicate call after a successful refund returns
 * { ok:true, alreadyRefunded:true } without mutating state.
 *
 * Auth posture matches the existing /api/admin/* endpoints — no
 * auth layer exists anywhere in StudioFlow yet. When operator auth
 * ships, this route should be locked behind operator scope.
 */

export const runtime = "nodejs";

type Body = { purchaseId?: unknown };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const purchaseId =
    body && typeof body.purchaseId === "string" ? body.purchaseId.trim() : "";
  if (!purchaseId) {
    return NextResponse.json(
      { ok: false, error: "purchaseId required" },
      { status: 400 },
    );
  }
  if (!UUID_RE.test(purchaseId)) {
    return NextResponse.json(
      { ok: false, error: "purchaseId must be a UUID" },
      { status: 400 },
    );
  }

  const client = await scopedQuery();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 503 },
    );
  }

  // TODO(M3): pass studio_id explicitly once sf_refund_purchase is studio-scoped.
  const { data, error } = await client.rpc("sf_refund_purchase", {
    p_purchase_id: purchaseId,
  });
  if (error) {
    // 42883: function does not exist — v0.16.0 migration not applied.
    if (error.code === "42883") {
      logger.error({
        event: "refund_purchase_rpc_missing",
        reason: "v0.16.0 migration not applied",
        message: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          code: "rpc_missing",
          error:
            "Refund RPC is not installed on this database. " +
            "Apply supabase/v0.16.0_migration.sql and retry.",
        },
        { status: 500 },
      );
    }
    logger.error({ event: "refund_purchase_rpc_failed", message: error.message });
    return NextResponse.json(
      { ok: false, code: "rpc_error", error: error.message },
      { status: 500 },
    );
  }

  // sf_refund_purchase always returns a JSON object. The shape
  // depends on success vs. structured error; pass it through as-is
  // but normalise key casing for the client.
  const r = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    error?: string;
    already_refunded?: boolean;
    status?: string;
    purchase_id?: string;
    external_id?: string;
    refunded_credits?: number;
    new_balance?: number;
    ledger_id?: string;
    plan_type?: string;
    credits_remaining?: number;
    credits_to_refund?: number;
  };

  if (!r.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: r.code,
        error: r.error,
        planType: r.plan_type,
        creditsRemaining: r.credits_remaining,
        creditsToRefund: r.credits_to_refund,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    alreadyRefunded: r.already_refunded ?? false,
    purchaseId: r.purchase_id,
    externalId: r.external_id,
    refundedCredits: r.refunded_credits,
    newBalance: r.new_balance,
    ledgerId: r.ledger_id,
    status: r.status,
  });
}
