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
