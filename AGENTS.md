<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Notable Next 16 specifics already encountered:

- The `middleware` file convention is **deprecated and renamed to `proxy`**. Use `src/proxy.ts` with `export async function proxy(req)` (or `export default function proxy`). The `middleware.ts` filename will not be picked up.
- `cookies()` from `next/headers` is async (`await cookies()`).
- Page/layout `params` and `searchParams` are `Promise`s in App Router.
- `useSearchParams()` requires a `<Suspense>` boundary.
<!-- END:nextjs-agent-rules -->

# Auth posture (current)

- **Members** sign in via magic link at `/login` → `/auth/callback` → `/my/{slug}` (M1/M1.1).
- **Staff** (owner / manager / instructor) sign in at `/staff/login` → `/auth/callback?intent=staff` → `/app` (M2 / v0.21.0).
- The same Supabase user can hold both a `members` row and a `staff` row; the login surface choice (`/login` vs. `/staff/login`) is the disambiguator.
- `src/proxy.ts` gates `/app/*`, `/instructor/*`, `/api/admin/*`, `/api/qa/*`, `/api/dev/*`. Everything else (including `/api/stripe/webhook`, `/api/health`, `/checkin/*`, `/book/*`, `/my/*`) is intentionally not in the proxy matcher.
- RLS is **off** on the data tables (M4 will turn it on); **on** for `staff` with a single self-read policy.
- Multi-tenant `studio_id` plumbing landed in v0.22.0 (M3). One demo studio in prod; second studio is an `INSERT INTO studios` + CSV import.

**Staff-side server actions must call `requireRole(['owner', 'manager'])` (or the appropriate role list) in the action body.** The proxy matcher gates URL paths, but Server Functions are POSTs to the page route they live on — so a matcher refactor that moves a page out of the allow-list silently drops the server action's proxy coverage (per the Next.js 16 proxy docs, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). The proxy is the *first* line of defense; `requireRole` from `src/lib/auth.ts` in the handler is the *second*. Do not rely on either alone. See `src/lib/auth-errors.ts` for the canonical try/catch snippets that map `AuthRequired` / `Forbidden` to redirects (server actions / server components) or JSON responses (route handlers).

# Observability (current)

- **Errors:** Sentry (`@sentry/nextjs`, EU region). Server init runs from `instrumentation.ts`'s `register()` hook (dispatches to `sentry.server.config.ts` or `sentry.edge.config.ts` per `NEXT_RUNTIME`); client init lives in `sentry.client.config.ts`. `instrumentation.ts` also re-exports `captureRequestError` as `onRequestError` to catch RSC / route-handler / server-action failures. Source maps upload at Vercel build time when `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` are set in Production scope; `NEXT_PUBLIC_SENTRY_DSN` enables event ingestion. Session replay is disabled (no GDPR DPA). `beforeSend` strips `email` / `phone` / `last4` / `password` before events leave the runtime.
- **Use `logger.<level>({ event, ... })` from `src/lib/logger.ts`, not `console.log`, in `src/app/api/**`.** The `event` field is required and should be a snake_case identifier you'd grep on later. Sentry catches exceptions automatically; the logger is for the trail of breadcrumbs you want before things break. Don't log PII (email, phone, last4). The logger emits one JSON line per call to stdout — Vercel ingests stdout natively, so a future swap to Axiom/Logtail/Logflare is a config change, not a codebase rewrite.

# Data access (current)

**Tenant-scoped queries MUST call `scopedQuery()` from `src/lib/db.ts`, not `getSupabaseClient()` from `src/lib/supabase.ts`.** `scopedQuery()` returns a Proxy over the cookie-bound auth client that auto-applies `.eq('studio_id', X)` to every `.from(<tenant_scoped_table>)` SELECT/UPDATE/DELETE and merges `studio_id: X` into INSERT/UPSERT values. `X` is the caller's `current_studio_id()`, resolved once per `scopedQuery()` call via RPC (Path A from the M3 spec). Anonymous callers (no staff/members row) get a zero-UUID sentinel — filters return empty rather than throw.

Tenant-scoped table list lives in `TENANT_SCOPED_TABLES` inside `src/lib/db.ts`. Adding a new tenant-scoped table is a one-line addition plus the schema migration. Current set: `members`, `staff`, `classes`, `class_bookings`, `booking_events`, `credit_transactions`, `plans`, `purchases`, `v_members_with_access`.

PL/pgSQL RPC functions (`sf_book_member`, `sf_cancel_booking`, etc.) accept an optional `p_studio_id uuid DEFAULT NULL` parameter and COALESCE with `current_studio_id()` if not passed. Calls from cookie-authed surfaces (operator pages, instructor, /api/admin/*, /api/qa/*, /api/dev/*) carry the user's JWT — `current_studio_id()` resolves naturally inside the function, so the application code doesn't need to pass `p_studio_id` explicitly.

**Exceptions that MUST use `getSupabaseClient()` directly** (each with an inline comment naming the reason):
- `src/app/api/stripe/webhook/route.ts` — server-to-server, no session. After Sprint C, studio_id will be resolved from Stripe Customer metadata.
- `src/app/api/attendance/check-in/route.ts` — anonymous QR-scan kiosk. studio_id resolved from the class row by slug (single-studio safe; multi-studio future will encode studio in the URL).
- `src/app/api/stripe/create-checkout-session/route.ts` — Bearer-token auth (not cookie). studio_id resolved from the validated member row.
- `src/lib/entitlements/applyPurchase.ts` — called from both the Stripe webhook (no session) and operator surfaces. `sf_apply_purchase` resolves studio_id from `members.studio_id` internally, and the post-RPC purchases UPDATE is by PK.
- `src/lib/auth.ts`, `src/proxy.ts`, `src/app/auth/callback/route.ts`, `src/app/auth/claim/*` — auth-row reads against `members`/`staff` for identity resolution.
- `src/app/app/layout.tsx` — operator's own member-row lookup via the cookie-bound auth client (different code path from scopedQuery, intentional).
- Any query against the `studios` table itself.

See `docs/adr/0001-multi-tenancy.md` Decisions 1, 2, 6 and `docs/specs/M3_multi_tenancy.md` Section 4.
