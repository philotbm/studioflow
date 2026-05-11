import type { User } from "@supabase/supabase-js";
import {
  getSupabaseClient,
  getSupabaseBrowserAuthClient,
  getSupabaseServerAuthClient,
  getSupabaseServiceClient,
} from "./supabase";
import { AuthRequired, Forbidden } from "./auth-errors";

/**
 * v0.20.0 / v0.20.1 Member auth helpers.
 *
 * The slug remains the public URL. The credential is auth.uid()
 * linked to members.user_id (v0.20.0_migration.sql). v0.20.1 swaps
 * the underlying session storage from localStorage to the
 * @supabase/ssr cookie-backed clients so the server-side
 * /auth/callback decision tree can read the session, while keeping
 * the existing public surface (`requireMemberAccess`,
 * `requireMemberAccessForRequest`) byte-for-byte compatible.
 *
 * Three access paths:
 *
 *   1. Client (React tree under /my, /login, /auth/claim form): the
 *      browser auth client persists the session in cookies.
 *      `getCurrentUser()` and `requireMemberAccess(slug)` read it.
 *
 *   2. Server with cookies (server components / route handlers /
 *      server actions): `getCurrentUserFromCookies()` and
 *      `requireMemberAccessFromCookies(slug)` read the same session
 *      via the SSR client. New in v0.20.1, used by /auth/callback,
 *      /auth/claim, /auth/signout.
 *
 *   3. Server with Bearer token (cross-origin API requests like the
 *      Stripe checkout endpoint): the client forwards
 *      `Authorization: Bearer <access_token>`.
 *      `getCurrentUserFromRequest(req)` validates it.
 *      `requireMemberAccessForRequest(req, slug)` adds the slug check.
 *      Contract is unchanged from v0.20.0 — the Stripe endpoint
 *      regression test still requires this path.
 */

/** Minimal raw shape of the members row this module returns. */
export type MemberAuthRow = {
  id: string;
  slug: string;
  user_id: string | null;
};

/** v0.21.0 — three roles in M2; M3+ may add more. */
export type StaffRole = "owner" | "manager" | "instructor";

/** Minimal raw shape of the staff row this module returns. */
export type StaffRow = {
  id: string;
  user_id: string;
  full_name: string;
  role: StaffRole;
};

// ── Path safety ───────────────────────────────────────────────────────

/**
 * Returns true iff `next` is safe to redirect to inside the app.
 * Rejects external URLs, protocol-relative URLs, and the auth
 * surfaces themselves (which would loop). Used by /auth/callback,
 * the login form, and the claim action.
 */
export function isSafeNextPath(next: string | null | undefined): next is string {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.startsWith("/login")) return false;
  if (next.startsWith("/auth")) return false;
  return true;
}

// ── Client helpers ────────────────────────────────────────────────────

export async function getCurrentUser(): Promise<User | null> {
  const client = getSupabaseBrowserAuthClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

export async function requireMemberAccess(
  slug: string,
): Promise<MemberAuthRow | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const client = getSupabaseBrowserAuthClient();
  if (!client) return null;
  const { data: member } = await client
    .from("members")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .single();
  if (!member || member.user_id !== user.id) return null;
  return member as MemberAuthRow;
}

// ── Server (cookie) helpers ───────────────────────────────────────────

export async function getCurrentUserFromCookies(): Promise<User | null> {
  const client = await getSupabaseServerAuthClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

export async function requireMemberAccessFromCookies(
  slug: string,
): Promise<MemberAuthRow | null> {
  const user = await getCurrentUserFromCookies();
  if (!user) return null;
  const client = await getSupabaseServerAuthClient();
  if (!client) return null;
  const { data: member } = await client
    .from("members")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .single();
  if (!member || member.user_id !== user.id) return null;
  return member as MemberAuthRow;
}

/**
 * v0.21.0 — resolve the caller's staff row, if any.
 *
 * Reads the SSR cookie session and looks up `staff` by user_id. The
 * staff table has a self-read RLS policy so the anon-role query
 * succeeds and returns at most one row (UNIQUE(user_id) until M3).
 *
 * Returns null when:
 *   - No session (not signed in).
 *   - Signed in but the user has no staff row (member-only user).
 *
 * Layouts under /app and /instructor can safely treat null as
 * "shouldn't be here" — the proxy has already gated the path, so the
 * only way to reach the layout is with a valid staff row. Callers
 * still null-check defensively in case the proxy is bypassed during
 * local dev (e.g. NEXT_PUBLIC_SUPABASE_* env vars unset).
 */
export async function getCurrentStaffFromCookies(): Promise<StaffRow | null> {
  const user = await getCurrentUserFromCookies();
  if (!user) return null;
  const client = await getSupabaseServerAuthClient();
  if (!client) return null;
  const { data } = await client
    .from("staff")
    .select("id, user_id, full_name, role")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as StaffRow | null) ?? null;
}

/**
 * v0.21.0.3 — in-handler role guard for staff-side server actions.
 *
 * Use inside a staff-side server action (or any route handler that
 * proxy matchers might not cover) to enforce an allowed role list.
 * Throws AuthRequired if there's no session, Forbidden if there is a
 * session but the staff row's role isn't in `allowed`. Returns the
 * staff row on success so callers don't have to re-fetch.
 *
 * Why this exists even though src/proxy.ts already enforces roles per
 * path: Server Functions (server actions) are POSTs to the page route
 * they live on, so the proxy matcher coverage tracks the page's path —
 * not the action itself. A matcher refactor that moves a path out of
 * the allow-list silently drops Server Function coverage too. The
 * Next.js 16 proxy docs explicitly call this out
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md):
 *
 *   "Always verify authentication and authorization inside each
 *    Server Function rather than relying on Proxy alone."
 *
 * Catch pattern — see src/lib/auth-errors.ts for the canonical
 * try/catch snippets for server actions and route handlers.
 *
 * Not used by M2 — M2 ships no staff-side server actions and its
 * proxy-gated layouts/route handlers don't need this guard. The
 * helper is dormant until the first staff-side server action lands.
 */
export async function requireRole(
  allowed: ReadonlyArray<StaffRole>,
): Promise<StaffRow> {
  const staff = await getCurrentStaffFromCookies();
  if (!staff) throw new AuthRequired("/staff/login");
  if (!allowed.includes(staff.role)) throw new Forbidden();
  return staff;
}

// ── Server (Bearer token) helpers — kept stable for Stripe API ────────

function bearerFromRequest(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Validates a Bearer access token from the request. Used by API
 * route handlers that the browser hits cross-origin via fetch (i.e.
 * /api/stripe/create-checkout-session).
 */
export async function getCurrentUserFromRequest(
  req: Request,
): Promise<User | null> {
  const token = bearerFromRequest(req);
  if (!token) return null;
  // Use the non-auth client deliberately: we're validating an
  // explicit token, not reading the SSR cookie session.
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

/**
 * v0.23.0 (M4) — the members lookup runs against the service-role
 * client because the Bearer-auth caller has no cookie session, so
 * current_studio_id() returns NULL and the tenant_isolation RLS
 * policy would block the read. This helper is the gatekeeper for
 * /api/stripe/create-checkout-session — it validates the JWT, then
 * confirms the requested slug belongs to that user before the
 * route's own service-role queries run. Compare member.user_id ===
 * user.id below: that check is what makes the service-role read
 * safe — we never return a member row that doesn't match the
 * authenticated JWT, regardless of which studio it sits in.
 */
export async function requireMemberAccessForRequest(
  req: Request,
  slug: string,
): Promise<MemberAuthRow | null> {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return null;
  const client = getSupabaseServiceClient();
  if (!client) return null;
  const { data: member } = await client
    .from("members")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .single();
  if (!member || member.user_id !== user.id) return null;
  return member as MemberAuthRow;
}
