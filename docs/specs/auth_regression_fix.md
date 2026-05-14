# Auth-chain regression fix (v0.23.3)

**Status:** FIX — diagnosis converged via Cowork's live prod SQL +
dashboard checks on 2026-05-14 (see PR #79 conversation for the full
diagnostic transcript). H2 confirmed; H1, H3, H4, H5 ruled out empirically.

**Branch:** `chore/auth-regression-investigation` off `origin/main` @
`8259cc4`.

## Root cause

**H2 — Phil's owner user_id was data-linked to the `emma-kelly` demo
seed `members` row in prod.** The `/auth/callback` member branch ran
`members.select('slug').eq('user_id', user.id).maybeSingle()`, found
the seeded row, and 302'd to `/my/emma-kelly` — which 404'd for Phil
(there's no live `/my/emma-kelly` page state for his auth.uid). The
"nothing is showing" symptom and the `/my/emma-kelly` redirect are the
same bug, not two bugs.

Cowork's prod queries on 2026-05-14 (full output in the PR comment):

```text
phil_auth     id=290e831e-…cdf7341d3d3a, email=philotbm@gmail.com,
              last_sign_in_at=2026-05-12T22:18:30Z

phil_members  id=a0000001-…000000001, slug=emma-kelly, full_name='Emma Kelly',
              studio_id=1c03183d-…7812 (demo)

phil_staff    id=980c58c9-…41dc935e, role=owner, full_name=Phil,
              studio_id=1c03183d-…7812 (demo)
```

`last_sign_in_at` advancing on 5/12 proves the callback completed
end-to-end on that attempt — Sentry-wrapper, sentry-init-side-effects,
and the URL-config hypotheses are all dead. The only surviving
hypothesis was H2, which the row dump confirms.

Cowork applied the manual data fix to prod on 2026-05-14:

```sql
UPDATE public.members
SET user_id = NULL
WHERE id = 'a0000001-0000-0000-0000-000000000001'
  AND slug = 'emma-kelly'
  AND user_id = '290e831e-…-cdf7341d3d3a';
-- 1 row updated.
```

This PR makes that fix durable.

## Why the 5/14 follow-up symptom (`/?code=…` at site root) is a separate concern

After the data fix, Phil tried a fresh prod login and the magic link
landed at `https://studioflow.ie/?code=415660b5-…` — site root, not
`/auth/callback`. The original brief framed this as an
`emailRedirectTo` bug in the login forms.

**Code reading confirms both `/login` and `/staff/login` already pass
`emailRedirectTo = ${origin}/auth/callback` correctly** (`new URL("/auth/callback", window.location.origin)`). The bug is not in the
client code. The likely cause is one of:

- Phil clicked a **stale magic link** from a pre-fix attempt where the
  intended landing was `/my/emma-kelly` and Supabase fell back to Site
  URL because that row no longer matched.
- A **Supabase email template override** in the project's Auth → Email
  Templates that renders `{{ .SiteURL }}/?token=…` instead of using
  `{{ .RedirectTo }}`. Out of scope for code review — Cowork to verify.
- The **Site URL was momentarily set to `https://www.studioflow.ie/`**
  (trailing slash) which Supabase docs say can confuse some flows. Also
  out of scope for code.

This PR hardens the login forms with an explicit comment block making
the `emailRedirectTo` invariant impossible to drop accidentally in
future edits, but does not "fix" `emailRedirectTo` — there is nothing
in the code to fix. If the 5/14 symptom recurs after this PR ships,
inspect the Supabase Auth → Email Templates and the Site URL setting
in the dashboard.

## Scope of fix

### 1. `src/app/auth/callback/route.ts` — staff-first priority

The post-exchange logic now runs the staff lookup **unconditionally
before any member resolution**, regardless of the `intent` query param:

```text
exchange code → getUser →
  staffRow exists  → next-if-safe OR /app                      (NEW: was gated by intent=staff)
  no staffRow:
    intent=staff   → /staff/login?error=not-authorised
    intent=member  → linked member → /my/{slug}
                   → unclaimed candidates → /auth/claim
                   → fallthrough → /login?error=no-member
```

This permanently closes the regression hole that linked the H2 data
issue to a user-visible 404: an owner with a stray member-row link can
never again be routed to `/my/<wrong-slug>`. The `intent` param now
gates only the failure-mode message ("not authorised" vs. member
resolution fallthrough), not the lookup order.

**Behaviour change from v0.21.0:** a staff user clicking a magic link
from `/login` (member surface) now lands on `/app` instead of falling
through to member resolution. The "login surface decides everything"
contract from v0.21.0 is gone. Staff who want to test their own member
experience must sign out, then sign in as a distinct member identity
(the pre-pilot QA workflow already uses qa-* members for this).

### 2. `supabase/seed.sql` — defensive demo-row unlink guard

Appended a final UPDATE that explicitly NULLs `user_id` on every
curated demo-studio members row (`emma-kelly`, `ciara-byrne`,
`declan-power`, …, `mairead-kinsella`) at end of seed. The previous
seed file did not set `user_id` in the INSERTs, but `ON CONFLICT (id)
DO NOTHING` meant a row whose `user_id` was set between seeds (via a
historical `/auth/claim` test, a manual SQL fix, or a now-removed debug
endpoint) would stay linked across re-seeds.

The guard is idempotent. Demo-tester scenarios that legitimately need a
linked user_id must use `qa-*` fixtures (managed by `/api/qa/refresh`),
which are out of this seed's scope.

### 3. `src/app/login/page.tsx` and `src/app/staff/login/page.tsx` — emailRedirectTo invariant comments

Both files already pass `emailRedirectTo = ${origin}/auth/callback`
correctly. Added an explicit comment block above the
`signInWithOtp` call in each form making it clear what NOT to do
(pass the bare origin) and why (link lands at `/?code=…` and the
callback never runs). No behavioural change.

### 4. `package.json` — version bump

`0.23.2` → `0.23.3`. PR #78 (`v0.23.3: Remove /api/health verification
harness`) is still open. Two paths forward:

- **Preferred: drop #78** and re-do the harness removal as v0.23.4 on
  top of this. The harness is trivial to remove again. Lower risk than
  rebasing #78 on a changed base.
- **Alternative: rebase #78** onto this PR's merge commit and re-tag it
  v0.23.4. Requires Phil to re-verify the harness removal preview.

Either way, this PR is v0.23.3 and ships first.

## Verification matrix

Phil verifies each on **preview AND prod**. The fix is green when
every box is checked on both.

| # | Surface                                                  | Expected outcome                                                                 |
|---|----------------------------------------------------------|----------------------------------------------------------------------------------|
| a | `/staff/login` + magic link to `philotbm@gmail.com`       | Email arrives, callback completes in single click-through, lands on `/app`       |
| b | `/login` + magic link to `philotbm@gmail.com` (mistake)  | Callback runs, staff-first lookup wins, lands on `/app` (NOT `/my/emma-kelly`)   |
| c | `/login` + magic link to a demo member (qa-alex)         | Email arrives, callback lands on `/my/qa-alex`                                   |
| d | Kiosk routes (`/checkin/*`, `/checkin/classes/<id>`)      | No regression. Existing behaviour unchanged.                                     |
| e | `/api/health?throw=1` (preview only — until #78 merges)   | HTTP 500, Sentry captures the event within 60s                                   |
| f | Fresh seed re-run on a scratch DB                         | After seed completes, every curated demo member row has `user_id IS NULL`        |

## Rollback plan

**Primary:** `git revert <merge-commit>`. Code-only rollback returns
the callback to its v0.21.0 intent-gated logic and removes the seed
guard. Recovery in ~5 minutes via Vercel auto-deploy. The prod data
fix Cowork applied on 5/14 stays in place — it's a row-level UPDATE,
not a deployment artefact.

**Plan B (not needed):** the original brief listed `git revert 8259cc4`
(roll all of v0.23.x back to v0.23.1) as a fallback. With H1/H3/H4/H5
ruled out, the v0.23.2 wrapper rollout is exonerated and Plan B is no
longer relevant.

**Data rollback:** the manual UPDATE Cowork applied is one-shot and
already in prod. No code in this PR depends on that UPDATE — if you
re-link Phil's user_id to emma-kelly manually for any reason, the
staff-first callback change still routes him to `/app`. The seed
guard would then re-unlink on the next seed run.

## Hypothesis post-mortem (full table)

| # | Hypothesis                                                                                       | Verdict                                                                                                                       |
|---|--------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| H1 | Supabase Auth URL config missing prod redirect URL                                              | **Ruled out.** `last_sign_in_at` advanced on 5/12 — callback ran end-to-end. Cowork's allow-list dump shows both www and non-www `/auth/callback` entries present. |
| H2 | Phil's owner user_id was data-linked to `emma-kelly` demo seed row                              | **CONFIRMED.** Smoking gun. Manual fix applied to prod 5/14; durability fix in this PR via seed unlink guard.                  |
| H3 | M4 RLS dropped the staff self-read bootstrap policy                                             | **Ruled out.** Cowork's `pg_policy` dump shows `staff can read self` (SELECT) policy present and additive to `staff_tenant_isolation`. |
| H4 | v0.23.1 `Sentry.init` from `supabase.ts` interferes with `cookies()` async-context              | **Ruled out.** The 5/12 sign-in succeeded — `cookies()` resolved fine. The kiosk `cookies()` Sentry error is a separate bug. |
| H5 | v0.23.2 `withSentryCapture` HOF breaks the redirect                                             | **Ruled out by inspection AND empirically.** HOF is a transparent success-path passthrough; 5/12 sign-in proves it doesn't drop responses. |

## Out of scope

- Supabase Site URL change to be www-canonical-only or non-www-canonical-only — hygiene item, Cowork decides via dashboard.
- Supabase Auth → Email Templates inspection (likely cause of the 5/14 `/?code=…` symptom).
- Kiosk `cookies()` outside-request-scope error — separate investigation, separate fix. Not regressed by this PR.
- Wrapping RSC / server actions / middleware with Sentry capture — future PR.
- Net-new tests — repo convention is manual smoke.
- Sprint A recurring class templates (v0.24.0).

## Open questions (non-blocking)

- Should Phil have a member row in the demo studio (e.g. for testing
  the member experience as himself)? If yes, create one with a
  distinct slug like `phil-otway` AND set `email = philotbm@gmail.com,
  phone = <his>`, so /auth/claim can link it cleanly. The current
  staff-first callback would still route him to `/app` by default; he
  could navigate to `/my/phil-otway` manually after sign-in to test
  the member surface.
- Is there a need for a `forceMember=1` (or similar) query-param
  escape hatch on `/auth/callback` to let owners test the member
  surface without signing out first? Probably not for pre-pilot;
  evaluate post-pilot if testers ask for it.
