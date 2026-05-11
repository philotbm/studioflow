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
- Multi-tenant `studio_id` plumbing arrives in M3.

**Staff-side server actions must call `requireRole(['owner', 'manager'])` (or the appropriate role list) in the action body.** The proxy matcher gates URL paths, but Server Functions are POSTs to the page route they live on — so a matcher refactor that moves a page out of the allow-list silently drops the server action's proxy coverage (per the Next.js 16 proxy docs, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). The proxy is the *first* line of defense; `requireRole` from `src/lib/auth.ts` in the handler is the *second*. Do not rely on either alone. See `src/lib/auth-errors.ts` for the canonical try/catch snippets that map `AuthRequired` / `Forbidden` to redirects (server actions / server components) or JSON responses (route handlers).

# Observability (current)

- **Errors:** Sentry (`@sentry/nextjs`, EU region). Server init runs from `instrumentation.ts`'s `register()` hook (dispatches to `sentry.server.config.ts` or `sentry.edge.config.ts` per `NEXT_RUNTIME`); client init lives in `sentry.client.config.ts`. `instrumentation.ts` also re-exports `captureRequestError` as `onRequestError` to catch RSC / route-handler / server-action failures. Source maps upload at Vercel build time when `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` are set in Production scope; `NEXT_PUBLIC_SENTRY_DSN` enables event ingestion. Session replay is disabled (no GDPR DPA). `beforeSend` strips `email` / `phone` / `last4` / `password` before events leave the runtime.
- **Use `logger.<level>({ event, ... })` from `src/lib/logger.ts`, not `console.log`, in `src/app/api/**`.** The `event` field is required and should be a snake_case identifier you'd grep on later. Sentry catches exceptions automatically; the logger is for the trail of breadcrumbs you want before things break. Don't log PII (email, phone, last4). The logger emits one JSON line per call to stdout — Vercel ingests stdout natively, so a future swap to Axiom/Logtail/Logflare is a config change, not a codebase rewrite.
