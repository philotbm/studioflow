import { NextResponse } from "next/server";
import { insertPlan, listPlans } from "@/lib/plans-db";

/**
 * v0.14.0 plan-catalogue admin endpoint.
 *
 *   GET  /api/admin/plans         — list all plans, newest first.
 *   POST /api/admin/plans          — create a new plan.
 *
 * POST body (JSON):
 *   { id: string, name: string, type: "class_pack"|"unlimited",
 *     priceCents: integer, credits?: integer|null }
 *
 * No auth layer yet — same posture as /api/qa/refresh, /api/admin/*.
 * Once StudioFlow gains operator auth, this route must be locked
 * behind operator scope. Flagged here so the reader doesn't forget.
 *
 * Validation is intentionally thin: the DB CHECKs on the `plans` table
 * enforce (type, credits) coherence and non-negative price, so a bad
 * payload surfaces as a 400 with the Postgres error message.
 */

export const runtime = "nodejs";

type CreateBody = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  priceCents?: unknown;
  credits?: unknown;
};

function asInt(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) ? n : null;
}

export async function GET() {
  const plans = await listPlans();
  return NextResponse.json({ ok: true, plans });
}

export async function POST(req: Request) {
  const raw = (await req.json().catch(() => null)) as CreateBody | null;
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Shape guards. DB CHECKs catch the rest (non-negative price, and
  // the class_pack ↔ credits coherence constraint).
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const type = raw.type;
  const priceCents = asInt(raw.priceCents);
  const creditsRaw =
    raw.credits === null || raw.credits === undefined
      ? null
      : asInt(raw.credits);

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id required (lowercase, stable slug)" },
      { status: 400 },
    );
  }
  if (!/^[a-z0-9_]+$/.test(id)) {
    return NextResponse.json(
      {
        ok: false,
        error: "id must be lowercase letters, digits, underscores",
      },
      { status: 400 },
    );
  }
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "name required" },
      { status: 400 },
    );
  }
  if (type !== "class_pack" && type !== "unlimited") {
    return NextResponse.json(
      { ok: false, error: 'type must be "class_pack" or "unlimited"' },
      { status: 400 },
    );
  }
  if (priceCents === null || priceCents < 0) {
    return NextResponse.json(
      { ok: false, error: "priceCents must be a non-negative integer" },
      { status: 400 },
    );
  }
  if (type === "class_pack" && (creditsRaw === null || creditsRaw <= 0)) {
    return NextResponse.json(
      { ok: false, error: "class_pack plans require credits > 0" },
      { status: 400 },
    );
  }
  if (type === "unlimited" && creditsRaw !== null) {
    return NextResponse.json(
      { ok: false, error: "unlimited plans must not specify credits" },
      { status: 400 },
    );
  }

  const result = await insertPlan({
    id,
    name,
    type,
    priceCents,
    credits: type === "class_pack" ? creditsRaw : null,
  });

  if (!result.ok) {
    // Common failure modes: duplicate id (23505), CHECK violation
    // (23514). Surface the Postgres message verbatim — the admin UI
    // will render it.
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, plan: result.plan });
}
