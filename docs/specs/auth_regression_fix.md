# Auth-chain regression diagnosis (v0.23.x)

**Status:** PROPOSAL — read-only investigation, no fix applied yet.
**Branch:** `chore/auth-regression-investigation` off `origin/main` @ 8259cc4.
**Scope:** Three reported symptoms treated as one chain regression:

1. Prod `/staff/login` with `philotbm@gmail.com` (5/12 EOD): "nothing is showing."
2. Post-login member redirect lands on `/my/emma-kelly` (wrong slug for Phil).
3. Kiosk `cookies()` outside-request-scope Sentry error.

This doc reads the code on `8259cc4` against the v0.21.0 baseline (last
known good auth ship, `355c111`) and ranks hypotheses by code evidence.
Three of the four investigation steps below require Phil to advance them
on a preview deploy — the diagnosis can't conclude from code reading
alone.

---

## What the code shows

### The auth chain (current main, 8259cc4)

```
/staff/login (client) ──signInWithOtp──▶ Supabase emails magic link
   │                       │
   │                       └─ callbackUrl = origin + /auth/callback?intent=staff&next=/app
   │
   ▼ (Phil clicks link)
Supabase ──302──▶ /auth/callback?code=XXX&intent=staff&next=/app
   │
   ▼ (handled by src/app/auth/callback/route.ts)
withSentryCapture(
  GET():
    1. exchangeCodeForSession(code)        — PKCE handshake, sets cookie
    2. getUser()                            — reads the cookie session
    3. if intent=staff:
         staff.select("id").eq("user_id", user.id).maybeSingle()
         if no row → 302 /staff/login?error=not-authorised
         else     → 302 /app
       else (member path):
         members.select("slug").eq("user_id", user.id).maybeSingle()
         if linked → 302 /my/{slug}
         else      → check unclaimed candidates or → /login?error=no-member
)
```

### Diff from last known good (v0.21.0 → v0.23.2)

- **`src/app/auth/callback/route.ts`**: zero behavioural changes from v0.21.0.
  The ONLY delta is the v0.23.2 wrapper:
  ```diff
  -export async function GET(req: NextRequest) {
  +export const GET = withSentryCapture(
  +  async function GET(req: NextRequest) {
     // ... handler body identical ...
  -}
  +},
  +  { method: "GET", parameterizedRoute: "/auth/callback" },
  +);
  ```
- **`src/lib/supabase.ts`**: v0.23.1 added `import "@/lib/sentry-init";` at
  the top of the file (line 6). This is the only change to this module
  since v0.20.1 / M1.
- **Schema/RLS**: v0.22.0 (M3) added `studio_id` to `members` and `staff`
  and changed `UNIQUE(user_id)` → `UNIQUE(studio_id, user_id)` on members.
  v0.23.0 (M4) enabled RLS on every tenant-scoped table with a
  `tenant_isolation` policy plus an additive "staff can read self" bootstrap.

### `withSentryCapture` HOF — read carefully

```ts
return async (...args: Args) => {
  try {
    return await handler(...args);    // success path: transparent passthrough
  } catch (err) {
    Sentry.captureException(err);
    await Sentry.flush(2000);
    throw err;
  }
};
```

On the **success path** this wrapper is functionally a no-op: it awaits
the handler, gets back the `NextResponse.redirect(...)`, and returns it
unchanged. It doesn't touch headers, doesn't await flush, doesn't alter
status. **The wrapper hypothesis is weak on inspection** — if the
callback returns a 302 normally, the wrapper relays the 302 unchanged.

The wrapper only changes behaviour on a **thrown** error: it adds up to
2s of flush latency before the 500. Without the wrapper, the same code
would still 500 (just with no Sentry capture). It cannot turn a working
redirect into "nothing shows."

---

## Hypotheses ranked

### **H1 (most likely) — Supabase Auth URL config has not been updated for prod.**

Symptom match: "nothing is showing" maps cleanly to "form said `Magic
link sent to philotbm@gmail.com`, but the email never arrived."

The staff/login form does no silent error swallow — it calls
`signInWithOtp` and surfaces `otpError.message` in red if Supabase returns
one. But if Supabase **accepts** the request and silently drops the email
because the redirect URL isn't on the allow-list, the form shows the
green "Magic link sent" toast and the email never lands. That's
indistinguishable from "nothing shows" to a tester.

This is also the explanation that doesn't require any v0.23.x change to
the codebase to produce a regression — it just requires the prod
Supabase project's URL Configuration to have drifted (or to have never
been set for `https://studioflow.ie`).

**Evidence Phil can gather (I can't from this tool):**
- Supabase Dashboard → Authentication → Logs → filter for
  `magic_link_requested` events for `philotbm@gmail.com` in the last
  48h. If absent: Supabase didn't accept the request (otpError should
  have shown on screen — anything else is a frontend bug). If present:
  Supabase accepted the request but may have dropped the email.
- Resend dashboard → outbound auth-emails to that address in last 48h.
  If absent: the email never left.
- Supabase Dashboard → Authentication → URL Configuration → Site URL
  and Redirect URLs MUST contain `https://studioflow.ie` and
  `https://studioflow.ie/auth/callback`. Likely also need every Vercel
  preview wildcard (`https://*-philotbm-9690s-projects.vercel.app/auth/callback`).

**Fix scope if H1 is the cause:** Supabase dashboard config update. No
code change.

---

### **H2 (likely, independent of H1) — `/my/emma-kelly` is a data issue, not a code regression.**

The callback's member branch runs:

```ts
const { data: linked } = await supabase
  .from("members")
  .select("slug")
  .eq("user_id", user.id)
  .maybeSingle();

if (linked?.slug) {
  // ...
  return NextResponse.redirect(new URL(`/my/${linked.slug}`, origin));
}
```

For Phil to land on `/my/emma-kelly`, the database must contain a
`members` row where `user_id = <Phil's auth.uid>` AND `slug = 'emma-kelly'`.

This row was almost certainly created by the demo seed (likely
`/api/admin/upsert-demo-members` or `/api/qa/refresh`) at some point —
the seed pre-fills demo members with synthetic emails, but if Phil's
email was ever entered into one of the seed-row update flows, his user_id
would get linked.

`.maybeSingle()` errors if `>1` rows match. Pre-M3 the
`UNIQUE(user_id)` index made >1 rows impossible. Post-M3 the index
became `UNIQUE(studio_id, user_id)`, so Phil's user_id could legally be
linked to one member row per studio. With only one studio in prod
today, there's still effectively one row — so `.maybeSingle()` succeeds
and returns `slug='emma-kelly'`.

**Fix scope if H2 is the cause:**
- (a) Data fix: `UPDATE members SET user_id = NULL WHERE slug = 'emma-kelly';`
  in prod, OR
- (b) Code fix: prefer staff-row lookup over member-row lookup when both
  exist (Phil is owner-staff, not a member, so member-branch shouldn't run
  for him at all if he hits `/login` by mistake — but the current code has
  no notion of "this user is staff, don't route them to /my").

(b) implies tweaking the callback to short-circuit the member branch
when a staff row exists. That's a real code change and changes the
v0.21.0 contract ("login surface choice is the disambiguator"). Probably
the wrong fix; (a) is cheaper.

---

### **H3 (plausible, but requires evidence) — M4 RLS broke the staff-row self-read.**

The proxy AND the callback both run the same shape of query:

```ts
supabase.from("staff").select(...).eq("user_id", user.id).maybeSingle()
```

This works only if either (i) `current_studio_id()` resolves correctly
under RLS, or (ii) the additive "staff can read self" policy permits
the anon-role read.

Per `AGENTS.md`: "The v0.21.0 'staff can read self' policy is kept
additively as the bootstrap for `current_studio_id()` resolution."

If that policy was dropped or renamed during the M4 migration and the
team didn't notice (because no prod staff login was attempted between
v0.23.0 and now), every staff self-read returns zero rows. The callback
then 302s to `/staff/login?error=not-authorised`.

That redirect lands on `/staff/login` with an amber banner saying "This
email isn't registered as studio staff." Phil's "nothing is showing"
might match this if the page renders blank for some reason (e.g. the
banner only renders inside the Suspense boundary and that hangs).

**Evidence Phil can gather:**
- Supabase Dashboard → SQL Editor:
  ```sql
  SELECT polname, polcmd FROM pg_policy
  WHERE polrelid = 'public.staff'::regclass
  ORDER BY polname;
  ```
  Expect `tenant_isolation` (FOR ALL) AND a self-read policy.
  Likely names: `staff_self_read`, `staff can read self`, or similar.
- Or: `SELECT * FROM staff WHERE user_id = '<Phil's user_id>';` under
  the anon role (set `request.jwt.claim.sub` first) and confirm it returns
  a row.

**Fix scope if H3 is the cause:** re-add the self-read policy via
migration.

---

### **H4 (weak) — sentry-init transitive import breaks `next/headers cookies()` context.**

The hypothesis: `Sentry.init()` from v0.23.1 installs OpenTelemetry HTTP
instrumentation, which interferes with Next 16's `AsyncLocalStorage`
that backs `cookies()` from `next/headers`.

Code evidence AGAINST:
- The `cookies()` call is inside `getSupabaseServerAuthClient`, which is
  itself awaited from within a route-handler request scope. It's not at
  module-load time.
- Every cookie-using route would break in unison if this were broken
  globally — the operator surface (`/app`), the instructor surface,
  `/api/admin/*`, etc. None of those are reported broken.
- The kiosk `cookies()` error Phil mentions (#3) is the only signal that
  *something* is wrong with cookie context. But I can't find a `cookies()`
  call anywhere in `src/app/checkin/**` — the kiosk is client-side
  rendered (`use client` in layout, the page is `CheckInClass`
  component, the check-in API uses service role). The error must originate
  somewhere else under `/checkin` or in a server-rendered path I can't see
  without reading the Sentry stack.

**Evidence Phil can gather:**
- The exact Sentry issue URL for the `cookies() outside request scope`
  error. The stack frame's `at GET (...)` line tells us which route
  is misbehaving. Then we can read that file and reason from there.

**Fix scope if H4 is the cause:** move `import "@/lib/sentry-init"` out
of `src/lib/supabase.ts` module-top into the function bodies that
actually need it (or accept it loads lazily on first call). Keep the
side-effect import in `src/proxy.ts` for edge runtime cold start. This
gives Sentry capture coverage everywhere but doesn't run `Sentry.init()`
during cookie-context-sensitive imports.

---

### **H5 (weak) — `withSentryCapture` wrapper changed the redirect.**

Read the HOF body. Success path is transparent. This hypothesis doesn't
survive code inspection. Phil's strong-suspect framing in the original
brief was reasonable given the timing (the wrapper rollout was the most
recent change), but the wrapper's semantics rule it out as a cause for
"nothing is showing" or a wrong redirect target. Listed here only so we
can rule it out explicitly.

**To falsify cleanly anyway:** Step 2 (console.log inside the wrapped
handler) on a preview deploy will show whether the handler is being
invoked. If it is, the wrapper is innocent.

---

## Investigation steps Phil needs to advance

Each step that comes back negative kills one hypothesis. Cheapest first.

### Step 1 — Supabase + Resend dashboards (H1 falsification, no deploy)
- Supabase Auth → Logs → `magic_link_requested` events for
  philotbm@gmail.com in last 48h?
- Resend → outbound emails to philotbm@gmail.com in last 48h?
- Supabase Auth → URL Configuration → does the Site URL include
  `https://studioflow.ie` and the Redirect URLs include
  `https://studioflow.ie/auth/callback` (+ any preview wildcards)?

**Outcomes:**
- All three healthy → H1 ruled out, proceed to Step 2.
- Magic link request absent → Supabase rejected the OTP request, which
  means the frontend silently dropped an error. Investigate the form.
- Magic link requested but no Resend email → email-deliverability issue
  outside this code's scope.
- URL Configuration missing prod URL → that's the fix. No code change.

### Step 2 — Confirm the callback is being invoked at all (H5 falsification, requires preview deploy)
- One-line diff on this branch: add `console.log("[auth/callback] invoked", { url: req.url });` as the FIRST line inside the wrapped handler.
- Push, deploy preview, Phil hits `<preview>/auth/callback?code=test&intent=staff` directly in a browser.
- Watch Vercel Runtime Logs for the line.

**Outcomes:**
- Log fires → handler is being invoked. Failure is downstream (Step 3 or 5).
- Log does NOT fire → wrapper or routing is swallowing the request. H5
  upgraded; investigate by un-wrapping locally.

### Step 3 — Pin down `/my/emma-kelly` (H2 confirmation, no deploy)
- Phil runs in Supabase SQL editor:
  ```sql
  SELECT id, slug, email, phone, user_id, studio_id, created_at
  FROM members
  WHERE user_id = '<Phil's auth.users.id>';
  ```
- If a row comes back with `slug='emma-kelly'`: H2 confirmed.
  Fix: `UPDATE members SET user_id = NULL WHERE slug = 'emma-kelly';`

### Step 4 — Check the staff self-read RLS policy (H3 falsification, no deploy)
- Supabase SQL editor:
  ```sql
  SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_clause
  FROM pg_policy WHERE polrelid = 'public.staff'::regclass
  ORDER BY polname;
  ```
- Expect: `tenant_isolation` row (FOR ALL) AND a self-read row keyed on
  `user_id = auth.uid()` (FOR SELECT).
- If the self-read row is missing or renamed, H3 confirmed.

### Step 5 — Identify the kiosk `cookies()` Sentry issue (H4 starting point, no deploy)
- Phil pulls the Sentry issue URL for the
  `cookies() outside request scope` error.
- Stack frame top line tells us which route handler is misbehaving.
  Then we read that file and propose the fix in this doc.

---

## What this PR will eventually do (placeholder — pending Phil approval)

Until Steps 1–5 land their evidence, the actual fix scope is unknown.
Two coherent fixes are likely:

**Most likely fix (if H1 + H2 land):**
- Supabase dashboard: add prod URLs to Redirect URLs allow-list. (No
  code change, manual step.)
- Data fix in prod: `UPDATE members SET user_id = NULL WHERE
  slug = 'emma-kelly';` (Manual SQL, no code change.)
- Code: add a "linked-but-likely-mismatched" guard to the callback
  member branch that prefers staff-row resolution when both exist.
  Probably not necessary for v0.23.x — defer.

**Alternative fix (if H4 lands):**
- Move `import "@/lib/sentry-init"` out of `src/lib/supabase.ts`
  module-top, deferring it until first call into the
  cookie-aware client helpers. Keep it in `src/proxy.ts` (edge cold
  start).

---

## Verification matrix (post-fix)

Each box Phil hits manually on preview AND prod. The fix is verified
when every box is green on both.

| Surface                                | Expected outcome                                      |
|----------------------------------------|-------------------------------------------------------|
| `/staff/login` + magic link to philotbm@gmail.com | Email arrives, callback 302s to `/app` |
| `/login` + magic link to a demo member (qa-alex@example.com) | Email arrives, callback 302s to `/my/qa-alex` |
| `/login` + magic link to philotbm@gmail.com (member surface)  | Callback 302s to `/staff/login?error=not-authorised` OR `/login?error=no-member` (NEVER `/my/emma-kelly`) |
| Whichever kiosk path triggered Sentry's `cookies()` error | No new Sentry issue with that signature |
| `/api/health?throw=1` (preview only — harness still present until v0.23.3) | HTTP 500, Sentry captures within 60s |

## Rollback plan

If the fix lands on prod and doesn't restore login within 10 minutes:

1. **Code-only rollback** (if the fix was a code change):
   `git revert <merge-commit>` from a clean branch. Pushes to main,
   Vercel auto-deploys, prod returns to the pre-fix state. 5-minute
   recovery.

2. **Plan B — full v0.23.x rollback to v0.23.1:**
   `git revert 8259cc4` on a hot-fix branch off main. Returns prod to
   v0.23.1 state — `Sentry.init` still runs system-wide via the shared
   init module, but no route-handler `withSentryCapture` wrapper. Errors
   surface to Vercel logs but not (reliably) to Sentry. Acceptable
   regression for an emergency.

3. **Database rollback (H2 fix only):**
   The H2 fix is `UPDATE members SET user_id = NULL WHERE
   slug = 'emma-kelly';`. To roll back: re-link Phil's user_id back to
   the row. Phil should grab the original `user_id` value via `SELECT`
   before running the UPDATE so re-linking is one statement away.

## Open questions for Phil

- **Staff login form**: confirmed using `signInWithOtp` (magic link, PKCE).
  No `signInWithPassword` path. ✅
- **Last successful prod login** (any user): brackets the regression
  window. v0.21.0 (5/8) shipped staff auth. v0.22.0, v0.23.0, v0.23.1,
  v0.23.2 all shipped between then and now. If anyone logged in
  successfully on prod between any pair of those, the regression window
  narrows.
- **Phil's row state in prod**: does `philotbm@gmail.com` exist in both
  `staff` AND `members` for the demo studio, or just `staff`? The H2 fix
  is "set member.user_id = NULL where slug='emma-kelly'". If Phil
  *should* have a real member row too (he wants to test the member
  experience as himself), the row state needs to be: staff row (owner)
  with user_id=Phil, OR a member row with user_id=Phil and the correct
  slug (e.g. `phil-otway`), OR both. The current row state (Phil's
  user_id linked to the seed `emma-kelly` row) is incoherent.

---

## Process notes

- This branch will be opened as a **draft PR** with this doc + any
  diagnostic commits (e.g. the Step 2 console.log if it gets that far).
- The actual fix code will go in a separate commit on this branch
  ONLY after Phil approves the diagnosis.
- Versioning is deferred. If v0.23.3 (PR #78) merges first, this lands
  as v0.23.4. If v0.23.3 hasn't merged when Phil approves the fix, the
  package.json bump will be sequenced after #78 is merged to avoid
  conflicts.
