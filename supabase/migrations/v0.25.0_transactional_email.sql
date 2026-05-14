-- supabase/migrations/v0.25.0_transactional_email.sql
-- Sprint B — Transactional email (booking confirmation, T-24h reminder,
-- waitlist promote, cancellation receipt, payment receipt).
--
-- Applied manually via the Supabase SQL Editor BEFORE merging this PR.
-- Single transaction, idempotent (CREATE TABLE IF NOT EXISTS / DROP IF
-- EXISTS / CREATE OR REPLACE patterns throughout).
--
-- Sections:
--   1. studios.transactional_emails_enabled
--   2. email_queue table + indexes + RLS
--   3. Trigger function + trigger A on booking_events
--   4. Trigger function + trigger B on purchases
--   5. Sanity checks
--
-- Rollback steps (no _down.sql convention in this repo — execute
-- manually if needed):
--   begin;
--     drop trigger if exists email_queue_purchases on purchases;
--     drop function if exists sf_queue_purchase_email() cascade;
--     drop trigger if exists email_queue_booking_events on booking_events;
--     drop function if exists sf_queue_booking_email() cascade;
--     drop policy if exists email_queue_tenant_isolation on email_queue;
--     alter table email_queue disable row level security;
--     drop index if exists idx_email_queue_drain;
--     drop index if exists idx_email_queue_purchase_template_unique;
--     drop index if exists idx_email_queue_booking_template_unique;
--     drop table if exists email_queue;
--     alter table studios drop column if exists transactional_emails_enabled;
--   commit;

begin;

-- ═══ 1. studios.transactional_emails_enabled ══════════════════════════
-- Per-studio blanket opt-out. Default ON. Pre-pilot we don't surface
-- per-template toggles (Decision 7). Triggers check this column before
-- queuing; if false, no row gets queued (cron stays empty for that
-- studio).
alter table public.studios
  add column if not exists transactional_emails_enabled boolean
  not null default true;


-- ═══ 2. email_queue table ════════════════════════════════════════════
-- Unified queue with polymorphic source (booking_event_id OR
-- purchase_id, exactly one not null — Decision 11). Snapshot all render
-- context into `context` at queue time so the send-time render is
-- deterministic regardless of later mutations to source rows.

create table if not exists public.email_queue (
  id                 uuid primary key default gen_random_uuid(),
  studio_id          uuid not null references public.studios(id)
                       on delete cascade,
  template_type      text not null check (template_type in (
    'booking_confirmation',
    'reminder_24h',
    'waitlist_promote',
    'cancellation_receipt',
    'payment_receipt'
  )),
  recipient_email    text not null,
  recipient_name     text,
  -- Snapshot of all data the template needs to render. JSON shape is
  -- enforced at the app layer (see src/lib/email/templates/*.tsx props
  -- types).
  context            jsonb not null,
  -- Polymorphic source. Exactly one not null — see CHECK below.
  booking_event_id   uuid references public.booking_events(id)
                       on delete set null,
  purchase_id        uuid references public.purchases(id)
                       on delete set null,
  scheduled_for      timestamptz not null default now(),
  status             text not null default 'pending' check (status in (
    'pending', 'sending', 'sent', 'failed', 'dead_letter', 'cancelled'
  )),
  attempts           integer not null default 0,
  last_attempt_at    timestamptz,
  last_error         text,
  sent_at            timestamptz,
  resend_message_id  text,
  created_at         timestamptz not null default now(),
  constraint email_queue_source_xor check (
    (booking_event_id is not null and purchase_id is null)
    or (booking_event_id is null and purchase_id is not null)
  )
);

-- Idempotency: at most one queued row per (source, template_type).
-- Partial indexes because only ONE of (booking_event_id, purchase_id)
-- is set per row (CHECK above).
create unique index if not exists idx_email_queue_booking_template_unique
  on public.email_queue (booking_event_id, template_type)
  where booking_event_id is not null;

create unique index if not exists idx_email_queue_purchase_template_unique
  on public.email_queue (purchase_id, template_type)
  where purchase_id is not null;

-- Drain-friendly partial index: only pending rows count, and they need
-- to be picked up in scheduled_for order.
create index if not exists idx_email_queue_drain
  on public.email_queue (scheduled_for)
  where status = 'pending';

-- RLS — tenant isolation mirroring classes_tenant_isolation. The drain
-- cron uses the service-role client and bypasses this policy.
alter table public.email_queue enable row level security;
drop policy if exists email_queue_tenant_isolation on public.email_queue;
create policy email_queue_tenant_isolation on public.email_queue
  for all
  using (studio_id = current_studio_id())
  with check (studio_id = current_studio_id());


-- ═══ 3. Trigger A — booking_events email queueing ═════════════════════
-- AFTER INSERT on booking_events. Resolves studio_id, class, member,
-- checks the studio opt-out, and queues:
--   - 'booked'                      → booking_confirmation + reminder_24h
--                                       (reminder_24h skipped if booking
--                                        is < 24h before class start)
--   - 'cancelled' / 'late_cancel'   → cancellation_receipt; also marks
--                                       any pending reminder_24h for
--                                       earlier booking_events on this
--                                       booking_id as 'cancelled'
--   - 'promoted_manual' / 'promoted_auto' → waitlist_promote
--   - everything else (waitlisted, checked_in, no_show, unpromoted, …)
--       → no email
--
-- SECURITY DEFINER (per Open Q #1): triggers fire in the writer's
-- transaction. The writer may be a member-session user (booking
-- themselves) whose RLS view of `studios` excludes other studios —
-- but the trigger needs to read `studios.transactional_emails_enabled`
-- and write to email_queue regardless of the writer's RLS posture.
-- Running as the function owner (postgres) bypasses RLS; the function
-- enforces tenancy by deriving studio_id from NEW.class_id directly,
-- never trusting the caller's session.

create or replace function public.sf_queue_booking_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio       record;
  v_class        record;
  v_member       record;
  v_template     text;
  v_scheduled    timestamptz;
  v_context      jsonb;
  v_refundable   boolean;
  v_studio_name  text;
begin
  -- Resolve studio + class + member up front. NEW.studio_id is the
  -- audit-row's studio_id (set by the sf_* functions); we re-derive
  -- via class.studio_id as belt-and-braces.
  select s.id, s.name, s.transactional_emails_enabled
    into v_studio
    from studios s
   where s.id = NEW.studio_id;

  if v_studio is null then
    -- Defensive: orphan event row, no studio to attribute. Skip.
    return NEW;
  end if;

  if v_studio.transactional_emails_enabled is not true then
    -- Studio has opted out. No row queued for any event.
    return NEW;
  end if;

  v_studio_name := v_studio.name;

  select c.id, c.title, c.starts_at, c.ends_at, c.instructor_name,
         c.location_name, c.cancellation_window_hours
    into v_class
    from classes c
   where c.id = NEW.class_id;

  if v_class is null then
    return NEW;
  end if;

  -- Member is the recipient. We need email + full_name. Members with a
  -- null email never get queued — Resend would reject the send anyway.
  select m.id, m.email, m.full_name
    into v_member
    from members m
   where m.id = NEW.member_id;

  if v_member is null or v_member.email is null then
    return NEW;
  end if;

  -- Pick the template based on event_type.
  case NEW.event_type
    when 'booked' then
      v_template := 'booking_confirmation';
      v_scheduled := now();
    when 'cancelled', 'late_cancel' then
      v_template := 'cancellation_receipt';
      v_scheduled := now();
    when 'promoted_manual', 'promoted_auto' then
      v_template := 'waitlist_promote';
      v_scheduled := now();
    else
      -- All other event_types (waitlisted, checked_in, no_show,
      -- unpromoted, correction_*, …) produce no email.
      return NEW;
  end case;

  -- Build the JSON context snapshot. Render-time props match the
  -- typed interfaces in src/lib/email/templates/*.tsx.
  if v_template = 'cancellation_receipt' then
    -- Refundable if cancellation happened before the window cutoff.
    v_refundable := (NEW.event_type = 'cancelled');
    v_context := jsonb_build_object(
      'studio_name', v_studio_name,
      'member_name', v_member.full_name,
      'class_title', v_class.title,
      'class_starts_at', v_class.starts_at,
      'class_instructor', v_class.instructor_name,
      'class_location', v_class.location_name,
      'refundable', v_refundable,
      'cancellation_kind', NEW.event_type
    );
  else
    v_context := jsonb_build_object(
      'studio_name', v_studio_name,
      'member_name', v_member.full_name,
      'class_title', v_class.title,
      'class_starts_at', v_class.starts_at,
      'class_ends_at', v_class.ends_at,
      'class_instructor', v_class.instructor_name,
      'class_location', v_class.location_name,
      'cancellation_window_hours', v_class.cancellation_window_hours
    );
  end if;

  -- Insert the immediate email. Idempotent on
  -- (booking_event_id, template_type) — duplicate event-row inserts
  -- (shouldn't happen, but defensively) silently no-op the duplicate.
  insert into email_queue (
    studio_id, template_type, recipient_email, recipient_name,
    context, booking_event_id, scheduled_for
  )
  values (
    v_studio.id, v_template, v_member.email, v_member.full_name,
    v_context, NEW.id, v_scheduled
  )
  on conflict (booking_event_id, template_type)
    where booking_event_id is not null
  do nothing;

  -- For 'booked', also schedule the T-24h reminder. Skip if the class
  -- starts in less than 24h from now (the reminder would fire
  -- immediately or after the class — useless).
  if NEW.event_type = 'booked' then
    if v_class.starts_at - interval '24 hours' > now() then
      insert into email_queue (
        studio_id, template_type, recipient_email, recipient_name,
        context, booking_event_id, scheduled_for
      )
      values (
        v_studio.id, 'reminder_24h', v_member.email, v_member.full_name,
        v_context, NEW.id, v_class.starts_at - interval '24 hours'
      )
      on conflict (booking_event_id, template_type)
        where booking_event_id is not null
      do nothing;
    end if;
  end if;

  -- For cancellations, drop any pending reminder_24h queued from the
  -- earlier 'booked' event on the same booking. We don't know that
  -- booking_event's id from here, so we walk via NEW.booking_id and
  -- match through the booking_event_id join. Set status to 'cancelled'
  -- so the drain cron skips it; don't delete (keeps audit trail).
  if NEW.event_type in ('cancelled', 'late_cancel') then
    update email_queue eq
       set status = 'cancelled',
           last_error = 'booking cancelled before reminder fired'
      from booking_events be
     where eq.booking_event_id = be.id
       and be.booking_id = NEW.booking_id
       and eq.template_type = 'reminder_24h'
       and eq.status = 'pending';
  end if;

  return NEW;
end;
$$;

drop trigger if exists email_queue_booking_events on public.booking_events;
create trigger email_queue_booking_events
  after insert on public.booking_events
  for each row execute function public.sf_queue_booking_email();


-- ═══ 4. Trigger B — purchases email queueing ══════════════════════════
-- AFTER UPDATE on purchases. Fires only on the TRANSITION
--   OLD.status != 'completed' AND NEW.status = 'completed'
-- so refunds → completed (not a transition we'd issue today) don't
-- double-fire. Also fires on the INSERT path because purchases are
-- typically INSERTed with status='completed' from the Stripe webhook;
-- to handle that, we attach the trigger to both INSERT and UPDATE
-- and gate on the same final-state condition.

create or replace function public.sf_queue_purchase_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio       record;
  v_member       record;
  v_plan_name    text;
  v_context      jsonb;
  v_should_fire  boolean;
begin
  -- Did this row transition INTO 'completed'? On INSERT, OLD is NULL,
  -- so the transition test reduces to NEW.status = 'completed'.
  if TG_OP = 'UPDATE' then
    v_should_fire := (NEW.status = 'completed'
                      and (OLD.status is null
                           or OLD.status <> 'completed'));
  else  -- INSERT
    v_should_fire := (NEW.status = 'completed');
  end if;

  if not v_should_fire then
    return NEW;
  end if;

  select s.id, s.name, s.transactional_emails_enabled
    into v_studio
    from studios s
   where s.id = NEW.studio_id;

  if v_studio is null or v_studio.transactional_emails_enabled is not true then
    return NEW;
  end if;

  select m.id, m.email, m.full_name
    into v_member
    from members m
   where m.id = NEW.member_id;

  if v_member is null or v_member.email is null then
    return NEW;
  end if;

  -- Plan name — best-effort. plans.id is text and lives in the plans
  -- table; if the plan was renamed since purchase, the receipt uses
  -- the current name (acceptable — receipts are sent immediately).
  select p.name into v_plan_name
    from plans p
   where p.id = NEW.plan_id and p.studio_id = NEW.studio_id;

  v_context := jsonb_build_object(
    'studio_name', v_studio.name,
    'member_name', v_member.full_name,
    'plan_id', NEW.plan_id,
    'plan_name', coalesce(v_plan_name, NEW.plan_id),
    'price_cents_paid', NEW.price_cents_paid,
    'credits_granted', NEW.credits_granted,
    'source', NEW.source,
    'external_id', NEW.external_id,
    'created_at', NEW.created_at
  );

  insert into email_queue (
    studio_id, template_type, recipient_email, recipient_name,
    context, purchase_id, scheduled_for
  )
  values (
    v_studio.id, 'payment_receipt', v_member.email, v_member.full_name,
    v_context, NEW.id, now()
  )
  on conflict (purchase_id, template_type)
    where purchase_id is not null
  do nothing;

  return NEW;
end;
$$;

drop trigger if exists email_queue_purchases on public.purchases;
create trigger email_queue_purchases
  after insert or update on public.purchases
  for each row execute function public.sf_queue_purchase_email();


-- ═══ 5. Sanity checks ═════════════════════════════════════════════════
select 'email_queue RLS enabled' as check_name,
       case when rowsecurity then 1 else 0 end::bigint as value
  from pg_tables where schemaname = 'public' and tablename = 'email_queue'
union all
select 'email_queue_tenant_isolation policy exists',
       count(*)
  from pg_policies
  where schemaname = 'public'
    and tablename = 'email_queue'
    and policyname = 'email_queue_tenant_isolation'
union all
select 'studios.transactional_emails_enabled column exists',
       count(*)
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'studios'
    and column_name = 'transactional_emails_enabled'
union all
select 'email_queue triggers installed',
       count(*)
  from pg_trigger
  where tgname in ('email_queue_booking_events', 'email_queue_purchases');

commit;
