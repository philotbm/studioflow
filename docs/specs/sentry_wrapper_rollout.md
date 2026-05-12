# Sentry wrapper rollout + diagnostic cleanup

**Branch:** `chore/sentry-wrapper-rollout`
**Estimated PR scope:** ~150–250 LOC net. 21 route handlers wrapped (~63 LOC added) + 4 orphan files deleted (~600 LOC removed) + 2 diagnostic console.logs removed (~30 LOC removed) + 2 verification harnesses simplified (~15 LOC removed). Net: significant code removal.
**Target version:** v0.23.2
**Depends on:** v0.23.1 ✅ (shared init module shipped, commit `88b0cf6`).
**Blocks:** v0.23.3 (tiny follow-up removing the /api/health verification harness once v0.23.2 verifies on prod).

## Why now

Pilot ~12 weeks out. v0.23.1 established that Sentry.init() runs in every function bundle, but the implicit auto-capture path is upstream-broken on Next 16 + Turbopack (Sentry #17512, Next #89377). Without explicit capture, real production errors slip through unreported. `wrapRouteHandlerWithSentry` is Sentry's first-party answer for this exact case — build-time-agnostic, Turbopack-safe, supported. Ship the rollout before pilot starts.

## Goal

Every App Router route handler wrapped with `wrapRouteHandlerWithSentry`. Every v0.22.x diagnostic and the v0.22.4 route-local workaround removed. One verification harness retained on `/api/health` (removed in v0.23.3).

## Constraints

- Three-part SemVer (`v0.23.2`).
- Bulk-mechanical change — every route handler gets the SAME shape of wrap. No bespoke logic per route.
- `src/lib/sentry-init.ts` STAYS. `src/proxy.ts` and `src/lib/supabase.ts` side-effect imports STAY.
- `import "@/lib/sentry-init"` in `src/app/api/health/route.ts` STAYS — that route doesn't transitively import supabase.ts.
- Stripe webhook special-cased per Open Question #4.

## Technical approach

### 1. Wrapping pattern

For every route handler file, each exported HTTP method gets wrapped:

```ts
// before
import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // handler body
  return NextResponse.json({ ok: true });
}
```

```ts
// after
import { NextResponse, type NextRequest } from "next/server";
import { wrapRouteHandlerWithSentry } from "@sentry/nextjs";

export const GET = wrapRouteHandlerWithSentry(
  async function GET(req: NextRequest): Promise<NextResponse> {
    // handler body
    return NextResponse.json({ ok: true });
  },
  { method: "GET", parameterizedRoute: "/api/<path-to-this-route>" },
);
```

- Inner function keeps its name (`async function GET`) for stack-trace legibility.
- `parameterizedRoute` derived per Open Question #3.
- Multiple methods in one file each get wrapped independently.
- Sync handlers become async — wrapper returns Promise.

### 2. Routes to wrap (21 files — `src/app/api/dev/sentry-test` is DELETED, not wrapped)

```
src/app/api/admin/fix-encoding/route.ts            → "/api/admin/fix-encoding"
src/app/api/admin/plans/route.ts                   → "/api/admin/plans"
src/app/api/admin/purchase-health/route.ts         → "/api/admin/purchase-health"
src/app/api/admin/rebase-demo-classes/route.ts     → "/api/admin/rebase-demo-classes"
src/app/api/admin/refund-purchase/route.ts         → "/api/admin/refund-purchase"
src/app/api/admin/repair-attendance/route.ts       → "/api/admin/repair-attendance"
src/app/api/admin/revenue/export/route.ts          → "/api/admin/revenue/export"
src/app/api/admin/revenue/route.ts                 → "/api/admin/revenue"
src/app/api/admin/upsert-demo-members/route.ts     → "/api/admin/upsert-demo-members"
src/app/api/admin/verify-book/route.ts             → "/api/admin/verify-book"
src/app/api/admin/verify-cancellation/route.ts     → "/api/admin/verify-cancellation"
src/app/api/admin/verify-promote/route.ts          → "/api/admin/verify-promote"
src/app/api/attendance/check-in/route.ts           → "/api/attendance/check-in"
src/app/api/dev/fake-purchase/route.ts             → "/api/dev/fake-purchase"
src/app/api/health/route.ts                        → "/api/health"
src/app/api/qa/refresh/route.ts                    → "/api/qa/refresh"
src/app/api/qa/status/route.ts                     → "/api/qa/status"
src/app/api/stripe/create-checkout-session/route.ts → "/api/stripe/create-checkout-session"
src/app/api/stripe/webhook/route.ts                → "/api/stripe/webhook" (see Open Q #4)
src/app/auth/callback/route.ts                     → "/auth/callback"
src/app/auth/signout/route.ts                      → "/auth/signout"
```

### 3. Files to delete (4 files, ~600 LOC removed)

```
instrumentation.ts                — orphaned post-v0.23.1, register() never ran in prod.
sentry.server.config.ts           — imported dynamically by instrumentation.ts only.
sentry.edge.config.ts             — same.
src/app/api/dev/sentry-test/route.ts — v0.22.4 workaround route; closes post-M3 follow-up #5.
```

### 4. v0.22.x diagnostic console.logs to remove

| File | Remove |
|---|---|
| `next.config.ts` | `console.log("[next.config] module loaded, ...")` block + the wrapping v0.22.3 comment block above it. |
| `src/lib/sentry-init.ts` | `console.log("[sentry-init] module loaded, ...")` line — added in PR #76's verification iteration. |

### 5. Verification harnesses

**`src/app/api/health/route.ts` — RETAINED for v0.23.2 verification:**

```ts
// src/app/api/health/route.ts — v0.23.2
import { NextResponse, type NextRequest } from "next/server";
import { wrapRouteHandlerWithSentry } from "@sentry/nextjs";
import "@/lib/sentry-init"; // PERMANENT — /api/health doesn't import supabase.ts

export const GET = wrapRouteHandlerWithSentry(
  async function GET(req: NextRequest): Promise<NextResponse> {
    // v0.23.2 verification harness — REMOVED in v0.23.3.
    if (req.nextUrl.searchParams.get("throw") === "1") {
      throw new Error("Sentry wrapper smoke — deliberate throw from /api/health");
    }
    return NextResponse.json({
      status: "ok",
      system: "studioflow",
      version: "v0.23.2",
      release: "Sentry wrapper rollout",
    });
  },
  { method: "GET", parameterizedRoute: "/api/health" },
);
```

- `import * as Sentry from "@sentry/nextjs"` REMOVED (no more explicit captureException).
- `import "@/lib/sentry-init"` STAYS permanently.

**`src/app/api/qa/status/route.ts` — verification harness REMOVED entirely.** Wrapped normally, no `?throw=1` branch, no explicit Sentry import beyond the wrapper.

### 6. Stripe webhook — careful

Per Open Question #4. If wrapper is request-stream-safe → wrap normally. If NOT → explicit try/catch + captureException + flush instead. Document the chosen path in PR body.

## Acceptance criteria

- 21 route handlers wrapped (or equivalent try/catch for Stripe webhook if needed).
- 4 files deleted per Section 3.
- 2 diagnostic console.logs removed per Section 4.
- `/api/qa/status` harness removed; `/api/health` harness retained per Section 5.
- `next.config.ts` has no `outputFileTracingIncludes` block.
- `npx tsc --noEmit` clean. `npm run lint` 0 errors. `npm run build` clean.
- `package.json` version `0.23.2`.
- Post-M3 carry-forward #5 closed.

## How to verify

### 1. Preview deploy
`gh pr create` → preview deploy Ready.

### 2. Phil-driven Sentry capture test (no auth required)

- Hit `<preview-url>/api/health?throw=1`
- Expect HTTP 500
- Within ~30s check otwoone.sentry.io Issues feed (1H filter)
- Expect new issue: "Sentry wrapper smoke — deliberate throw from /api/health", stack frame in `src/app/api/health/route.ts`.

**Captured → approve merge. Not captured → debug; don't merge.**

### 3. Rollback if needed
`gh pr close <new-pr>`. v0.23.1 stays on main; Sentry.init still runs but no route captures. Investigate offline.

## Out of scope

- Wrapping RSC / page server components.
- Wrapping server actions.
- Wrapping middleware / proxy (edge runtime).
- Adding Sentry breadcrumbs / spans.

## PR checklist

- [ ] Branch `chore/sentry-wrapper-rollout` off `origin/main` at `88b0cf6`.
- [ ] Title: `v0.23.2: Sentry wrapper rollout + diagnostic cleanup`.
- [ ] `package.json` `0.23.2`. Co-authored-by Claude.
- [ ] PR description: pointer to spec, verification matrix in bold, planned v0.23.3 harness-removal in bold, post-M3 follow-up #5 closed.
- [ ] 21 route handlers wrapped per Section 2.
- [ ] 4 files deleted per Section 3.
- [ ] 2 console.logs removed per Section 4.
- [ ] `/api/health` and `/api/qa/status` per Section 5.
- [ ] Stripe webhook per Section 6 (wrapped OR try/catch + reason in PR body).
- [ ] Open Questions #1–#5 answered in PR body.
- [ ] CI green.
