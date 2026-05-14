import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServerAuthClient } from "@/lib/supabase";
import { isSafeNextPath } from "@/lib/auth";
import {
  LOGIN_INTENT_COOKIE,
  decodeLoginIntent,
  type LoginIntent,
} from "@/lib/login-intent";

import { withSentryCapture } from "@/lib/with-sentry";
/**
 * v0.20.1 magic-link decision tree (v0.21.0: staff intent branch;
 * v0.23.3: staff-first priority; v0.23.4: intent + next via HttpOnly
 * cookie instead of URL query params).
 *
 * Replaces the dead-on-prod /auth/callback client page from M1. With
 * PKCE flow now configured on the browser client, magic links arrive
 * here as `?code=…` and we run the auth handshake server-side so we
 * can branch on the user's claim state and 302 to the right place —
 * instead of letting Supabase drop the user back at Site URL.
 *
 * v0.23.4 carries the user's `intent` (staff | member) and `next`
 * (post-login redirect target) from the login form via the
 * `sf_login_intent` HttpOnly cookie set by setLoginIntent(). The
 * cookie is read and cleared here once per callback invocation.
 * emailRedirectTo on signInWithOtp is now exactly `${origin}/auth/callback`
 * (no query string) so it matches Supabase's strict redirect-URL
 * allow-list — see src/lib/login-intent.ts for the full rationale.
 *
 * v0.23.3 promoted the staff-row lookup to run FIRST regardless of
 * intent — the only safe answer for a user holding a staff row is
 * "send them to the staff dashboard," never "send them to /my/{some-slug}."
 * That earlier intent-only design left a regression hole: if a real
 * owner's user_id ended up data-linked to a demo seed members row
 * (e.g. via a historical /auth/claim test), hitting /login routed them
 * to /my/<wrong-slug> which 404'd. Staff-first closes that hole
 * permanently.
 *
 * Decision tree (in order):
 *
 *   1. exchangeCodeForSession(code) → if it errors, redirect to
 *      the appropriate login (member or staff) with the reason.
 *   2. Read + clear the sf_login_intent cookie. Resolve `intent` and
 *      `next` from it; default to intent="member" / next=null when the
 *      cookie is missing or invalid (e.g. cross-device magic-link click).
 *   3. (v0.23.3) Staff lookup runs unconditionally.
 *        → staff row exists → redirect to next-if-safe ?? '/app'
 *        → no staff row AND intent=staff → /staff/login?error=not-authorised
 *        → no staff row AND intent=member → fall through to member resolution
 *   4. user already has a linked members row (user_id = uid())
 *        → if `next` is safe, redirect there
 *        → else redirect to /my/{linked.slug}
 *      We deliberately ignore any un-claimed siblings at the same
 *      email — the M1 UNIQUE(user_id) index makes a second link
 *      impossible today; M3 reopens this when the index becomes
 *      UNIQUE(studio_id, user_id).
 *   5. no linked row, but at least one un-claimed members row matches
 *      the auth user's email AND has a phone on file
 *        → redirect to /auth/claim?next=…
 *      Phone is required because the claim handshake is
 *      email-match + phone-last-4. A row with no phone is
 *      indistinguishable from "studio hasn't onboarded this person
 *      for self-claim yet" — route to the friendly error.
 *   6. anything else → /login?error=no-member.
 *
 * Cross-device cookie limitation: cookies don't transfer between
 * browsers. A user who submits the form on device A and clicks the
 * magic link on device B will land here without the intent cookie.
 * The fallback (intent="member" / next=null) means staff still
 * resolve correctly (staff-row lookup wins), and members fall into
 * the same linked → claim → no-member chain they would have used
 * before v0.23.4. Acceptable degradation.
 *
 * Open-redirect / loop safety: `next` is filtered through
 * isSafeNextPath before it's ever returned in a 302 Location header.
 */

function loginRedirect(origin: string, params: Record<string, string>) {
  const url = new URL("/login", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

function staffLoginRedirect(
  origin: string,
  params: Record<string, string>,
) {
  const url = new URL("/staff/login", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/**
 * Read the sf_login_intent cookie, clear it, and return its contents.
 *
 * Clearing happens unconditionally (even on a decode failure) so a
 * malformed cookie can't poison subsequent callback invocations. The
 * Set-Cookie header for the clear is attached to whatever response
 * the callback returns — NextResponse.redirect picks up the
 * cookieStore.delete() side effect via Next 16's cookies() API.
 */
async function consumeLoginIntent(): Promise<LoginIntent | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOGIN_INTENT_COOKIE)?.value;
  cookieStore.delete(LOGIN_INTENT_COOKIE);
  return decodeLoginIntent(raw);
}

export const GET = withSentryCapture(
  async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorDescription = url.searchParams.get("error_description");
  const origin = url.origin;

  // v0.23.4 — Intent + next arrive on the sf_login_intent cookie set
  // by the login form's setLoginIntent server action. URL query params
  // are no longer the carrier (Supabase's strict redirect-URL allow-list
  // rejects emailRedirectTo values with query strings). Consume the
  // cookie up-front so it's cleared on every code path below, success
  // or failure.
  const loginIntent = await consumeLoginIntent();
  const intent = loginIntent?.intent ?? "member";
  const nextParam = loginIntent?.next ?? null;

  const isStaff = intent === "staff";
  const failRedirect = isStaff ? staffLoginRedirect : loginRedirect;

  if (errorDescription) {
    return failRedirect(origin, { error: "auth", reason: errorDescription });
  }
  if (!code) {
    return failRedirect(origin, { error: "auth", reason: "missing_code" });
  }

  const supabase = await getSupabaseServerAuthClient();
  if (!supabase) {
    return failRedirect(origin, { error: "auth", reason: "not_configured" });
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
    code,
  );
  if (exchangeError) {
    return failRedirect(origin, {
      error: "auth",
      reason: exchangeError.message,
    });
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return failRedirect(origin, { error: "auth", reason: "no_session" });
  }

  // v0.23.3 — staff lookup runs UNCONDITIONALLY before any member
  // resolution. The only safe answer for a user with a staff row is
  // "send them to the staff dashboard." Routing a staff user via the
  // member branch was the v0.23.x regression that sent the owner to
  // /my/<demo-seed-slug> when their user_id was historically linked
  // to a seed row (e.g. via a /auth/claim test). The intent param
  // still matters for the failure-mode message ("not authorised" vs.
  // member resolution fallthrough) but no longer gates the lookup.
  const { data: staffRow } = await supabase
    .from("staff")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (staffRow) {
    if (isSafeNextPath(nextParam)) {
      return NextResponse.redirect(new URL(nextParam, origin));
    }
    return NextResponse.redirect(new URL("/app", origin));
  }

  // No staff row. Staff intent fast-fails with the dedicated error.
  if (isStaff) {
    return staffLoginRedirect(origin, { error: "not-authorised" });
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
},
  { method: "GET", parameterizedRoute: "/auth/callback" },
);
