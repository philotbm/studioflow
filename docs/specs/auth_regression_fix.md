# Auth-chain regression fix (v0.23.3 → v0.23.4)

**Status:** FIX — diagnosis converged via Cowork's live prod SQL +
dashboard checks on 2026-05-14 (see PR #79 conversation for the full
diagnostic transcript). H2 confirmed; H1, H3, H4, H5 ruled out
empirically. v0.23.3 (PR #79) shipped the staff-first callback and
seed unlink guard. v0.23.4 follows up by moving `intent` + `next` out
of `emailRedirectTo` and into an HttpOnly cookie so the Supabase
redirect-URL allow-list can be tightened back to strict matching.

**Branch:** v0.23.3 was `chore/auth-regression-investigation` off
`origin/main` @ `8259cc4`. v0.23.4 is
`chore/login-intent-cookie` off `origin/main` @ `a91c02c`.

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

---

## Resolution and follow-up (v0.23.4 — login-intent cookie)

### What happened between v0.23.3 and v0.23.4

After v0.23.3 (PR #79) shipped, the staff-first callback worked, but
end-to-end prod login still failed: magic links landed at
`https://studioflow.ie/?code=…` (site root) instead of `/auth/callback`.

Investigation showed the cause was upstream of the callback. The login
forms passed `emailRedirectTo = ${origin}/auth/callback?intent=staff&next=/app`.
Supabase's redirect-URL allow-list does a **strict prefix match**: the
allow-list entry `https://studioflow.ie/auth/callback` did NOT match
the request value `…/auth/callback?intent=staff&next=/app` because the
query string was on the URL the form passed. Supabase silently fell
back to Site URL (`https://www.studioflow.ie/`) and delivered the
magic link to the root path with `?code=…`. The callback never ran.

Cowork's interim fix (2026-05-14) was to add three wildcard entries
to the allow-list:

- `https://studioflow.ie/auth/callback?**`
- `https://www.studioflow.ie/auth/callback?**`
- `https://studioflow-wine.vercel.app/auth/callback?**`

The wildcards work but loosen the security posture: any query string
on the callback path is now accepted by Supabase. v0.23.4 closes that
hole.

### v0.23.4 design — HttpOnly cookie carries the intent

`signInWithOtp` calls in both login forms now pass exactly
`emailRedirectTo = ${origin}/auth/callback` (no query string, no path
suffix). This matches the original strict allow-list entry. `intent`
and `next` ride along in a separate channel:

1. **Form submit (client)** calls the `setLoginIntent` server action
   (`src/app/auth/actions.ts`) BEFORE `signInWithOtp`. The action sets
   an HttpOnly, SameSite=Lax cookie (`sf_login_intent`) carrying
   base64url(JSON({ intent, next, exp })). TTL is 10 minutes.

2. **`/auth/callback`** reads and clears the cookie up-front via
   `consumeLoginIntent()`. Resolves `intent` → "member" by default if
   the cookie is missing or fails decode. Resolves `next` → null on
   the same conditions. Then runs the existing v0.23.3 staff-first
   decision tree using those values.

3. The cookie is plaintext (no HMAC). Threat model: a cross-origin
   script can neither set nor read an HttpOnly cookie, so the only
   tamperer would already control the server (game over anyway).
   Garbage values fail at decode and trigger the fallback path.

### Cross-device limitation (acceptable degradation)

Cookies don't transfer between browsers. If a user submits the form
on device A and clicks the magic link on device B, the callback runs
without the intent cookie and falls back to intent="member" + next=null.
Staff users still resolve correctly (the staff-row lookup wins,
regardless of intent). Members still resolve correctly (the linked
member row drives the redirect, regardless of next). The only
degradation: a member with a saved `next=/some/page` whose magic-link
click crosses devices ends up at `/my/<slug>` instead of `/some/page`.
Acceptable for pre-pilot.

### Allow-list revert (Cowork lane)

After v0.23.4 deploys to prod AND Phil verifies end-to-end login still
works with the strict allow-list, Cowork **reverts** the three
wildcard entries added on 2026-05-14:

- Remove `https://studioflow.ie/auth/callback?**`
- Remove `https://www.studioflow.ie/auth/callback?**`
- Remove `https://studioflow-wine.vercel.app/auth/callback?**`

The four original strict entries stay:

- `https://www.studioflow.ie/auth/callback`
- `https://studioflow.ie/auth/callback`
- `https://studioflow-wine.vercel.app/auth/callback`
- `http://localhost:3000/auth/callback`

**Order of operations matters:** code change ships first → Phil
verifies prod login with strict matching → Cowork reverts wildcards.
Reverting first would re-break login.

### v0.23.4 files

- `src/lib/login-intent.ts` (new) — encode/decode helpers + cookie
  name constant + TTL constant.
- `src/app/auth/actions.ts` (new) — `setLoginIntent` server action.
- `src/app/auth/callback/route.ts` — drop URL `intent`/`next` query
  parsing; add `consumeLoginIntent()` cookie reader; preserve v0.23.3
  staff-first decision tree.
- `src/app/login/page.tsx`, `src/app/staff/login/page.tsx` — call
  `setLoginIntent` before `signInWithOtp`; pass clean `emailRedirectTo`.
- `package.json` — version bump.

### v0.23.4 verification matrix

| # | Surface | Expected outcome |
|---|---|---|
| a | `/staff/login` + magic link to `philotbm@gmail.com` | Magic link lands at `${origin}/auth/callback?code=…` (no other params); callback completes; redirects to `/app` |
| b | `/login` + magic link to a demo member with `next=/my/some-page` | Magic link lands at `${origin}/auth/callback?code=…`; callback honours `next` if safe |
| c | Cross-device magic-link click (submit form on phone, click on laptop) | No intent cookie present; callback falls back to staff-first default and member resolution; user lands somewhere sensible (`/app` for staff, `/my/<slug>` for linked member, `/login?error=no-member` otherwise) |
| d | Inspect Supabase Auth Logs after a login attempt | Single `magic_link_requested` event; magic-link target is exactly `${origin}/auth/callback` — strict allow-list match |
| e | After Cowork removes the three wildcard entries | Login still works on prod (Phil re-tests) |

### v0.23.4 rollback plan

If v0.23.4 breaks prod login: `git revert <merge-commit>`. The
emailRedirectTo URL goes back to carrying `?intent=…&next=…`, which
matches Cowork's still-in-place wildcard allow-list entries. Recovery
in ~5 min. Critical: do NOT revert the wildcard entries until after
v0.23.4 verification passes.
