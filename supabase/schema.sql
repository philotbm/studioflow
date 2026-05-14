-- StudioFlow v0.22.0 — Supabase Foundation Schema
-- Run this in the Supabase SQL Editor before seed.sql. v0.22.0 (M3
-- multi-tenancy) added the studios table and studio_id on every
-- tenant-scoped table — see docs/adr/0001-multi-tenancy.md.

-- ═══ STUDIOS — v0.22.0 (M3 multi-tenancy) ═════════════════════════════
-- The tenancy table. Every tenant-scoped data row references one row
-- here via studio_id. Pre-pilot we ship a single 'demo' studio; second
-- studio is an INSERT + CSV import, not a re-platforming.
--
-- plan_id is the SaaS pricing tier (starter / pro / studio), distinct
-- from the per-studio members plan offerings (members.plan_type +
-- plans table). member_count_cap is NULL on the studio tier (unlimited).
-- stripe_customer_id / stripe_subscription_id are wired up by Sprint C
-- (v0.26.0) when prod Stripe lands.
create table if not exists studios (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,
  name                   text not null,
  plan_id                text not null default 'starter'
                           check (plan_id in ('starter','pro','studio')),
  member_count_cap       int,  -- 50 / 250 / NULL (starter/pro/studio)
  stripe_customer_id     text,
  stripe_subscription_id text,
  -- v0.24.0 (Sprint A) — IANA timezone the studio operates in. All
  -- class_templates inherit this; the materialise cron uses it to
  -- convert wall-clock start_time_local into UTC starts_at on classes.
  tz                     text not null default 'Europe/Dublin',
  -- v0.24.0 — how far out the cron materialises template instances.
  -- Configurable per studio; 8 weeks suits weekly-cycle studios.
  materialisation_horizon_weeks integer not null default 8
                           check (materialisation_horizon_weeks between 2 and 26),
  created_at             timestamptz not null default now()
);

-- ═══ MEMBERS ═══════════════════════════════════════════════════════════
create table if not exists members (
  id                       uuid primary key default gen_random_uuid(),
  -- v0.22.0 (M3): every member belongs to exactly one studio.
  studio_id                uuid not null references studios(id),
  slug                     text unique not null,
  full_name                text not null,
  email                    text,
  phone                    text,
  status                   text not null default 'active'
                             check (status in ('active','paused','inactive')),
  plan_type                text not null default 'drop_in'
                             check (plan_type in ('unlimited','class_pack','trial','drop_in')),
  plan_name                text not null,
  credits_remaining        integer,
  notes                    text,
  insights_json            jsonb not null default '{}',
  purchase_insights_json   jsonb not null default '{}',
  opportunity_signals_json jsonb not null default '[]',
  history_summary_json     jsonb not null default '[]',
  -- v0.20.0: links a members row to its claimed auth.users id. NULL =
  -- un-claimed (legacy/demo rows). The slug remains the public URL
  -- but is no longer the credential.
  user_id                  uuid references auth.users(id),
  -- v0.20.1: phone-last-4 challenge state for the self-claim flow.
  -- claim_attempts counts wrong-digit submissions since the last
  -- success or lockout reset. claim_locked_until, when in the future,
  -- bars further attempts on this row until cleared.
  claim_attempts           integer not null default 0,
  claim_locked_until       timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- v0.22.0 (M3): one members row per (studio, auth user). Replaces the
-- pre-M3 idx_members_user_id which enforced one globally.
create unique index if not exists idx_members_studio_user
  on members(studio_id, user_id) where user_id is not null;

-- ═══ CLASSES ═══════════════════════════════════════════════════════════
create table if not exists classes (
  id                        uuid primary key default gen_random_uuid(),
  studio_id                 uuid not null references studios(id),  -- v0.22.0 (M3)
  slug                      text unique not null,
  title                     text not null,
  instructor_name           text not null,
  starts_at                 timestamptz not null,
  ends_at                   timestamptz not null,
  capacity                  integer not null,
  location_name             text,
  cancellation_window_hours integer not null default 12,
  -- v0.8.4: check-in opens `check_in_window_minutes` before starts_at
  -- and closes at ends_at. Default 15 min. Guarded by sf_check_in.
  check_in_window_minutes   integer not null default 15
                              check (check_in_window_minutes >= 0
                                     and check_in_window_minutes <= 240),
  -- v0.24.0 (Sprint A) — set by /api/cron/materialise-templates for
  -- rows materialised from a class_templates row. NULL on legacy ad-hoc
  -- classes (the demo seed's six fixed slugs plus anything inserted
  -- pre-Sprint-A). FK constraint added via ALTER at the end of this
  -- file (class_templates is defined below — schema.sql ordering puts
  -- studios first, then data tables, then staff, with class_templates
  -- after staff because class_templates.instructor_id references staff).
  template_id               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- v0.24.0 — partial index for template-keyed lookups (only
-- materialised rows are interesting).
create index if not exists idx_classes_template_id
  on classes(template_id) where template_id is not null;

-- v0.24.0 — unique constraint backing the cron's idempotent upsert.
-- One materialised class per (template, starts_at).
create unique index if not exists idx_classes_template_scheduled_at_unique
  on classes(template_id, starts_at) where template_id is not null;

-- ═══ CLASS_BOOKINGS ════════════════════════════════════════════════════
create table if not exists class_bookings (
  id                uuid primary key default gen_random_uuid(),
  studio_id         uuid not null references studios(id),  -- v0.22.0 (M3)
  class_id          uuid not null references classes(id) on delete cascade,
  member_id         uuid not null references members(id) on delete cascade,
  -- v0.8.4: legacy 'attended' dropped from the accepted set. v0.8.3
  -- normalised all existing rows to 'checked_in'; v0.8.4 locks it in.
  booking_status    text not null default 'booked'
                      check (booking_status in (
                        'booked','waitlisted','cancelled',
                        'late_cancel','no_show','checked_in'
                      )),
  waitlist_position integer,
  booked_at         timestamptz default now(),
  cancelled_at      timestamptz,
  checked_in_at     timestamptz,
  promotion_source  text check (promotion_source is null or promotion_source in ('manual','auto')),
  promoted_at       timestamptz,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Only one active booking per member per class
create unique index if not exists idx_one_active_booking_per_member_class
  on class_bookings (class_id, member_id) where (is_active = true);

-- Common query indexes
create index if not exists idx_bookings_class on class_bookings(class_id);
create index if not exists idx_bookings_member on class_bookings(member_id);

-- ═══ BOOKING_EVENTS (append-only audit log) ═══════════════════════════
create table if not exists booking_events (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references studios(id),  -- v0.22.0 (M3)
  class_id    uuid not null references classes(id) on delete cascade,
  member_id   uuid references members(id) on delete set null,
  booking_id  uuid references class_bookings(id) on delete set null,
  event_type  text not null,
  event_label text,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_events_class on booking_events(class_id);
create index if not exists idx_events_booking on booking_events(booking_id);

-- ═══ PURCHASES — v0.13.0 (lifecycle fields added in v0.15.0) ═════════
-- Minimal idempotent log of fulfilled purchases. One row per Stripe
-- checkout session OR dev-fake purchase OR operator test purchase.
-- UNIQUE(external_id) is the idempotency guard used by sf_apply_purchase.
--
-- v0.15.0 lifecycle columns:
--   status           — 'completed' | 'failed' | 'refunded' | 'cancelled'.
--                      Only 'completed' is written today; the other
--                      values exist so a future refund / dispute flow
--                      can update a row without a schema change.
--   price_cents_paid — frozen at apply time so purchase history reflects
--                      the amount the member actually paid, regardless
--                      of subsequent plan-price edits. NULL on legacy
--                      pre-v0.15.0 rows.
--   credits_granted  — frozen at apply time (NULL for unlimited).
--
-- v0.15.0 source values:
--   'stripe'           — real Stripe checkout (webhook fulfilment).
--   'fake'             — legacy v0.13.0/v0.14.x dev-fake purchases.
--                        Kept allowed so historical rows still validate;
--                        no new code path emits this any more.
--   'dev_fake'         — member-home self-serve buy when Stripe isn't
--                        configured (preview deploys, local dev).
--   'operator_manual'  — operator test-purchase panel on /app/members/[id].
create table if not exists purchases (
  id               uuid primary key default gen_random_uuid(),
  studio_id        uuid not null references studios(id),  -- v0.22.0 (M3)
  member_id        uuid not null references members(id) on delete cascade,
  plan_id          text not null,
  source           text not null check (
    source in ('stripe','fake','dev_fake','operator_manual')
  ),
  external_id      text not null,
  status           text not null default 'completed' check (
    status in ('completed','failed','refunded','cancelled')
  ),
  price_cents_paid integer check (price_cents_paid is null or price_cents_paid >= 0),
  credits_granted  integer check (credits_granted is null or credits_granted >= 0),
  created_at       timestamptz not null default now(),
  unique (external_id)
);

create index if not exists idx_purchases_member_created
  on purchases(member_id, created_at desc);

-- ═══ PLANS — v0.14.0 (active flag added in v0.14.1) ══════════════════
-- Canonical plan catalogue. Rows here are the source of truth for what
-- can be purchased and what entitlement a purchase grants. Business
-- logic (applyPurchase, create-checkout-session) reads from here; the
-- `purchases.plan_id` text column references a row here by id.
--
-- A class_pack plan MUST carry credits > 0; an unlimited plan MUST have
-- credits NULL. This pairing is enforced at the DB so a typo in the
-- admin UI cannot create a plan that applyPurchase can't fulfil.
--
-- `active` governs visibility on member-facing purchase surfaces.
-- Inactive rows remain readable so historical purchases keep resolving
-- their human-readable plan name (no hard delete, ever).
create table if not exists plans (
  id           text primary key,
  studio_id    uuid not null references studios(id),  -- v0.22.0 (M3)
  name         text not null,
  type         text not null check (type in ('class_pack','unlimited')),
  price_cents  integer not null check (price_cents >= 0),
  credits      integer check (credits is null or credits > 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint plans_type_credits_coherent check (
    (type = 'class_pack' and credits is not null)
    or
    (type = 'unlimited' and credits is null)
  )
);

-- ═══ STAFF — v0.21.0 (operator + instructor RBAC) ════════════════════
-- One row per (auth user, staff role) — the same Supabase user can
-- ALSO hold a `members` row for self-service member access; the two
-- coexist and login surface choice (/login vs. /staff/login) drives
-- the routing.
--
-- Roles:
--   owner       — full operator access; later milestones add owner-only
--                 gates (refunds-only-for-owner, etc.).
--   manager     — operator access. Reaches /app/*, /instructor/*, and
--                 /api/admin/* in v0.21.0.
--   instructor  — reaches /instructor/* only.
--
-- v0.22.0 (M3) replaces UNIQUE(user_id) with UNIQUE(studio_id, user_id)
-- so the same person can hold roles at multiple studios.
create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references studios(id),  -- v0.22.0 (M3)
  user_id     uuid not null references auth.users(id),
  full_name   text not null,
  role        text not null check (role in ('owner','manager','instructor')),
  created_at  timestamptz not null default now()
);

create unique index if not exists idx_staff_studio_user on staff(studio_id, user_id);

-- Self-read policy: the proxy and server helpers query as the user's
-- own session (anon role) and need to read THEIR row to resolve their
-- role. v0.21.0 introduced this; v0.23.0 (M4) keeps it additively
-- alongside the tenant_isolation policy below — PostgreSQL evaluates
-- multiple permissive policies as OR, so the operator can both read
-- their own bootstrap row AND read every staff row in their studio.
alter table staff enable row level security;
drop policy if exists "staff can read self" on staff;
create policy "staff can read self" on staff
  for select using (user_id = auth.uid());

-- ═══ CLASS_TEMPLATES — v0.24.0 (Sprint A recurring class templates) ══
-- Operator-defined weekly templates. The /api/cron/materialise-templates
-- cron reads these daily and inserts/updates classes rows out to
-- studios.materialisation_horizon_weeks (default 8 weeks).
--
-- instructor_id is nullable — a template is valid (and materialisable)
-- without an assigned instructor; classes.instructor_name falls back to
-- "TBD" at materialisation time. ON DELETE SET NULL on instructor_id
-- so deleting a staff member doesn't cascade-delete templates.
--
-- valid_from / valid_until bracket the active window. valid_until NULL
-- means "no end date." Both are local dates (no timezone); the studio's
-- tz governs interpretation.
create table if not exists class_templates (
  id                        uuid primary key default gen_random_uuid(),
  studio_id                 uuid not null references studios(id) on delete cascade,
  name                      text not null,
  weekday                   smallint not null check (weekday between 0 and 6),
  start_time_local          time not null,
  duration_minutes          integer not null
                              check (duration_minutes > 0
                                     and duration_minutes <= 480),
  instructor_id             uuid references staff(id) on delete set null,
  capacity                  integer not null check (capacity > 0),
  cancellation_window_hours integer not null default 12,
  check_in_window_minutes   integer not null default 30,
  valid_from                date not null default current_date,
  valid_until               date,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint class_templates_valid_range_coherent
    check (valid_until is null or valid_until > valid_from)
);

create index if not exists idx_class_templates_studio on class_templates(studio_id);
create index if not exists idx_class_templates_studio_weekday_time
  on class_templates(studio_id, weekday, start_time_local);

-- Generic updated_at trigger function (new in v0.24.0; reusable).
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists class_templates_set_updated_at on class_templates;
create trigger class_templates_set_updated_at
  before update on class_templates
  for each row execute function set_updated_at();

-- Late FK on classes.template_id (declared in the classes table above
-- as `template_id uuid` without REFERENCES because schema.sql defines
-- classes BEFORE staff, and class_templates references staff).
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'classes'
      and constraint_name = 'classes_template_id_fkey'
  ) then
    alter table classes
      add constraint classes_template_id_fkey
      foreign key (template_id) references class_templates(id) on delete set null;
  end if;
end$$;

-- ═══ v0.23.0 (M4) — tenant_isolation policies on every tenant-scoped
-- table. One policy each, FOR ALL (SELECT/INSERT/UPDATE/DELETE), using
-- and with-check both bound to studio_id = current_studio_id(). Service
-- role bypasses these by design; the four exception routes
-- (src/lib/supabase.ts getSupabaseServiceClient() callers) rely on it.
-- See docs/adr/0001-multi-tenancy.md Decision 1.

alter table studios enable row level security;
drop policy if exists studios_tenant_isolation on studios;
create policy studios_tenant_isolation on studios
  for all
  using (id = current_studio_id())
  with check (id = current_studio_id());

alter table members enable row level security;
drop policy if exists members_tenant_isolation on members;
create policy members_tenant_isolation on members
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

drop policy if exists staff_tenant_isolation on staff;
create policy staff_tenant_isolation on staff
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

alter table classes enable row level security;
drop policy if exists classes_tenant_isolation on classes;
create policy classes_tenant_isolation on classes
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

-- v0.24.0 (Sprint A) — class_templates mirrors classes.
alter table class_templates enable row level security;
drop policy if exists class_templates_tenant_isolation on class_templates;
create policy class_templates_tenant_isolation on class_templates
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

-- credit_transactions lives in functions.sql alongside its CREATE TABLE.
-- Its tenant_isolation policy is added in functions.sql for the same
-- reason.
