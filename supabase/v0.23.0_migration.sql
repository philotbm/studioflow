-- supabase/v0.23.0_migration.sql
-- M4 — Row-Level Security on every tenant-scoped table.
-- Applied manually via the Supabase SQL Editor BEFORE merging this
-- PR's Vercel deploy. See docs/adr/0001-multi-tenancy.md Decision 1
-- and docs/specs/M4_rls.md.
--
-- Single transaction, idempotent (drop-if-exists + create policy
-- patterns, plus alter-function which is naturally idempotent).
--
-- Sections:
--   1. studios — RLS on the tenancy table itself
--   2. tenant-scoped data tables — one tenant_isolation policy each
--   3. SECURITY DEFINER on every sf_* PL/pgSQL function
--   4. sanity checks

begin;

-- ═══ 1. studios — RLS on its own tenancy table ════════════════════════
-- A row in studios is visible to the row's own studio (id matches
-- current_studio_id()). The "see your own studio" semantics are what
-- M3's plumbing assumes.
alter table studios enable row level security;
drop policy if exists studios_tenant_isolation on studios;
create policy studios_tenant_isolation on studios
  for all
  using (id = current_studio_id())
  with check (id = current_studio_id());

-- ═══ 2. Tenant-scoped data tables — one isolation policy per table ════
-- Each policy mirrors the others. FOR ALL covers SELECT/INSERT/UPDATE/
-- DELETE. The v0.21.0 "staff can read self" policy on `staff` is left
-- in place — PostgreSQL evaluates multiple policies as OR, so a staff
-- member can still self-read to bootstrap current_studio_id() during
-- session establishment.

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
-- KEEP the v0.21.0 "staff can read self" policy — bootstrap for
-- current_studio_id() before the operator session resolves a studio.

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

-- ═══ 3. SECURITY DEFINER on every tenant-touching sf_* function ═══════
-- Functions run as the function owner and bypass RLS. Required so the
-- Stripe webhook (server-to-server, no session → current_studio_id()
-- returns NULL) and cookie-auth RPCs (whose JWT sub is the user, but
-- the user has no permission to read other rows in the same studio
-- under RLS) keep working. The functions already filter by studio_id
-- internally (M3), so SECURITY DEFINER is safe — they enforce tenancy
-- themselves rather than relying on RLS.
--
-- Signatures confirmed against supabase/functions.sql (all 17 sf_*
-- functions present). current_studio_id() itself is already SECURITY
-- DEFINER from the M3 migration.

alter function sf_count_booked(uuid)                                     security definer;
alter function sf_resequence_waitlist(uuid)                              security definer;
alter function sf_check_eligibility(uuid)                                security definer;
alter function sf_consume_credit(uuid, text, text, uuid, uuid, text, text)         security definer;
alter function sf_refund_credit(uuid, text, text, uuid, uuid, text, text)          security definer;
alter function sf_adjust_credit(text, integer, text, text, text, uuid)             security definer;
alter function sf_auto_promote(uuid, integer)                            security definer;
alter function sf_book_member(text, text, uuid)                          security definer;
alter function sf_cancel_booking(text, text, uuid)                       security definer;
alter function sf_promote_member(text, text, uuid)                       security definer;
alter function sf_unpromote_member(text, text, integer, uuid)            security definer;
alter function sf_check_in(text, text, text, uuid)                       security definer;
alter function sf_finalise_class(text, uuid)                             security definer;
alter function sf_mark_attendance(text, text, text, uuid)                security definer;
alter function sf_refresh_qa_fixtures()                                  security definer;
alter function sf_apply_purchase(uuid, text, text, text, integer, text, text)      security definer;
alter function sf_refund_purchase(uuid)                                  security definer;

-- ═══ 4. Sanity checks ═════════════════════════════════════════════════
-- Expected:
--   tables with RLS enabled       = 9
--   _tenant_isolation policies    = 9
--   SECURITY DEFINER sf_ functions= 17

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
