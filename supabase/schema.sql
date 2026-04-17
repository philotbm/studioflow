-- StudioFlow v0.4.8 — Supabase Foundation Schema
-- Run this in the Supabase SQL Editor before seed.sql

-- ═══ MEMBERS ═══════════════════════════════════════════════════════════
create table if not exists members (
  id                       uuid primary key default gen_random_uuid(),
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
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ═══ CLASSES ═══════════════════════════════════════════════════════════
create table if not exists classes (
  id                        uuid primary key default gen_random_uuid(),
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
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ═══ CLASS_BOOKINGS ════════════════════════════════════════════════════
create table if not exists class_bookings (
  id                uuid primary key default gen_random_uuid(),
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
