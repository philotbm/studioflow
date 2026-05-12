# Sentry runtime capture — shared init module pattern

**Branch:** `chore/sentry-shared-init`
**Estimated PR scope:** ~50 LOC. One new file (`src/lib/sentry-init.ts`), two one-line side-effect imports, one temporary throw harness on `/api/qa/status`, version bump. Zero changes to existing v0.22.x diagnostic state.
**Target version:** v0.23.1 (PR #75 closes without merge; this is the actual v0.23.1).
**Depends on:** v0.23.0 ✅ (M4 RLS merged).
**Blocks:** v0.23.2 (cleanup PR that removes the v0.22.x diagnostics, v0.22.4 route-local workaround, test route, verification harness, and the now-unused `instrumentation.ts` + `sentry.{server,edge}.config.ts`).

## Problem (recap)

The Next.js 16 + Turbopack + Vercel pipeline currently excludes the compiled `.next/server/instrumentation.js` from per-function NFT bundles ([Next.js #89377](https://github.com/vercel/next.js/issues/89377)). Sentry's instrumentation-hook-based init never runs. PR #75 tried `outputFileTracingIncludes` source paths but Next's pipeline doesn't trace source → compiled for instrumentation.ts on Turbopack. No upstream fix is shipped.

## Goal

Initialize Sentry on every cold start of every function, without depending on `instrumentation.ts`. Capture errors from every route handler / RSC / server action / middleware. Use exactly two side-effect import sites — already in the codebase as transitive dependencies of every relevant entry point.

## Why now

Pilot is ~12 weeks out, need observability live before any pilot studio touches prod, the v0.22.4 route-local workaround covers exactly one route.

## Constraints

- Three-part SemVer (`v0.23.1`).
- All v0.22.x diagnostic console.logs MUST be retained in this PR. They become canaries: if Next.js fixes the upstream NFT bug and ships an `@vercel/nft >= 0.30.0` bump, `instrumentation.ts` will start loading and those console.logs will tell us immediately.
- The v0.22.4 route-local `Sentry.init()` in `/api/dev/sentry-test/route.ts` MUST be retained in this PR. Two reasons: (a) fallback observability surface in case the shared init module doesn't fully cover the verification target; (b) cleaning it up belongs in v0.23.2 once the new mechanism is proven on prod.
- The verification harness CANNOT be on `/api/health`. /api/health doesn't import `src/lib/supabase.ts`, so its function bundle won't contain `sentry-init.ts` → Sentry won't be initialized → throw won't be captured → false-negative test. Use `/api/qa/status` instead (which uses scopedQuery and so transitively pulls in supabase.ts).

## Technical approach

### 1. New file — `src/lib/sentry-init.ts`

Side-effect module. Calls `Sentry.init()` at module load. Idempotent: Sentry's `init()` de-dupes on repeated calls.

```ts
// src/lib/sentry-init.ts
/**
 * v0.23.1 — Sentry shared init module (system-wide capture).
 *
 * Side-effect import target. Imported once each from src/proxy.ts
 * (edge runtime) and src/lib/supabase.ts (node runtime, transitive
 * via every scopedQuery caller).
 *
 * Replaces the instrumentation.ts → sentry.{server,edge}.config.ts
 * dispatch chain. Upstream Next.js bug (next.js#89377) excludes the
 * compiled instrumentation.js from per-function NFT bundles on
 * Turbopack, so the instrumentation hook never runs in prod. This
 * shared init module bypasses that broken pipeline — Sentry.init()
 * runs at module-load time on whichever runtime the importing file
 * is bundled into.
 *
 * Once the upstream fix ships (@vercel/nft >= 0.30.0 in a Next.js
 * release), the instrumentation.ts hook will start working again.
 * Sentry.init's de-dup makes this module harmless in that scenario.
 *
 * PII discipline: same scrub list as the old sentry.server.config.ts.
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    beforeSend(event) {
      scrubPii(event.request?.data);
      scrubPii(event.extra);
      return event;
    },
  });
}

function scrubPii(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  for (const key of ["email", "phone", "last4", "password"]) {
    delete record[key];
  }
}
```

### 2. Side-effect import in `src/proxy.ts`

Add at the very top, ABOVE any other import.

```ts
// src/proxy.ts — TOP of file
import "@/lib/sentry-init";

// existing imports continue here
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseProxyAuthClient } from "@/lib/supabase";
// ...
```

### 3. Side-effect import in `src/lib/supabase.ts`

Add at the very top, ABOVE the supabase-js imports.

```ts
// src/lib/supabase.ts — TOP of file
import "@/lib/sentry-init";

// existing imports continue here
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// ...
```

### 4. Verification throw harness — `/api/qa/status`

```ts
// src/app/api/qa/status/route.ts — v0.23.1 verification harness
// REMOVED in v0.23.2 cleanup.
if (req.nextUrl.searchParams.get('throw') === '1') {
  throw new Error('Sentry shared-init smoke — deliberate throw from /api/qa/status');
}
```

Match whatever the existing `GET` handler signature is (likely already takes `req: NextRequest`).

### 5. Nothing else changes in v0.23.1.

- `next.config.ts` keeps its v0.22.3 console.log + comment. **DO NOT add or restore the outputFileTracingIncludes block.**
- `instrumentation.ts` keeps its current shape with 3 diagnostic console.logs.
- `sentry.server.config.ts` + `sentry.edge.config.ts` keep their Sentry.init + 1 console.log each. They're effectively orphaned but harmless (nothing imports them now).
- `/api/dev/sentry-test/route.ts` keeps its v0.22.4 route-local workaround.

All of those go away in v0.23.2.

## Acceptance criteria

- `src/lib/sentry-init.ts` exists, exports nothing, calls `Sentry.init()` at module load with PII-scrubbing beforeSend.
- `src/proxy.ts` first import is `import "@/lib/sentry-init";`.
- `src/lib/supabase.ts` first import is `import "@/lib/sentry-init";`.
- `/api/qa/status` has the `?throw=1` branch with the marker comment.
- `npx tsc --noEmit` clean. `npm run lint` 0 errors. `npm run build` clean.
- `package.json` version `0.23.1`.
- No changes to: `instrumentation.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `next.config.ts`, `/api/dev/sentry-test/route.ts`, `/api/health/route.ts`.

## How to verify

### 1. Build & preview deploy

`gh pr create` → Vercel preview deploy. Confirm build log + Sentry source-map upload.

### 2. Phil-driven preview Sentry capture test (BEFORE merging)

Phil needs an active studioflow staff session for the proxy to let `/api/qa/status` through. Once signed in on the preview URL:

- Hit `<preview-url>/api/qa/status?throw=1`
- Expect HTTP 500
- Within ~30s, check Sentry → otwoone.sentry.io → Issues feed (1H filter)
- Expectation: new issue titled "Sentry shared-init smoke — deliberate throw from /api/qa/status".

**If captured:** shared init module works. Phil approves merge.

**If NOT captured within 60s:** the implicit Sentry capture path didn't fire. Don't merge. Add explicit `Sentry.captureException(err)` + `await Sentry.flush(2000)` to the throw branch (mirror the v0.22.4 pattern), re-verify. If THAT works, ship with the explicit wrapper. If still doesn't work, escalate.

### 3. Rollback (if neither implicit nor explicit capture works)

`gh pr close <new-pr> --comment "Reverted, fix is deeper than init-site."` The v0.22.4 route-local workaround on /api/dev/sentry-test stays in place. Re-read Next.js issue #89377 for any commit traffic since 2026-05-12.

## Out of scope

- v0.22.x diagnostic cleanup → v0.23.2.
- v0.22.4 route-local workaround removal → v0.23.2.
- Deleting `/api/dev/sentry-test/route.ts` → v0.23.2.
- Deleting `instrumentation.ts`, `sentry.{server,edge}.config.ts` → v0.23.2 OR later (harmless when unused).
- Removing the `/api/qa/status?throw=1` harness → v0.23.2.

## PR checklist

- [ ] PR #75 closed without merge.
- [ ] Branch `chore/sentry-shared-init` off `origin/main` at `d05acf8`.
- [ ] Title: `v0.23.1: Sentry shared init module (system-wide capture)`.
- [ ] `package.json` `0.23.1`. Co-authored-by Claude.
- [ ] PR description: pointer to `docs/specs/sentry_shared_init.md`, verification matrix in bold, planned v0.23.2 cleanup scope in bold, explicit note that v0.22.x diagnostics + v0.22.4 workaround RETAINED.
- [ ] `src/lib/sentry-init.ts` created.
- [ ] `src/proxy.ts` first import line is `import "@/lib/sentry-init";`.
- [ ] `src/lib/supabase.ts` first import line is `import "@/lib/sentry-init";`.
- [ ] `/api/qa/status` has the `?throw=1` branch + REMOVED-in-v0.23.2 comment.
- [ ] No changes to: instrumentation.ts, sentry.{server,edge}.config.ts, next.config.ts, /api/dev/sentry-test/route.ts, /api/health/route.ts.
- [ ] CI green.
