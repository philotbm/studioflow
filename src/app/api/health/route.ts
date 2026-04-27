import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.14.3",
    release: "Operator Purchase Preview + Test Purchase Panel",
  });
}
