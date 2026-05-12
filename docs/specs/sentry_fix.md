# Sentry runtime-capture system-wide fix

**Branch:** `chore/sentry-system-wide-fix`
**Estimated PR scope:** ~10 LOC. One config block in `next.config.ts`, plus the `package.json` version bump. Zero application code changes.
**Target version:** v0.23.1
**Depends on:** v0.23.0 ✅ (M4 RLS merged).
**Blocks:** v0.23.2 (the cleanup PR that removes diagnostics + the route-local workaround + the test route).

## Problem (root cause, diagnosed 2026-05-11)

`instrumentation.ts` exists at the project root. Next.js is *supposed* to compile it to `.next/server/instrumentation.js` and run its `register()` function once per server cold start. On Vercel + Next 16 + Turbopack, this isn't happening: the per-function NFT trace (`.next/server/app/api/<route>/route.js.nft.json`) doesn't include `instrumentation.js`. Only Next's internal `instrumentation-globals.external.js` loader is listed. Route module then silently swallows the resulting `MODULE_NOT_FOUND` when its loader tries `require('<distDir>/server/instrumentation.js')`. `register()` is never called. Sentry's instrumentation hook never registers. Every error since v0.21.0.4 has gone uncaptured (except the four v0.22.x diagnostic deploys' boot logs, which also never appeared — confirming the failure).

The four v0.22.x diagnostic PRs (#71–#74) each added a different layer of console.log to narrow this down:
- v0.22.1 (#71): boot-time DSN logs in `sentry.server.config.ts` + `sentry.edge.config.ts` — never fired in Runtime Logs.
- v0.22.2 (#72): `register()` invocation logs in `instrumentation.ts` — never fired.
- v0.22.3 (#73): `next.config.ts` module-load log — fires at BUILD time (confirming `next.config.ts` is loaded by the bundler), not Runtime (ruling out a `next.config.ts` load failure as the cause).
- v0.22.4 (#74): the route-local `Sentry.init()` workaround on `/api/dev/sentry-test/route.ts` proves the Sentry SDK + DSN + network path all work end-to-end — so the failure is *exclusively* the instrumentation hook.

`grep instrumentation .next/server/app/api/health/route.js.nft.json` on a local `next build` confirmed `instrumentation.js` is absent from the trace. That's the smoking gun.

## Goal

Force `instrumentation.ts` (and the two Sentry config files it dynamic-imports) into every per-function NFT trace via `outputFileTracingIncludes`. After this lands, `register()` runs on every cold start of every function, Sentry's `onRequestError` handler is wired up, and every server / RSC / route-handler / server-action / middleware error is captured.

## Why now

Without this fix, the only Sentry capture surface is the v0.22.4 route-local workaround in `/api/dev/sentry-test`. M4 just landed; the pilot is ~12 weeks out. We need real observability before any pilot studio touches prod, and we want to retire the route-local workaround + the test route before the cleanup PRs in the post-M3 follow-up list become stale.

## Constraints

- Three-part SemVer (`v0.23.1`).
- No application code changes — config-only.
- All v0.22.x diagnostic console.logs MUST be retained in this PR. They are the verification surface. Their cleanup is the v0.23.2 PR's job, and only after Phil confirms this PR's fix is working in prod.
- The route-local `Sentry.init()` in `/api/dev/sentry-test/route.ts` MUST be retained in this PR. It's our only proven Sentry capture surface; removing it before the system-wide fix is verified would create a window with no observability.
- Single commit in `next.config.ts` (plus the version bump commit). Don't refactor surrounding code.

## Technical approach

### 1. `next.config.ts` — add `outputFileTracingIncludes`

Current `next.config.ts` (post-v0.22.3) has a module-load console.log followed by an empty `NextConfig` object wrapped in `withSentryConfig`. Add the trace-includes block to the `NextConfig`:

```ts
// next.config.ts — relevant addition (Next 16; confirm namespace per open question #1)

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '**/*': [
      './instrumentation.ts',
      './sentry.server.config.ts',
      './sentry.edge.config.ts',
    ],
  },
};
```

If the open-question check shows Next 16 still expects `experimental.outputFileTracingIncludes`, nest it under `experimental` instead. Document the choice in the PR description so future-Phil knows.

### 2. `package.json` version bump

`"version": "0.23.0"` → `"version": "0.23.1"`. Three-part SemVer. Standalone commit on the branch.

### 3. Nothing else changes.

- `instrumentation.ts` keeps its 3 diagnostic console.logs.
- `sentry.server.config.ts` keeps its 1 diagnostic console.log.
- `sentry.edge.config.ts` keeps its 1 diagnostic console.log.
- `next.config.ts` keeps its 1 module-load console.log (the new tracing config sits alongside it).
- `/api/dev/sentry-test/route.ts` keeps its v0.22.4 route-local Sentry.init + the route-local boot console.log + the captureException + flush block.

All of those go away in v0.23.2 once this fix is verified.

## Acceptance criteria

- `next.config.ts` exports a `NextConfig` with `outputFileTracingIncludes` configured to inject the three files into every function bundle.
- `npx tsc --noEmit` clean. `npm run lint` 0 errors. `npm run build` clean. Build output should include a one-line message about source-map upload from `withSentryConfig`.
- `package.json` version `0.23.1`.
- After the Vercel deploy lands, on a cold-start invocation of *any* function, Vercel Runtime Logs show all of:
  - `[next.config] module loaded, NODE_ENV: ...`  (build-time, was already firing)
  - `[Sentry] server config booting, DSN: set`  (NEW — v0.22.1 log finally fires)
  - `[instrumentation] register() called, NEXT_RUNTIME: nodejs`  (NEW — v0.22.2 log finally fires)
  - `[instrumentation] nodejs branch entered, awaiting import`  (NEW)
  - `[instrumentation] nodejs branch import resolved`  (NEW)
- Phil-driven smoke: hit `/api/health` (which has no route-local Sentry init), deliberately cause it to throw (see Verification matrix). The throw should arrive in Sentry within ~30s, captured via `onRequestError` exported from `@sentry/nextjs` in `instrumentation.ts` — NOT via any route-local `captureException`.

## How to verify

### 1. Build & preview deploy

`gh pr create` → Vercel preview deploy. Confirm Vercel build log includes the source-map upload line.

### 2. Phil-driven prod smoke (after merge)

Vercel auto-deploys main → prod. Phil checks **Vercel → studioflow → Logs → Runtime Logs**, filters on the most recent 10 minutes, looks for the 4 NEW console.log lines listed in Acceptance criteria. They fire on the first cold start of any function after the deploy.

### 3. Sentry capture confirmation (Phil-driven)

Add a one-off, two-line throw to `/api/health/route.ts` behind a `?throw=1` query param — for this verification ONLY. The throw is removed in the v0.23.2 cleanup PR. Example:

```ts
// /api/health/route.ts — TEMPORARY verification harness, removed in v0.23.2
if (req.nextUrl.searchParams.get('throw') === '1') {
  throw new Error('Sentry instrumentation smoke — deliberate throw from /api/health');
}
```

Phil signed in as owner hits `https://studioflow.ie/api/health?throw=1`, returns 500, then checks Sentry within 30s. Expectation: a new event named "Sentry instrumentation smoke — deliberate throw from /api/health" appears, captured via `onRequestError` (the breadcrumb metadata should mention `instrumentation` in the capture path). If yes, the system-wide fix works. If no, something deeper is wrong and we escalate before merging v0.23.2.

> **Important:** the throw on `/api/health` is the cleanest verification because that route has NO route-local Sentry init. If the throw is captured, it can ONLY be coming through the instrumentation hook. Triggering a throw on `/api/dev/sentry-test?throw=1` would be ambiguous because the v0.22.4 route-local init is still in place — capture there could come from either path.

### 4. Rollback (only if verification fails)

`git revert <merge-commit>`. The v0.22.4 route-local workaround is untouched, so Sentry capture on `/api/dev/sentry-test` keeps working. Investigate the open-question answers (namespace, glob, paths) and re-spec.

## Out of scope

- Removing diagnostic console.logs — that's v0.23.2.
- Removing the v0.22.4 route-local init — that's v0.23.2.
- Deleting `/api/dev/sentry-test/route.ts` — that's v0.23.2 (also a post-M3 follow-up).
- Source-map upload changes. The `withSentryConfig` wrapper already handles this if `SENTRY_AUTH_TOKEN` is set in Vercel build env; if it isn't, builds succeed silently and stack traces show minified frames. Not this PR's problem.

## PR checklist

- [ ] Branch `chore/sentry-system-wide-fix` off `origin/main` at `d05acf8`.
- [ ] Title: `v0.23.1: System-wide Sentry runtime capture (outputFileTracingIncludes)`.
- [ ] `package.json` `0.23.1`. Co-authored-by Claude.
- [ ] PR description: pointer to `docs/specs/sentry_fix.md`, verification matrix in bold, planned v0.23.2 cleanup scope in bold, explicit note that all v0.22.x diagnostics RETAINED.
- [ ] `next.config.ts` has the new `outputFileTracingIncludes` block, all existing console.log + comment retained.
- [ ] No changes to `instrumentation.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, or `/api/dev/sentry-test/route.ts`.
- [ ] Open question #1 (Next 16 namespace) answered in PR description.
- [ ] CI green.
