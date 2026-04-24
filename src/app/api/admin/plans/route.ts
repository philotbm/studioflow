import { NextResponse } from "next/server";
import { insertPlan, listPlans, updatePlanActive } from "@/lib/plans-db";

/**
 * v0.14.1 plan-catalogue admin endpoint.
 *
 *   GET   /api/admin/plans         — list all plans, newest first.
 *   POST  /api/admin/plans         — create a plan. Body: name, type,
 *                                    priceCents, credits. The id is
 *                                    generated server-side from the name;
 *                                    the operator never types it.
 *   PATCH /api/admin/plans         — toggle active. Body: { id, active }.
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

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const type = raw.type;
  const priceCents = asInt(raw.priceCents);
  const creditsRaw =
    raw.credits === null || raw.credits === undefined
      ? null
      : asInt(raw.credits);

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "Please enter a plan name." },
      { status: 400 },
    );
  }
  if (type !== "class_pack" && type !== "unlimited") {
    return NextResponse.json(
      { ok: false, error: "Plan type must be Class pack or Unlimited." },
      { status: 400 },
    );
  }
  if (priceCents === null || priceCents < 0) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid price." },
      { status: 400 },
    );
  }
  if (type === "class_pack" && (creditsRaw === null || creditsRaw <= 0)) {
    return NextResponse.json(
      { ok: false, error: "Class pack plans need a whole-number credit count above 0." },
      { status: 400 },
    );
  }
  if (type === "unlimited" && creditsRaw !== null) {
    return NextResponse.json(
      { ok: false, error: "Unlimited plans don't carry a credit count." },
      { status: 400 },
    );
  }

  const result = await insertPlan({
    name,
    type,
    priceCents,
    credits: type === "class_pack" ? creditsRaw : null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, plan: result.plan });
}

export async function PATCH(req: Request) {
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
}
