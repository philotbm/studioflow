import { NextResponse } from "next/server";
import { refreshQaFixtures } from "@/lib/db";

// v0.8.4.1 QA fixture refresh endpoint.
//
// POST or GET — both call sf_refresh_qa_fixtures() and return its JSON
// payload. GET is allowed so the endpoint can be hit from a browser
// address bar during live QA; POST is the conventional form.
//
// No auth gate yet — this is intentional for the pre-auth v0.8.x phase
// and must be revisited before auth lands so the endpoint cannot be
// weaponised to wipe QA fixture audit on a production multi-tenant
// deployment. Scoped entirely to qa-* class ids server-side.

async function handle() {
  try {
    const result = await refreshQaFixtures();
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "refresh failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
