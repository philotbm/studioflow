import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.8.6.1",
    release: "Needs Attention Context Labels",
  });
}
