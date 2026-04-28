import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.16.1",
    release: "Refund Guardrail Visibility",
  });
}
