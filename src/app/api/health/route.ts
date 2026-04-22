import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.14.1",
    release: "Plan Builder Guardrails + Operator-Safe Creation",
  });
}
