import { NextResponse } from "next/server";
import {
  insertPlan,
  listPlans,
  updatePlanActive,
  updatePlanFields,
} from "@/lib/plans-db";
import { validatePlanHard, planSoftWarnings } from "@/lib/plan-validation";
import type { PlanType } from "@/lib/plans";

import { withSentryCapture } from "@/lib/with-sentry";
/**
 * v0.14.2 plan-catalogue admin endpoint.
 *
 *   GET   /api/admin/plans         — list all plans, newest first.
 *   POST  /api/admin/plans         — create a plan. Body: name, type,
 *                                    priceCents, credits, [override].
 *                                    The id is generated server-side from
 *                                    the name; the operator never types it.
 *   PUT   /api/admin/plans         — edit existing plan commercial fields.
 *                                    Body: { id, name, type, priceCents,
 *                                    credits, [override] }. The id is
 *                                    immutable; the type is immutable in
 *                                    v0.14.2 (see updatePlanFields).
 *   PATCH /api/admin/plans         — toggle active. Body: { id, active }.
 *
 * Server-side validation is the same hard-block / soft-warn shape used
 * by the operator UI. When `override` is false and soft warnings are
 * present, the request is refused with HTTP 409 — this guarantees a
 * direct API caller can't bypass the operator's "I've checked these"
 * confirmation step.
 *
 * No auth layer yet — same posture as /api/qa/refresh, /api/admin/*.
 * When StudioFlow gains operator auth this must be locked behind
 * operator scope.
 */

export const runtime = "nodejs";

type CreateBody = {
  name?: unknown;
  type?: unknown;
  priceCents?: unknown;
  credits?: unknown;
  override?: unknown;
};

type EditBody = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  priceCents?: unknown;
  credits?: unknown;
  override?: unknown;
};

type PatchBody = {
  id?: unknown;
  active?: unknown;
};

function asInt(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) ? n : null;
}

function asPlanType(v: unknown): PlanType | null {
  return v === "class_pack" || v === "unlimited" ? v : null;
}

export const GET = withSentryCapture(
  async function GET() {
  const plans = await listPlans();
  return NextResponse.json({ ok: true, plans });
},
  { method: "GET", parameterizedRoute: "/api/admin/plans" },
);

export const POST = withSentryCapture(
  async function POST(req: Request) {
  const raw = (await req.json().catch(() => null)) as CreateBody | null;
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const type = asPlanType(raw.type);
  const priceCents = asInt(raw.priceCents);
  const credits =
    raw.credits === null || raw.credits === undefined
      ? null
      : asInt(raw.credits);
  const override = raw.override === true;

  const hardErrors = validatePlanHard({
    name,
    type: type ?? "class_pack",
    priceCents,
    credits,
  });
  // If type itself was the bad field, surface that explicitly even
  // though validatePlanHard would otherwise mask it as a credits
  // mismatch under the defaulted-to-class_pack input.
  if (type === null) {
    return NextResponse.json(
      { ok: false, error: "Plan type must be Class pack or Unlimited." },
      { status: 400 },
    );
  }
  if (hardErrors.length > 0) {
    return NextResponse.json(
      { ok: false, error: hardErrors[0].message },
      { status: 400 },
    );
  }

  if (!override) {
    const existing = await listPlans();
    const warnings = planSoftWarnings(
      { name, type, priceCents, credits },
      existing,
    );
    if (warnings.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "This plan has warnings. Confirm and resubmit with override.",
          warnings,
        },
        { status: 409 },
      );
    }
  }

  const result = await insertPlan({
    name,
    type,
    priceCents: priceCents as number,
    credits: type === "class_pack" ? credits : null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, plan: result.plan });
},
  { method: "POST", parameterizedRoute: "/api/admin/plans" },
);

export const PUT = withSentryCapture(
  async function PUT(req: Request) {
  const raw = (await req.json().catch(() => null)) as EditBody | null;
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id required" },
      { status: 400 },
    );
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const type = asPlanType(raw.type);
  const priceCents = asInt(raw.priceCents);
  const credits =
    raw.credits === null || raw.credits === undefined
      ? null
      : asInt(raw.credits);
  const override = raw.override === true;

  if (type === null) {
    return NextResponse.json(
      { ok: false, error: "Plan type must be Class pack or Unlimited." },
      { status: 400 },
    );
  }

  const hardErrors = validatePlanHard({ name, type, priceCents, credits });
  if (hardErrors.length > 0) {
    return NextResponse.json(
      { ok: false, error: hardErrors[0].message },
      { status: 400 },
    );
  }

  if (!override) {
    const existing = await listPlans();
    const warnings = planSoftWarnings(
      { name, type, priceCents, credits },
      existing,
      { excludeId: id },
    );
    if (warnings.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "This edit has warnings. Confirm and resubmit with override.",
          warnings,
        },
        { status: 409 },
      );
    }
  }

  const result = await updatePlanFields(id, {
    name,
    type,
    priceCents: priceCents as number,
    credits: type === "class_pack" ? credits : null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, plan: result.plan });
},
  { method: "PUT", parameterizedRoute: "/api/admin/plans" },
);

export const PATCH = withSentryCapture(
  async function PATCH(req: Request) {
  const raw = (await req.json().catch(() => null)) as PatchBody | null;
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id required" },
      { status: 400 },
    );
  }
  if (typeof raw.active !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "active must be boolean" },
      { status: 400 },
    );
  }

  const result = await updatePlanActive(id, raw.active);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, plan: result.plan });
},
  { method: "PATCH", parameterizedRoute: "/api/admin/plans" },
);
