import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.14.2",
    release: "Edit Existing Plans + Safer Operator Controls",
  });
}
