# M4 — Row-Level Security (RLS) on every tenant-scoped table

**Branch:** `feat/m4-rls`
**Estimated PR scope:** ~150–250 LOC. One migration file (~120 lines SQL: enable RLS + one policy per table + alter every RPC to SECURITY DEFINER), schema.sql mirror, AGENTS.md update, package.json bump. Zero application code changes to existing scopedQuery-using surfaces — M3 already shaped the application; M4 just turns on the database safety net. One new helper (`getSupabaseServiceClient`) plus four route changes for the M3 exception routes.
**Target version:** v0.23.0
**Depends on:** v0.22.0 ✅ merged (M3 multi-tenancy is on `main`, commit `32ce231`). `studios` table exists, `studio_id` is `NOT NULL` on every tenant-scoped row, `current_studio_id()` PL/pgSQL function is defined.
**Blocks:** nothing strategic. M4 is the last piece of the pre-pilot architectural baseline.
**ADR reference:** `docs/adr/0001-multi-tenancy.md` — Decision 1's "two layers of defense" (`scopedQuery` at the application + RLS at the database). M3 shipped layer one; M4 ships layer two.

---

## Preflight — do not start coding until all green

- [ ] `main` is at `v0.22.0`, commit `32ce231`.
- [ ] Live site smoke pass post-M3 (operator + member surfaces all work).
- [ ] Sentry env vars set in Vercel Production (catches RLS misconfigs immediately).
- [ ] `current_studio_id()` is `SECURITY DEFINER` in the live DB.
- [ ] Repo head clean.

## Goal

Turn on RLS for every tenant-scoped table with a single one-line policy per table: `studio_id = current_studio_id()`. Every legitimate query that was working post-M3 keeps working; every accidental cross-tenant query (or query from an anonymous session against tenant-scoped data) is blocked at the database, not the application.

After this lands:

- `members`, `staff`, `classes`, `class_bookings`, `booking_events`, `credit_transactions`, `plans`, `purchases`, and `studios` all have RLS enabled.
- Each has a `tenant_isolation` policy: `using (studio_id = current_studio_id()) with check (studio_id = current_studio_id())`. FOR ALL covers SELECT, INSERT, UPDATE, DELETE.
- The v0.21.0 `staff can read self` policy on `staff` is kept (additive — both policies apply via OR, so staff can still read their own row to bootstrap `current_studio_id()`).
- Every PL/pgSQL function that mutates or reads tenant-scoped data is altered to `SECURITY DEFINER`. Functions run as the function owner and bypass RLS — required for server-to-server callers (Stripe webhook) and for cookie-auth RPCs to operate as they did pre-M4. The functions already filter by `studio_id` internally (M3), so this is safe.
- A new `getSupabaseServiceClient()` helper is added to `src/lib/supabase.ts`. The four M3 exception routes switch from `getSupabaseClient()` (anon) to `getSupabaseServiceClient()`. Service role bypasses RLS by design.

**Behaviour change vs. v0.22.0:** zero user-facing change at single-studio scale. The point of M4 is invisible defense — every existing flow keeps working, every accidental cross-tenant query starts returning empty results.

## Why now

Pilot ~2026-08-03. M4 is the last architectural piece before the sellable track. Onboarding studio #2 without RLS would be reckless — a single missed `studio_id` filter would leak cross-tenant data. RLS is the safety net.

## Constraints

- ADR-0001 Decision 1 is canonical. Two layers of defense.
- Manual prod-Supabase migration apply (same gate as M3).
- One transaction with idempotency guards (`drop policy if exists` + `create policy`, `alter function … security definer` is naturally idempotent).
- `current_studio_id()` MUST remain `SECURITY DEFINER` — it's the bootstrap that breaks the chicken-and-egg.
- Service role bypasses RLS automatically — that's why we use it for the four exception routes.
- Service-role key MUST be Production scope only in Vercel (NOT Preview, NOT Development).
- Three-part SemVer.

## Technical approach

### 1. Migration file — `supabase/v0.23.0_migration.sql`

```sql
-- supabase/v0.23.0_migration.sql
-- M4 — Row-Level Security on every tenant-scoped table.
-- Applied manually via the Supabase SQL Editor BEFORE merging this PR's
-- Vercel deploy. See docs/adr/0001-multi-tenancy.md Decision 1.

begin;

-- ═══ 1. studios — RLS on its own tenancy table ════════════════════════
alter table studios enable row level security;
drop policy if exists studios_tenant_isolation on studios;
create policy studios_tenant_isolation on studios
  for all
  using (id = current_studio_id())
  with check (id = current_studio_id());

-- ═══ 2. tenant-scoped data tables ════════════════════════════════════
alter table members enable row level security;
drop policy if exists members_tenant_isolation on members;
create policy members_tenant_isolation on members
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

alter table staff enable row level security;
drop policy if exists staff_tenant_isolation on staff;
create policy staff_tenant_isolation on staff
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());
-- KEEP the v0.21.0 "staff can read self" policy — bootstrap for current_studio_id().

alter table classes enable row level security;
drop policy if exists classes_tenant_isolation on classes;
create policy classes_tenant_isolation on classes
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

alter table class_bookings enable row level security;
drop policy if exists class_bookings_tenant_isolation on class_bookings;
create policy class_bookings_tenant_isolation on class_bookings
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

alter table booking_events enable row level security;
drop policy if exists booking_events_tenant_isolation on booking_events;
create policy booking_events_tenant_isolation on booking_events
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

alter table credit_transactions enable row level security;
drop policy if exists credit_transactions_tenant_isolation on credit_transactions;
create policy credit_transactions_tenant_isolation on credit_transactions
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

alter table plans enable row level security;
drop policy if exists plans_tenant_isolation on plans;
create policy plans_tenant_isolation on plans
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

alter table purchases enable row level security;
drop policy if exists purchases_tenant_isolation on purchases;
create policy purchases_tenant_isolation on purchases
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

-- ═══ 3. SECURITY DEFINER on every tenant-touching PL/pgSQL function ═══
-- IMPORTANT: confirm each function's exact signature against
-- supabase/functions.sql before pasting. The parameter list must match
-- or `alter function` errors with "function does not exist".

alter function sf_consume_credit(uuid, text, text, uuid, uuid, text, text) security definer;
alter function sf_refund_credit(uuid, text, text, uuid, uuid, text, text) security definer;
alter function sf_adjust_credit(text, integer, text, text, text, uuid) security definer;
alter function sf_auto_promote(uuid, integer) security definer;
alter function sf_book_member(text, text, uuid) security definer;
alter function sf_cancel_booking(text, text, uuid) security definer;
alter function sf_promote_member(text, text, uuid) security definer;
alter function sf_unpromote_member(text, text, integer, uuid) security definer;
alter function sf_check_in(text, text, text, uuid) security definer;
alter function sf_finalise_class(text, uuid) security definer;
alter function sf_mark_attendance(text, text, text, uuid) security definer;
alter function sf_apply_purchase(uuid, text, text, text, integer, text, text) security definer;
alter function sf_refund_purchase(uuid) security definer;
alter function sf_refresh_qa_fixtures() security definer;
alter function sf_check_eligibility(uuid) security definer;
alter function sf_count_booked(uuid) security definer;
alter function sf_resequence_waitlist(uuid) security definer;
-- current_studio_id() is already SECURITY DEFINER from the M3 migration.

-- ═══ 4. Sanity checks ══════════════════════════════════════════════════
select 'tables with RLS enabled' as check_name, count(*)::bigint as value
  from pg_tables
  where schemaname = 'public'
    and tablename in (
      'studios','members','staff','classes','class_bookings',
      'booking_events','credit_transactions','plans','purchases'
    )
    and rowsecurity = true
union all
select '_tenant_isolation policies', count(*)
  from pg_policies
  where schemaname = 'public' and policyname like '%_tenant_isolation'
union all
select 'SECURITY DEFINER sf_ functions',
       count(*)::bigint
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'sf\_%' escape '\'
    and p.prosecdef = true;

commit;
```

Expected sanity outputs:
- `tables with RLS enabled` = 9
- `_tenant_isolation policies` = 9
- `SECURITY DEFINER sf_ functions` = 17 (or whatever the actual count of altered functions is — must match the alter list count above).

### 2. Schema mirror — `supabase/schema.sql` + `supabase/functions.sql`

Mirror post-M4 state for fresh-env bootstraps:

- In `schema.sql`: after each tenant-scoped `create table`, add `alter table X enable row level security;` and the `tenant_isolation` policy. Keep the v0.21.0 `staff can read self` policy block.
- In `functions.sql`: change `language plpgsql as $$` → `language plpgsql security definer as $$` on every `sf_*` function definition. Match the alter list from Section 3 of the migration.

### 3. Service-role client — `src/lib/supabase.ts` (new helper)

```ts
// src/lib/supabase.ts — addition

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

let _serviceClient: SupabaseClient | null = null;
let _serviceInitAttempted = false;

/**
 * v0.23.0 (M4) — Supabase server client with the service-role key.
 *
 * ⚠ SERVER-ONLY. The service role bypasses RLS and has full read/write
 * access to every table. NEVER expose this client (or the key) to a
 * browser, NEVER use it in a layout or page component, and NEVER call
 * it from a route handler that doesn't otherwise authenticate the
 * caller (Bearer token, Stripe signature, or trust-the-source).
 *
 * Used by exactly four surfaces per M3/M4 ADR:
 *   - /api/stripe/webhook — Stripe signature verifies the caller.
 *   - /api/stripe/create-checkout-session — requireMemberAccessForRequest
 *     validates the Bearer token before this client is touched.
 *   - /api/attendance/check-in — anonymous QR kiosk; safe because the
 *     route only reads/writes within a single class context and the
 *     slug is un-guessable enough at pilot scale (single studio).
 *   - src/lib/entitlements/applyPurchase.ts — called from the two
 *     authenticated paths above; never directly exposed.
 *
 * If you add a fifth caller, document it here AND in
 * docs/adr/0001-multi-tenancy.md Decision 1's exception list.
 */
export function getSupabaseServiceClient(): SupabaseClient | null {
  if (_serviceInitAttempted) return _serviceClient;
  _serviceInitAttempted = true;
  if (URL_VAR && SERVICE_ROLE_KEY) {
    _serviceClient = createClient(URL_VAR, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _serviceClient;
}
```

### 4. Switch the four exception routes

Each currently has `const client = getSupabaseClient();` with an inline "Intentional ... exception (v0.22.0 / ADR-0001)" comment. Change to `const client = getSupabaseServiceClient();` and update the comment to mention service-role bypass. Routes:

- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/attendance/check-in/route.ts`
- `src/app/api/stripe/create-checkout-session/route.ts`
- `src/lib/entitlements/applyPurchase.ts`

### 5. AGENTS.md updates

**"Auth posture (current)"** — replace the RLS line:

> RLS is **ON** for every tenant-scoped table (M4 / v0.23.0). Policy on each is `studio_id = current_studio_id()` via Postgres FOR ALL. The v0.21.0 `staff can read self` policy is kept additively as the bootstrap for `current_studio_id()`. Every PL/pgSQL function is `SECURITY DEFINER` and filters internally.

**"Data access (current)"** — add a paragraph on the service-role client:

> A separate `getSupabaseServiceClient()` exists in `src/lib/supabase.ts` for the four documented server-to-server / anonymous / Bearer-auth exception routes. Service role bypasses RLS — only use it in those four places.

## Acceptance criteria

- 9 tables have `rowsecurity = true`. 9 `_tenant_isolation` policies. 17+ `SECURITY DEFINER` `sf_*` functions.
- `src/lib/supabase.ts` exports `getSupabaseServiceClient()`.
- The four exception routes use `getSupabaseServiceClient()` not `getSupabaseClient()`.
- `npx tsc --noEmit` clean; `npm run lint` 0 errors; `npm run build` clean.
- `package.json` version `0.23.0`.

## How to verify

### 1. Apply migration to prod Supabase BEFORE merging

1. Supabase SQL Editor → paste full `supabase/v0.23.0_migration.sql` → Run.
2. Read sanity-check output. Expected: 9 / 9 / 17+.
3. If wrong, BEGIN/COMMIT should have rolled back. Investigate before retrying.

### 2. Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel Production scope BEFORE merging

- Name: `SUPABASE_SERVICE_ROLE_KEY`
- Value: from Supabase project Settings → API → service_role
- Scope: **Production only** (NOT Preview, NOT Development)

### 3. Merge the PR

Vercel auto-deploys.

### 4. Post-deploy smoke (Phil's browser, prod URL)

Identical to v0.22.0:

- [ ] `/staff/login` as owner → `/app`. Header "Signed in as Phil (owner)".
- [ ] `/app/classes` — roster renders.
- [ ] `/app/members/emma-kelly` — detail renders with purchases + credit ledger.
- [ ] `/app/revenue` — loads.
- [ ] `/app/plans` — renders.
- [ ] "Member view" → `/my/emma-kelly` — bookings + credits intact.
- [ ] Member side: book + cancel a class.
- [ ] `/checkin/classes/{slug}` kiosk — check in a member.
- [ ] `/api/admin/purchase-health` signed in as owner → 200.
- [ ] `/api/qa/status` — fixture payload.
- [ ] `/api/admin/{any-route}` signed out → 401.

### 5. RLS isolation proof (Supabase SQL Editor)

```sql
set role anon;
select count(*) from members;  -- expect 0
reset role;
select count(*) from members;  -- expect 11+ (normal seed)
```

### 6. Sentry smoke

`/api/dev/sentry-test?throw=1` as owner → event arrives in Sentry within ~30s with un-minified stack.

### 7. Rollback (only if irrecoverable)

```sql
begin;
alter table studios             disable row level security;
alter table members             disable row level security;
alter table staff               disable row level security;
alter table classes             disable row level security;
alter table class_bookings      disable row level security;
alter table booking_events      disable row level security;
alter table credit_transactions disable row level security;
alter table plans               disable row level security;
alter table purchases           disable row level security;
drop policy if exists studios_tenant_isolation             on studios;
drop policy if exists members_tenant_isolation             on members;
drop policy if exists staff_tenant_isolation               on staff;
drop policy if exists classes_tenant_isolation             on classes;
drop policy if exists class_bookings_tenant_isolation      on class_bookings;
drop policy if exists booking_events_tenant_isolation      on booking_events;
drop policy if exists credit_transactions_tenant_isolation on credit_transactions;
drop policy if exists plans_tenant_isolation               on plans;
drop policy if exists purchases_tenant_isolation           on purchases;
-- Revert SECURITY DEFINER for every sf_ function altered above to SECURITY INVOKER.
-- The staff "staff can read self" policy from v0.21.0 stays.
alter table staff enable row level security;
commit;
```

The four route changes revert via `git revert <merge-commit>`.

## Out of scope

- Per-policy SELECT/INSERT/UPDATE/DELETE granularity (one FOR ALL policy per table).
- Anonymous-role permissive policies (rejected; we use service role instead).
- The five post-M3 carry-forwards (tracked separately).
- Sellable track features (next, after M4).

## PR checklist

- Branch `feat/m4-rls` off `origin/main` at `v0.22.0` / `32ce231`.
- Migration filename `supabase/v0.23.0_migration.sql`.
- Title `v0.23.0: Row-Level Security on tenant-scoped tables`.
- `package.json` `0.23.0`. Co-authored-by Claude.
- PR description: ADR-0001 Decision 1 pointer, `docs/specs/M4_rls.md` pointer, manual SQL apply step in bold, `SUPABASE_SERVICE_ROLE_KEY` env var in bold, verification matrix, rollback SQL.
- `supabase/schema.sql` and `supabase/functions.sql` updated.
