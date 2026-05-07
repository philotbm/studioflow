import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerAuthClient } from "@/lib/supabase";
import { isSafeNextPath } from "@/lib/auth";

/**
 * v0.20.1 magic-link decision tree.
 *
 * Replaces the dead-on-prod /auth/callback client page from M1. With
 * PKCE flow now configured on the browser client, magic links arrive
 * here as `?code=…&next=…` and we run the auth handshake server-side
 * so we can branch on the user's claim state and 302 to the right
 * place — instead of letting Supabase drop the user back at Site URL.
 *
 * Decision tree (in order):
 *
 *   1. exchangeCodeForSession(code) → if it errors, redirect to
 *      /login with the error reason (covers expired / replayed
 *      links).
 *   2. user already has a linked members row (user_id = uid())
 *        → if `next` is safe, redirect there
 *        → else redirect to /my/{linked.slug}
 *      We deliberately ignore any un-claimed siblings at the same
 *      email — the M1 UNIQUE(user_id) index makes a second link
 *      impossible today; M3 reopens this when the index becomes
 *      UNIQUE(studio_id, user_id).
 *   3. no linked row, but at least one un-claimed members row matches
 *      the auth user's email AND has a phone on file
 *        → redirect to /auth/claim?next=…
 *      Phone is required because the claim handshake is
 *      email-match + phone-last-4. A row with no phone is
 *      indistinguishable from "studio hasn't onboarded this person
 *      for self-claim yet" — route to the friendly error.
 *   4. anything else → /login?error=no-member.
 *
 * Open-redirect / loop safety: `next` is filtered through
 * isSafeNextPath before it's ever returned in a 302 Location header.
 */

function loginRedirect(origin: string, params: Record<string, string>) {
  const url = new URL("/login", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  const errorDescription = url.searchParams.get("error_description");
  const origin = url.origin;

  if (errorDescription) {
    return loginRedirect(origin, { error: "auth", reason: errorDescription });
  }
  if (!code) {
    return loginRedirect(origin, { error: "auth", reason: "missing_code" });
  }

  const supabase = await getSupabaseServerAuthClient();
  if (!supabase) {
    return loginRedirect(origin, { error: "auth", reason: "not_configured" });
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
    code,
  );
  if (exchangeError) {
    return loginRedirect(origin, {
      error: "auth",
      reason: exchangeError.message,
    });
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return loginRedirect(origin, { error: "auth", reason: "no_session" });
  }

  // 1. Already linked? Honour next-or-home.
  const { data: linked } = await supabase
    .from("members")
    .select("slug")
    .eq("user_id", user.id)
    .maybeSingle();

  if (linked?.slug) {
    if (isSafeNextPath(nextParam)) {
      return NextResponse.redirect(new URL(nextParam, origin));
    }
    return NextResponse.redirect(new URL(`/my/${linked.slug}`, origin));
  }

  // 2. Un-claimed candidates at this email with a phone on file?
  if (user.email) {
    const { data: candidates } = await supabase
      .from("members")
      .select("id")
      .eq("email", user.email)
      .is("user_id", null)
      .not("phone", "is", null)
      .limit(1);

    if (candidates && candidates.length >= 1) {
      const claimUrl = new URL("/auth/claim", origin);
      if (isSafeNextPath(nextParam)) {
        claimUrl.searchParams.set("next", nextParam);
      }
      return NextResponse.redirect(claimUrl);
    }
  }

  // 3. No match.
  return loginRedirect(origin, { error: "no-member" });
}
