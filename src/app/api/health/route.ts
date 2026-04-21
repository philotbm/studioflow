import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.13.0",
    release: "Stripe Checkout + Entitlement Sync (Test Mode)",
  });
}
