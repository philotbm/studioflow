-- supabase/migrations/v0.24.0_recurring_class_templates.sql
-- Sprint A — Recurring class templates.
-- Applied manually via the Supabase SQL Editor BEFORE merging this PR's
-- Vercel deploy. Single transaction, idempotent (IF NOT EXISTS / DROP IF
-- EXISTS patterns throughout).
--
-- Sections:
--   1. set_updated_at() generic trigger function
--   2. studios.tz + studios.materialisation_horizon_weeks
--   3. class_templates table + indexes + trigger
--   4. classes.template_id + indexes
--   5. RLS on class_templates
--
-- Rollback steps (no _down.sql convention in this repo — execute manually
-- if needed):
--   begin;
--     drop policy if exists class_templates_tenant_isolation on class_templates;
--     alter table class_templates disable row level security;
--     drop trigger if exists class_templates_set_updated_at on class_templates;
--     drop index if exists idx_classes_template_scheduled_at_unique;
--     drop index if exists idx_classes_template_id;
--     alter table classes drop column if exists template_id;
--     drop table if exists class_templates;
--     alter table studios drop column if exists materialisation_horizon_weeks;
--     alter table studios drop column if exists tz;
--     -- set_updated_at() stays — generic and harmless.
--   commit;

begin;

-- ═══ 1. set_updated_at() generic trigger function ═════════════════════
-- Sets NEW.updated_at = now() on every UPDATE. New in v0.24.0; designed
-- to be reused by any future table that needs an updated_at trigger.
-- Existing tables (members, classes, class_bookings) carry updated_at
-- columns but rely on the app layer to set them; that's left alone.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ═══ 2. studios.tz + materialisation_horizon_weeks ════════════════════
-- All existing studio rows get the defaults (Europe/Dublin, 8 weeks)
-- on migration. The cron at /api/cron/materialise-templates uses these
-- to compute UTC starts_at from each template's start_time_local +
-- materialise out to horizon_weeks * 7 days.

alter table public.studios
  add column if not exists tz text not null default 'Europe/Dublin';

alter table public.studios
  add column if not exists materialisation_horizon_weeks integer not null
  default 8;

-- Add the CHECK constraint separately so re-running this migration on a
-- DB that already has the column doesn't fail on "constraint already
-- exists." Drop-if-exists isn't available for CHECKs by name without
-- knowing the constraint name — so we name it explicitly.
alter table public.studios
  drop constraint if exists studios_materialisation_horizon_weeks_check;
alter table public.studios
  add constraint studios_materialisation_horizon_weeks_check
  check (materialisation_horizon_weeks between 2 and 26);


-- ═══ 3. class_templates table ════════════════════════════════════════
-- One row per recurring class template (e.g. "Vinyasa Monday 18:00").
-- The materialise cron reads these and inserts/updates classes rows
-- on a sliding per-studio horizon. instructor_id is nullable — a
-- template is valid (and materialisable) without an assigned instructor
-- (classes.instructor_name falls back to "TBD" at materialisation time).

create table if not exists public.class_templates (
  id                        uuid primary key default gen_random_uuid(),
  studio_id                 uuid not null references public.studios(id)
                              on delete cascade,
  name                      text not null,
  -- 0=Sunday, 6=Saturday (matches PostgreSQL EXTRACT(DOW) convention)
  weekday                   smallint not null check (weekday between 0 and 6),
  start_time_local          time not null,
  duration_minutes          integer not null
                              check (duration_minutes > 0
                                     and duration_minutes <= 480),
  -- References staff(id). ON DELETE SET NULL so deleting a staff member
  -- doesn't cascade-delete templates; the template just loses its
  -- instructor assignment and the operator can re-attach.
  instructor_id             uuid references public.staff(id) on delete set null,
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

-- Common-access indexes. The cron reads by studio_id + valid range; the
-- UI list view reads by studio_id ordered by weekday + start_time_local.
create index if not exists idx_class_templates_studio
  on public.class_templates(studio_id);
create index if not exists idx_class_templates_studio_weekday_time
  on public.class_templates(studio_id, weekday, start_time_local);

-- Auto-bump updated_at on every UPDATE.
drop trigger if exists class_templates_set_updated_at on public.class_templates;
create trigger class_templates_set_updated_at
  before update on public.class_templates
  for each row execute function public.set_updated_at();


-- ═══ 4. classes.template_id + supporting indexes ══════════════════════
-- Materialised classes carry a back-pointer to the template that produced
-- them. NULL is "legacy / ad-hoc class" — pre-Sprint-A classes (e.g. the
-- demo seed's six fixed slugs) stay NULL on this migration; only future
-- materialisations populate template_id.
--
-- ON DELETE SET NULL lets the operator delete a template without
-- cascade-deleting historical classes rows. Bookings on those classes
-- stay intact; the classes just become unanchored from templates.

alter table public.classes
  add column if not exists template_id uuid
  references public.class_templates(id) on delete set null;

-- Partial index — only the materialised classes are interesting for
-- template-keyed lookups; the legacy ad-hoc rows are NULL and excluded.
create index if not exists idx_classes_template_id
  on public.classes(template_id)
  where template_id is not null;

-- Unique index supporting the cron's idempotent upsert: one materialised
-- class per (template_id, starts_at). Re-running the cron on the same
-- day produces no duplicate rows.
create unique index if not exists idx_classes_template_scheduled_at_unique
  on public.classes(template_id, starts_at)
  where template_id is not null;


-- ═══ 5. RLS on class_templates ════════════════════════════════════════
-- Mirrors classes_tenant_isolation exactly. Service role bypasses (the
-- cron uses the service-role client; see ADR-0001 Decision 1).

alter table public.class_templates enable row level security;
drop policy if exists class_templates_tenant_isolation on public.class_templates;
create policy class_templates_tenant_isolation on public.class_templates
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());

-- Sanity checks — same shape as v0.23.0_migration.sql section 4.
select 'class_templates RLS enabled' as check_name,
       case when rowsecurity then 1 else 0 end::bigint as value
  from pg_tables where schemaname = 'public' and tablename = 'class_templates'
union all
select 'class_templates_tenant_isolation policy exists',
       count(*)
  from pg_policies
  where schemaname = 'public'
    and tablename = 'class_templates'
    and policyname = 'class_templates_tenant_isolation'
union all
select 'classes.template_id column exists',
       count(*)
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'classes'
    and column_name = 'template_id'
union all
select 'studios.tz column exists',
       count(*)
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'studios'
    and column_name = 'tz';

commit;
