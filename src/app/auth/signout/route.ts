import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerAuthClient } from "@/lib/supabase";

/**
 * v0.20.1 sign-out route.
 *
 * Accepts both GET (links from the gate panel and claim page point
 * here) and POST (form actions) so the same URL works for both UI
 * surfaces. Calls supabase.auth.signOut() to clear the cookie
 * session, then 302s back to /login. The optional `next` param is
 * preserved through the round-trip in case sign-out was triggered
 * from a flow that's still trying to land somewhere specific.
 */

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next");

  const supabase = await getSupabaseServerAuthClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  const loginUrl = new URL("/login", url.origin);
  if (nextParam) loginUrl.searchParams.set("next", nextParam);
  return NextResponse.redirect(loginUrl);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
