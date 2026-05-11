# M3 — Multi-tenancy implementation (`studio_id` everywhere)

**Branch:** `feat/m3-multi-tenancy`
**Estimated PR scope:** ~600–900 LOC. One migration file (~200 lines SQL), one `current_studio_id()` PL/pgSQL function, `scopedQuery()` body change (~30 lines), ~11 RPC-site `p_studio_id` parameter additions, ~5 PL/pgSQL functions in `supabase/functions.sql` updated to filter by `current_studio_id()`, schema/seed updates, two AGENTS.md edits, one cron follow-up TODO.
**Target version:** v0.22.0 (three-part SemVer reverted at this PR).
**Depends on:** v0.21.0.5 ✅ merged (M2.5 `scopedQuery()` pass-through is on `main`, commit `a080d05`). CI baseline ✅ on `main`. ADR-0001 ✅ committed at `docs/adr/0001-multi-tenancy.md` (commit `9659b3d`).
**Blocks:** M4 (RLS at `v0.23.0`). M4 cannot ship without `studio_id` on every tenant-scoped row.
**ADR reference:** `docs/adr/0001-multi-tenancy.md` — six locked decisions. Do NOT re-litigate any of them in this PR; if a decision feels wrong, surface that the ADR is being reopened rather than diverging silently.

---

## Preflight — do not start coding until all green

- [ ] **`main` is at `v0.21.0.5`, commit `a080d05`** (`refactor — scopedQuery() pass-through helper for tenant-scoped reads`, PR #68). If newer commits landed since this spec was drafted, re-base mentally and confirm the conventions below still hold.
- [ ] **`docs/adr/0001-multi-tenancy.md` is present on `main`.** Read it before writing code.
- [ ] **CI baseline is green on `main`.** M3 is the biggest PR running through CI; pre-existing warnings that have flipped to errors get fixed first as a separate chore.
- [ ] **Sentry env vars in Vercel Production** — `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. Without these the M3 deploy will not crash, but the runtime safety net for a missed `studio_id` filter won't engage. Nice-to-have, not a hard blocker.
- [ ] **`src/lib/db.ts` exports `scopedQuery(): Promise<SupabaseClient | null>`** — pass-through after M2.5. This PR replaces its body.
- [ ] **No in-flight branches touch:** `src/lib/db.ts`, `supabase/schema.sql`, `supabase/functions.sql`, `supabase/seed.sql`, `src/proxy.ts`, `src/lib/auth.ts`.
- [ ] **Repo head clean.** `git status` shows no untracked or modified files in the worktree.

## Goal

Convert StudioFlow from single-tenant to multi-tenant backed by a `studios` table with `studio_id` on every tenant-scoped row. After this lands:

- A `studios` table exists. One row — `slug='demo'`, `name='Demo Studio'`, `plan_id='studio'`, `member_count_cap=NULL` — into which every existing production row has been backfilled.
- Every tenant-scoped data table (`members`, `staff`, `classes`, `class_bookings`, `plans`, `credit_transactions`, `purchases`, `booking_events`) carries `studio_id uuid NOT NULL REFERENCES studios(id)`. (No separate `waitlist` table — waitlisted entries are `class_bookings` rows with `booking_status='waitlisted'`. The ADR's "credit_ledger" was abstract; the real table is `credit_transactions`.)
- The unique indexes on `members(user_id)` and `staff(user_id)` are replaced by `UNIQUE(studio_id, user_id)` (partial on members, full on staff) per ADR Decision 3.
- A `current_studio_id()` PL/pgSQL function resolves the caller's `studio_id` from their `staff` row first, then their `members` row.
- `scopedQuery()` in `src/lib/db.ts` is no longer a pass-through. Its body returns a Proxy that auto-applies `.eq('studio_id', current_studio_id())` to every `.from(<tenant_scoped_table>)` call.
- Every `.rpc(...)` site with a `TODO(M3): pass studio_id explicitly` marker now passes `p_studio_id: <resolved>` and the function filters by that parameter.
- `studios.stripe_customer_id` and `studios.stripe_subscription_id` columns exist but are not wired up by handler logic (Sprint C).
- RLS remains **OFF** on data tables and the new `studios` table (M4 turns RLS on in one shot).
- `/api/admin/rebase-demo-classes` carries a TODO to iterate per-studio or be retired in Sprint A.

**Behaviour change vs. v0.21.0.5:** none user-facing — there's exactly one studio, and `current_studio_id()` returns its id for every signed-in user. The point is baking the multi-studio shape in so adding studio #2 becomes an `INSERT` + CSV import, not a re-platforming.

## Why now

Pilot ~2026-08-03 (12 weeks). M3 must land in the next week or two to leave room for M4 RLS, the sellable track, and a buffer week. M2.5 just merged with every tenant-scoped call site already on `await scopedQuery()` — bolting the filter into the helper now is a ~30-line change; doing it later is a ~300-line change after feature work has accumulated. Strike while the call-site surface is clean.

## Constraints to read before coding

- **ADR-0001 is canonical for every architectural decision.** Spec ↔ ADR divergence → ADR wins.
- **Manual prod-Supabase migration apply.** Prod migrations are NOT applied automatically on Vercel deploy. The "How to verify" section flags this in bold.
- **`/api/stripe/webhook` MUST keep its current shape.** Server-to-server, no caller session — `current_studio_id()` would return NULL. The "Intentional cross-tenant exception" comment block from M2.5 stays in place. Decision 4 handler logic is Sprint C, not M3.
- **Auth helpers in `src/lib/auth.ts` are NOT migrated.** Cookie-bound auth clients, not the anon one. Same for `src/proxy.ts` staff self-read, `src/app/auth/callback`, `src/app/auth/claim`, `src/app/app/layout.tsx`'s member-row lookup.
- **`current_studio_id()` is `STABLE` + `SECURITY DEFINER`** with `search_path = public`. Anonymous session → returns `NULL`.
- **The migration is a single transaction.** `BEGIN; … COMMIT;` with `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` throughout for idempotency.
- **Versioning discipline.** Migration filename `supabase/v0.22.0_migration.sql`. PR title `v0.22.0: Multi-tenancy (studios + studio_id everywhere)`. **Revert to three-part SemVer** — v0.21.0.x four-part scheme stops here.
- **Member-side `stripe_customer_id` does not exist today.** Pre-implementation grep confirmed zero hits across `supabase/` and `src/`. M3 adds only `studios.stripe_customer_id` per Decision 3. The member-side column lands in Sprint C when Stripe production wires up.
- **No tests, no test infra changes.** Manual smoke tests in "How to verify" are the standard.

## Technical approach

The migration is load-bearing. Code changes flow from it. Write and review the SQL first, then the application changes.

### 1. Migration file — `supabase/v0.22.0_migration.sql`

Single transaction, idempotent. Demo studio insert is statement #1; every subsequent `ALTER TABLE` references its id via the `DEFAULT` trick.

```sql
-- supabase/v0.22.0_migration.sql
-- M3 — Multi-tenancy. One studios row, studio_id everywhere.
-- Applied manually via the Supabase SQL Editor BEFORE merging this PR's Vercel deploy.
-- See ADR-0001 Decisions 1, 3, 5.

begin;

-- ── 1. studios table + demo row ──────────────────────────────────────
create table if not exists studios (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plan_id text not null default 'starter'
    check (plan_id in ('starter','pro','studio')),
  member_count_cap int,  -- 50 (starter) / 250 (pro) / NULL (studio = unlimited)
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);

insert into studios (slug, name, plan_id, member_count_cap)
values ('demo', 'Demo Studio', 'studio', NULL)
on conflict (slug) do nothing;

-- Capture the demo studio id for the rest of the migration.
do $migration$
declare
  demo_id uuid := (select id from studios where slug = 'demo');
begin
  if demo_id is null then
    raise exception 'M3 migration: demo studio row not found after insert; aborting';
  end if;

  -- ── 2. Add studio_id to every tenant-scoped table ──────────────────
  -- Pattern: catalog check → ADD COLUMN with DEFAULT (backfills) → DROP DEFAULT
  -- (future inserts must be explicit). Re-running the migration is a no-op.

  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'studio_id';
  if not found then
    execute format('alter table members add column studio_id uuid not null default %L references studios(id)', demo_id);
    alter table members alter column studio_id drop default;
  end if;

  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'studio_id';
  if not found then
    execute format('alter table staff add column studio_id uuid not null default %L references studios(id)', demo_id);
    alter table staff alter column studio_id drop default;
  end if;

  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'studio_id';
  if not found then
    execute format('alter table classes add column studio_id uuid not null default %L references studios(id)', demo_id);
    alter table classes alter column studio_id drop default;
  end if;

  -- Repeat for every tenant-scoped table actually present in the repo today
  -- (confirmed by grepping supabase/schema.sql and supabase/functions.sql):
  --   class_bookings, plans, credit_transactions, purchases, booking_events.
  -- No separate waitlist table exists — waitlisting is a booking_status on
  -- class_bookings. v_members_with_access is a view over members and
  -- inherits studio_id automatically.
  -- class_templates / pending_actions / action_events from ADR Appendix A
  -- don't exist yet (future sprints) — out of scope for this migration.
  -- Copy-paste the three-statement pattern verbatim per table — don't refactor
  -- into a helper. One transaction, per-table visibility, easy PR review.

  -- ── 3. Drop and replace the unique indexes ─────────────────────────
  drop index if exists idx_members_user_id;
  create unique index if not exists idx_members_studio_user
    on members(studio_id, user_id) where user_id is not null;

  drop index if exists idx_staff_user_id;
  create unique index if not exists idx_staff_studio_user
    on staff(studio_id, user_id);
end $migration$;

-- ── 4. current_studio_id() function ────────────────────────────────
-- ADR Decision 2. STABLE for per-transaction caching. SECURITY DEFINER so it
-- can read staff/members regardless of caller RLS (safe today — RLS off on
-- data tables, on-with-self-read on staff). search_path locked to public.

create or replace function current_studio_id() returns uuid
language sql stable security definer set search_path = public as $function$
  select coalesce(
    (select studio_id from staff   where user_id = auth.uid() limit 1),
    (select studio_id from members where user_id = auth.uid() limit 1)
  );
$function$;

-- ── 5. Update tenant-scoped PL/pgSQL function bodies ──────────────────
-- Every function that writes/reads a tenant-scoped table needs the studio
-- filter. Bundled in this migration so column adds + function updates are
-- atomic.
--
-- Functions to update (confirm against supabase/functions.sql before coding):
--   sf_book_member, sf_cancel_booking, sf_check_eligibility, sf_check_in,
--   sf_mark_attendance, sf_finalise_class, sf_promote_member,
--   sf_adjust_credit, sf_apply_purchase, sf_refund_purchase,
--   sf_refresh_qa_fixtures.
--
-- Pattern: accept optional p_studio_id uuid; COALESCE with current_studio_id();
-- add `and <table>.studio_id = v_studio_id` to every where; add studio_id
-- to every insert column list. Return shape unchanged.

create or replace function sf_book_member(
  p_class_slug text,
  p_member_slug text,
  p_studio_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
begin
  if v_studio_id is null then
    return jsonb_build_object('status','error','reason','no_studio_context');
  end if;
  -- … existing body, but every `from classes` / `from members` /
  -- `from class_bookings` gets `where … and studio_id = v_studio_id` added.
  -- Insert sites get studio_id in the column list. Return shape unchanged.
end;
$function$;

-- Repeat for every function in the list above. Same pattern.

-- ── 6. Sanity checks (visible in psql output when run manually) ───────
select 'studios row count' as check_name, count(*) as value from studios
union all
select 'members with null studio_id', count(*) from members where studio_id is null
union all
select 'staff with null studio_id', count(*) from staff where studio_id is null
union all
select 'classes with null studio_id', count(*) from classes where studio_id is null;
-- Expected: studios=1, every other count=0.

commit;
```

Critical migration discipline:

1. **One transaction.** Any error rolls everything back.
2. **Idempotent throughout.** `IF NOT EXISTS` / catalog checks / `ON CONFLICT DO NOTHING` / `CREATE OR REPLACE` everywhere.
3. **Function updates inside the same transaction** so column adds + function updates are atomic from prod's perspective.
4. **No data movement beyond the backfill.** Doesn't rename, doesn't recompute, doesn't reformat.

### 2. Schema mirror — `supabase/schema.sql`

`supabase/schema.sql` is the canonical fresh-env bootstrap. Update it to mirror post-migration state: add the `studios` table, add `studio_id` to every tenant-scoped table, update the unique indexes, add the `current_studio_id()` function definition (the migration's function bodies update `supabase/functions.sql` directly).

If schema.sql and the migration diverge, the migration wins for prod truth.

### 3. Seed update — `supabase/seed.sql`

Insert the demo studio first, then every other insert references `(select id from studios where slug='demo')` for `studio_id`. Update every `insert into <tenant_scoped_table>` accordingly.

### 4. `scopedQuery()` body — `src/lib/db.ts`

Current shape (post-M2.5):

```ts
export async function scopedQuery(): Promise<SupabaseClient | null> {
  return getSupabaseClient();
}
```

M3 body:

```ts
const TENANT_SCOPED_TABLES = new Set([
  'members', 'staff', 'classes', 'class_bookings',
  'plans', 'credit_transactions', 'purchases', 'booking_events',
  'v_members_with_access',
  // Add: any tenant-scoped table or view added between M3 and M4.
  // class_templates (Sprint A), pending_actions / action_events (Sprint D)
  // will be added here when those features land.
]);

export async function scopedQuery(): Promise<SupabaseClient | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  // Two paths exist for applying the studio_id filter via PostgREST.
  // Path A: one-shot pre-fetch — call supabase.rpc('current_studio_id') once
  //   per scopedQuery() call, cache the value, apply .eq('studio_id', <value>)
  //   to every .from(tenant_scoped) call. Two round-trips on the first call.
  // Path B: function-call filter — use PostgREST's filter grammar to reference
  //   current_studio_id() directly. One round-trip; more idiomatic; depends on
  //   PostgREST supporting function calls in column filters cleanly.
  //
  // Confirm which path works against this Supabase version at PR draft. (A) is
  // the safer fallback. (B) is more idiomatic if it works. Pick one, document
  // in PR description, apply consistently.

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'from') return Reflect.get(target, prop, receiver);
      return function from(table: string) {
        const query = target.from(table);
        if (!TENANT_SCOPED_TABLES.has(table)) return query;
        // Apply .eq('studio_id', <resolved>) here per Path A or B.
        // NULL studio_id from anon → apply .eq('studio_id', impossible-uuid)
        // so the query returns [] cleanly instead of throwing.
        return query; // placeholder — real filter applied per chosen path
      };
    },
  });
}
```

Implementation discipline:

- Tenant-scoped table list in one place. Adding a tenant-scoped table is one-line + schema change.
- Proxy intercepts `.from()` only. `.rpc()` calls go through unchanged — RPC functions resolve `current_studio_id()` themselves or accept `p_studio_id`.
- NULL studio_id → query returns `[]`, doesn't throw.
- Proxy must not break method chaining.

### 5. Replace `TODO(M3)` markers — RPC sites

```bash
grep -rn "TODO(M3): pass studio_id" src/
```

Expected hits (~11):
- `src/lib/db.ts` — callRpc helper, sf_book_member, sf_mark_attendance, sf_finalise_class, sf_adjust_credit
- `src/lib/entitlements/applyPurchase.ts` — sf_apply_purchase
- `src/app/api/admin/refund-purchase/route.ts` — sf_refund_purchase
- `src/app/api/admin/verify-{book,promote,cancellation}/route.ts` — sf_book_member, sf_promote_member, sf_book_member, sf_cancel_booking

Pattern:

```ts
// before
// TODO(M3): pass studio_id explicitly once sf_book_member is studio-scoped.
const { data, error } = await client.rpc("sf_book_member", {
  p_class_slug: classSlug,
  p_member_slug: memberSlug,
});

// after (Path A example)
const { data: studioId } = await client.rpc("current_studio_id");
const { data, error } = await client.rpc("sf_book_member", {
  p_class_slug: classSlug,
  p_member_slug: memberSlug,
  p_studio_id: studioId,
});
```

**Pick one path consistently.** Path A: each RPC site calls `current_studio_id()` right before. Two round-trips per RPC, local change. Path B: resolve `studioId` once at the request boundary and thread it through. One round-trip, more invasive. **Recommendation: Path A** for v0.22.0 — perf invisible pre-pilot, simpler.

### 6. PL/pgSQL function bodies — `supabase/functions.sql`

Paired with Migration Step 5. Every tenant-scoped function gets `p_studio_id uuid default null`, falls back to `current_studio_id()` if null, filters/inserts using the resolved studio.

Functions to update (confirm against `supabase/functions.sql` before coding):
- `sf_book_member`, `sf_cancel_booking`, `sf_check_eligibility`, `sf_check_in`, `sf_mark_attendance`, `sf_finalise_class`, `sf_promote_member`, `sf_adjust_credit`, `sf_apply_purchase`, `sf_refund_purchase`, `sf_refresh_qa_fixtures`.

Any function that queries or writes `members`, `staff`, `classes`, `class_bookings`, `booking_events`, `credit_transactions`, `purchases`, `plans`, or any view derived from them — update it.

For each: add `p_studio_id` parameter, `v_studio_id := coalesce(p_studio_id, current_studio_id())`, add `and <table>.studio_id = v_studio_id` to every relevant where, add `studio_id` to every relevant insert column list. Return shape unchanged.

### 7. Stripe webhook — schema columns only

Decision 4 handler logic is Sprint C. M3 lands only schema affordances (`studios.stripe_customer_id`, `studios.stripe_subscription_id` — already in the migration). The webhook handler is unchanged; the "Intentional cross-tenant exception" comment from M2.5 stays.

### 8. AGENTS.md updates

**(a) "Auth posture (current)" section** — remove "Multi-tenant `studio_id` plumbing arrives in M3." (It's arrived.)

**(b) "Data access (current)" section** — replace M2.5's pass-through description with post-M3 behaviour:

> **Tenant-scoped queries MUST call `scopedQuery()` from `src/lib/db.ts`, not `getSupabaseClient()`.** `scopedQuery()` returns a Proxy that auto-applies `.eq('studio_id', current_studio_id())` to every `.from(<tenant_scoped_table>)` call. The tenant-scoped table list lives in `TENANT_SCOPED_TABLES` in `src/lib/db.ts`; adding a new tenant-scoped table means adding it to that list. RPC calls accept an optional `p_studio_id` parameter — pass it explicitly when you have the caller's studio context; the function falls back to `current_studio_id()` if you pass `null`. Exceptions that keep using `getSupabaseClient()` directly: auth-row reads, the `studios` table itself, and intentional cross-tenant operations (the Stripe webhook is the canonical example). Intentional exceptions MUST carry an inline comment naming the reason. See `docs/adr/0001-multi-tenancy.md` Decisions 1, 2, 6.

### 9. Cron follow-up — `/api/admin/rebase-demo-classes`

Drop a TODO at the top:

```ts
// TODO(post-M3): this cron iterates every classes row but doesn't filter by studio.
// Pre-M3 that was fine — only one studio. Post-M3 it will rebase EVERY studio's
// demo classes, which is correct for the seed demo data but wrong if a real
// studio's class timeline coincides with the rebase window. Either:
//   (a) outer-loop over studios.slug='demo' only, or
//   (b) retire this cron in favour of Sprint A recurring-templates work (v0.24.0).
```

## Acceptance criteria

### Schema
- `studios` table exists with the shape in Section 1. One row, `slug='demo'`.
- Every tenant-scoped table in this spec carries `studio_id uuid NOT NULL` referencing `studios(id)`. Every existing row backfilled to the demo studio id.
- `idx_members_user_id` and `idx_staff_user_id` are gone. `idx_members_studio_user` (partial) and `idx_staff_studio_user` (full) exist in their place.
- `current_studio_id()` function exists, returns demo studio id for `philotbm@gmail.com`'s session, returns NULL for anonymous.

### Code
- `scopedQuery()` body is no longer pass-through. Auto-applies studio filter to `.from(<tenant_scoped>)`.
- Zero `TODO(M3): pass studio_id explicitly` markers remain (`grep -rn "TODO(M3): pass studio_id" src/` → no matches).
- Every PL/pgSQL function in Section 6 accepts `p_studio_id` + filters by `coalesce(p_studio_id, current_studio_id())`.
- `src/app/api/stripe/webhook/route.ts` unchanged except optionally an updated comment.
- AGENTS.md sections reflect post-M3 reality.
- `supabase/schema.sql` matches post-migration state.
- `supabase/seed.sql` produces working fresh-env bootstrap.
- `package.json` version is `0.22.0`.

### Build / lint / type
- `npx tsc --noEmit` clean.
- `npm run lint` 0 errors.
- `npm run build` clean Turbopack build.
- `/api/dev/sentry-test` route still works (temp test from v0.21.0.4 — separate cleanup).

### Behaviour
Every existing flow that worked at v0.21.0.5 works identically at v0.22.0. See "How to verify" below.

## How to verify

### 1. APPLY THE MIGRATION TO PROD SUPABASE — BEFORE MERGING THE PR

**This step is irreversible without the rollback migration.** Sequence:

1. Open Supabase SQL Editor for the prod StudioFlow project.
2. Paste the full contents of `supabase/v0.22.0_migration.sql`.
3. Run it.
4. Read the sanity-check output at the bottom:
   - `studios row count` = 1
   - `members with null studio_id` = 0
   - `staff with null studio_id` = 0
   - `classes with null studio_id` = 0
5. **If any sanity check fails:** the `BEGIN/COMMIT` should have rolled back. Verify with `SELECT count(*) FROM studios;` (expect 0 if rolled back, 1 if applied). If partially applied for any reason, run the rollback SQL in Section 5 before retrying.
6. Once sanity checks pass, prod schema is ready for v0.22.0 code.

### 2. Merge the PR

Vercel auto-deploys. New code expects `studio_id` on every tenant-scoped row; migration has already provided it.

### 3. Post-deploy smoke — Phil's normal browser, prod URL

Every check should behave identically to v0.21.0.5:

- [ ] Sign in to `/staff/login` as `philotbm@gmail.com` (owner). Land on `/app`. Header reads "Signed in as Phil (owner)".
- [ ] `/app/classes` — class roster renders, bookings show member names, promotion meta works.
- [ ] `/app/members/emma-kelly` — member detail renders with purchases + credit ledger.
- [ ] `/app/revenue` — revenue dashboard loads.
- [ ] Click "Member view" → `/my/emma-kelly`. Bookings and credits intact.
- [ ] Member-side: sign in as `philotbm+ciara@gmail.com` (claim if first time). `/my/ciara-byrne`. Book + cancel a class.
- [ ] `/checkin/classes/{any-slug}` — kiosk renders, check-in works (unauth'd, unchanged in M3).
- [ ] `/api/admin/*` route — signed out 401, signed in as owner 200.
- [ ] `/api/admin/purchase-health` — 200 with purchase summary.
- [ ] `/api/qa/status` — fixture readiness payload.

### 4. Sentry check (if env vars set)

Visit `/api/dev/sentry-test?throw=1` as owner. Confirm Sentry event arrives within ~30s with real stack trace and `user.id` set to Phil's auth uid.

### 5. Rollback

If anything in Steps 1–3 fails irrecoverably:

```sql
-- Documented rollback (keep in PR description, do NOT commit as a file)

begin;

drop function if exists current_studio_id();

drop index if exists idx_members_studio_user;
drop index if exists idx_staff_studio_user;
create unique index if not exists idx_members_user_id on members(user_id) where user_id is not null;
create unique index if not exists idx_staff_user_id on staff(user_id);

alter table members             drop column if exists studio_id cascade;
alter table staff               drop column if exists studio_id cascade;
alter table classes             drop column if exists studio_id cascade;
alter table class_bookings      drop column if exists studio_id cascade;
alter table plans               drop column if exists studio_id cascade;
alter table credit_transactions drop column if exists studio_id cascade;
alter table purchases           drop column if exists studio_id cascade;
alter table booking_events      drop column if exists studio_id cascade;

drop table if exists studios cascade;

-- Restore pre-M3 function bodies from the pre-v0.22.0 functions.sql copy
-- you kept for the duration of the M3 review window.

commit;
```

Rollback is cheap because there's only one studio. Real M3 risk is missed application-side filters; RLS in M4 is the safety net, but RLS isn't there yet, so M3's review discipline matters more than usual.

## Required manual config

> **APPLY `supabase/v0.22.0_migration.sql` AGAINST THE PROD SUPABASE PROJECT BEFORE MERGING THIS PR'S VERCEL DEPLOY.** Without this, the new code will 500 on every tenant-scoped query.

No new env vars. No Vercel settings changes. No new dependencies.

## Out of scope

- **Row-level security (RLS).** M4 / v0.23.0.
- **Stripe webhook handler logic** for Decision 4. Sprint C / v0.26.0.
- **Cross-studio admin tooling.** Not needed pre-pilot.
- **Per-studio Stripe Connect / payouts.** Deferred per ADR Appendix B.
- **Soft delete / archive of studios.** Not now.
- **Per-studio custom branding.** Out of scope.
- **`user_profiles` table.** Future possibility; defer.
- **Cron retire.** TODO comment now; refactor or retirement in Sprint A.
- **Test infrastructure.** Manual smoke tests are the standard.

## PR checklist

- Branch `feat/m3-multi-tenancy` off `origin/main` (at `v0.21.0.5` / `a080d05` or descendant).
- Migration filename: `supabase/v0.22.0_migration.sql`.
- Title: `v0.22.0: Multi-tenancy (studios + studio_id everywhere)`.
- `package.json` version `0.22.0`.
- Co-authored-by: Claude trailer.
- PR description includes: pointer to ADR-0001, pointer to `docs/specs/M3_multi_tenancy.md`, the manual prod-Supabase apply step in bold at the top, the full "How to verify" matrix, the rollback SQL embedded as a code block, the chosen Path (A or B) for RPC studio_id resolution, confirmation that no member-side `stripe_customer_id` column exists today (Sprint C concern).
- `supabase/schema.sql`, `supabase/seed.sql`, `supabase/functions.sql` all updated.

## Why one big PR rather than three smaller ones

ADR Decision 5 mandates single-shot backfill in one migration, one transaction. Application-side changes can't ship before the schema (would reference columns that don't exist) or after as a separate PR (would leave a cross-tenant leak window). Single PR trades review-size pain for atomicity. Mitigation: read the migration in full first, then the application changes against it.

## Open questions — flag in PR description, do NOT block opening

1. **PostgREST filter syntax for `current_studio_id()` in the proxy.** Section 4 notes Path A vs Path B. Pick one based on what works against PostgREST and document the choice.
2. **Cross-studio user identity.** ADR Decision 2's COALESCE-staff-first default ships in M3; the `set_current_studio(uuid)` setter is NOT pre-built. Confirm you're following that.
3. **Member-side Stripe customer column location — RESOLVED.** Pre-implementation grep of `supabase/` and `src/` returned zero hits. No member-side or purchase-side Stripe customer column exists. M3 adds only `studios.stripe_customer_id`. Sprint C (v0.26.0) lands the member-side column when Stripe production wires up. Document in PR description so Sprint C knows it's net-new, not a relocation.
