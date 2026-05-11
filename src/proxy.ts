import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseProxyAuthClient } from "@/lib/supabase";
import type { StaffRole } from "@/lib/auth";

/**
 * v0.21.0 Operator + Instructor RBAC gate.
 *
 * Next 16 renamed the `middleware` file convention to `proxy`. This
 * file is the canonical proxy: it runs on every request matching the
 * config below, resolves the caller's session + staff role from the
 * SSR cookies, and either blocks (401/403/redirect) or lets the
 * request proceed (returning the response we built so refreshed
 * Supabase session cookies propagate downstream).
 *
 * Why an allow-list matcher (rather than match-all-and-skip):
 *
 *   The proxy doc explicitly warns that Server Functions are POSTs
 *   to the page route they live on, so a matcher that excludes a
 *   path silently skips its server actions too. Allow-listing the
 *   staff-protected paths keeps the "no auth here" surfaces
 *   (/checkin/*, /book/*, /my/*, /api/stripe/webhook, /api/health,
 *   /api/attendance/*, /api/stripe/*, /login, /staff/login,
 *   /auth/*, /, static assets) deliberately untouched. /my/* is
 *   gated by its own layout-level MemberAccessGate from M1.
 *
 * Why /api/stripe/webhook is NOT in the matcher (called out
 * separately because it's the single most security-sensitive line in
 * this file): the webhook is signature-verified with raw-body
 * handling, must accept Stripe-signed POSTs with no session, and
 * adding session middleware would either break delivery or
 * compromise the security model.
 *
 * Roles by path:
 *
 *   /app/*         → manager, owner   (operator surface)
 *   /instructor/*  → instructor, manager, owner
 *   /api/admin/*   → manager, owner
 *   /api/qa/*      → manager, owner   (QA fixture mutators)
 *   /api/dev/*     → manager, owner   (dev-only purchase fallback)
 *
 * Response codes:
 *   - API path, no session   → 401 JSON { error: "Authentication required" }
 *   - API path, wrong role   → 403 JSON { error: "Forbidden" }
 *   - Page path, no session  → 302 to /staff/login?next=<path>
 *   - Page path, wrong role  → 403 plain text
 *
 * Out of scope here (handled inside route handlers / server actions
 * when those land on the staff side):
 *   - Server Function (server action) coverage. M2 doesn't ship any
 *     staff-side server actions; the proxy is sufficient. When the
 *     first one lands, add an in-handler requireRole() guard at the
 *     call site — the proxy doc warns matcher refactors can silently
 *     drop server-function coverage.
 */

const ROLES_APP: ReadonlyArray<StaffRole> = ["manager", "owner"];
const ROLES_INSTRUCTOR: ReadonlyArray<StaffRole> = [
  "instructor",
  "manager",
  "owner",
];
const ROLES_ADMIN_API: ReadonlyArray<StaffRole> = ["manager", "owner"];

function pathMatches(path: string, prefix: string): boolean {
  // Matches the bare prefix (e.g. /app) AND every descendant
  // (/app/anything). The matcher pattern `/app/:path*` already does
  // this at the routing layer; this JS check mirrors it for clarity.
  return path === prefix || path.startsWith(`${prefix}/`);
}

function rolesForPath(path: string): ReadonlyArray<StaffRole> | null {
  if (pathMatches(path, "/app")) return ROLES_APP;
  if (pathMatches(path, "/instructor")) return ROLES_INSTRUCTOR;
  if (pathMatches(path, "/api/admin")) return ROLES_ADMIN_API;
  if (pathMatches(path, "/api/qa")) return ROLES_ADMIN_API;
  if (pathMatches(path, "/api/dev")) return ROLES_ADMIN_API;
  return null;
}

export async function proxy(req: NextRequest) {
  const { supabase, response } = getSupabaseProxyAuthClient(req);

  // No Supabase config — local dev with env vars unset, or a
  // misconfigured deploy. Fail closed on staff surfaces; a 503 is
  // clearer than a stale "authentication required" loop.
  if (!supabase) {
    const path = req.nextUrl.pathname;
    if (path.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Auth not configured" },
        { status: 503 },
      );
    }
    return new NextResponse("Auth not configured", { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const requiredRoles = rolesForPath(path);
  if (!requiredRoles) {
    // Matcher routed something here that isn't an enumerated gate.
    // Pass through without doing anything else — defensive, not
    // expected to fire.
    return response;
  }

  const isApi = path.startsWith("/api/");

  if (!user) {
    if (isApi) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/staff/login";
    url.search = "";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Resolve the caller's staff role with their own session (anon
  // role + self-read RLS policy). At most one row.
  const { data: staffRow } = await supabase
    .from("staff")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = (staffRow?.role as StaffRole | undefined) ?? null;

  if (!role || !requiredRoles.includes(role)) {
    if (isApi) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return new NextResponse("Forbidden", { status: 403 });
  }

  return response;
}

/*
 * SERVER ACTIONS WARNING — READ BEFORE EDITING THE MATCHER
 * ────────────────────────────────────────────────────────
 * The matcher below is the URL-path gate for staff surfaces. It
 * does NOT, by itself, gate Server Functions (server actions).
 * From the Next.js 16 proxy docs
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md):
 *
 *   > Server Functions are not separate routes in this chain. They
 *   > are handled as POST requests to the route where they are used,
 *   > so a Proxy matcher that excludes a path will also skip Server
 *   > Function calls on that path.
 *   >
 *   > A matcher change or a refactor that moves a Server Function
 *   > to a different route can silently remove Proxy coverage.
 *   > Always verify authentication and authorization inside each
 *   > Server Function rather than relying on Proxy alone.
 *
 * Implication for this codebase: any staff-side server action —
 * including ones invoked from pages under `/app/*` or
 * `/instructor/*` — MUST call `requireRole()` from src/lib/auth.ts
 * in the action handler body. The proxy is the first line of
 * defense; `requireRole` in the handler is the second. Do not rely
 * on this proxy alone.
 *
 * See src/lib/auth.ts:requireRole, src/lib/auth-errors.ts, and the
 * `chore/staff-server-action-guard` ticket (v0.21.0.3) that re-added
 * the helper after M2 dropped it.
 */
export const config = {
  /*
   * Allow-list. Anything not listed here doesn't enter the proxy at
   * all — see the file header for why this matters for /api/stripe/
   * webhook, /api/health, /checkin/*, /book/*, /my/*, and the auth
   * surfaces themselves.
   */
  matcher: [
    "/app/:path*",
    "/instructor/:path*",
    "/api/admin/:path*",
    "/api/qa/:path*",
    "/api/dev/:path*",
  ],
};
