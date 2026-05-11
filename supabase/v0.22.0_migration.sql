-- supabase/v0.22.0_migration.sql
-- M3 — Multi-tenancy. One studios row, studio_id everywhere.
-- Applied manually via the Supabase SQL Editor BEFORE merging this PR's
-- Vercel deploy. See ADR-0001 Decisions 1, 3, 5 and docs/specs/M3_multi_tenancy.md.
--
-- Single transaction, idempotent. Re-running is a no-op except for the
-- sanity-check SELECTs at the bottom (those re-print every time).
--
-- Sections:
--   1. studios table + demo row
--   2. studio_id columns on every tenant-scoped table
--   3. drop+replace the user_id unique indexes per ADR Decision 3
--   4. current_studio_id() helper function (ADR Decision 2)
--   5. PL/pgSQL function bodies updated for studio_id filtering
--   6. sanity checks

begin;

-- ═══ 1. studios table + demo row ═══════════════════════════════════════
create table if not exists studios (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,
  name                   text not null,
  plan_id                text not null default 'starter'
                           check (plan_id in ('starter','pro','studio')),
  member_count_cap       int,  -- 50 (starter) / 250 (pro) / NULL (studio = unlimited)
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz not null default now()
);

insert into studios (slug, name, plan_id, member_count_cap)
values ('demo', 'Demo Studio', 'studio', NULL)
on conflict (slug) do nothing;

-- ═══ 2. studio_id column on every tenant-scoped table ════════════════
-- Pattern per table: catalog check → ADD COLUMN with DEFAULT (backfills
-- existing rows to the demo studio) → DROP DEFAULT (future inserts must
-- be explicit, either by the proxy or by passing studio_id directly).
-- Copy-pasted verbatim per table for PR-review visibility — see spec
-- Section 1's "don't refactor into a helper" note.

do $migration$
declare
  demo_id uuid := (select id from studios where slug = 'demo');
begin
  if demo_id is null then
    raise exception 'M3 migration: demo studio row not found after insert; aborting';
  end if;

  -- members
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'studio_id';
  if not found then
    execute format(
      'alter table members add column studio_id uuid not null default %L references studios(id)',
      demo_id
    );
    alter table members alter column studio_id drop default;
  end if;

  -- staff
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'studio_id';
  if not found then
    execute format(
      'alter table staff add column studio_id uuid not null default %L references studios(id)',
      demo_id
    );
    alter table staff alter column studio_id drop default;
  end if;

  -- classes
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'studio_id';
  if not found then
    execute format(
      'alter table classes add column studio_id uuid not null default %L references studios(id)',
      demo_id
    );
    alter table classes alter column studio_id drop default;
  end if;

  -- class_bookings
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'class_bookings' and column_name = 'studio_id';
  if not found then
    execute format(
      'alter table class_bookings add column studio_id uuid not null default %L references studios(id)',
      demo_id
    );
    alter table class_bookings alter column studio_id drop default;
  end if;

  -- booking_events
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'booking_events' and column_name = 'studio_id';
  if not found then
    execute format(
      'alter table booking_events add column studio_id uuid not null default %L references studios(id)',
      demo_id
    );
    alter table booking_events alter column studio_id drop default;
  end if;

  -- purchases
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'studio_id';
  if not found then
    execute format(
      'alter table purchases add column studio_id uuid not null default %L references studios(id)',
      demo_id
    );
    alter table purchases alter column studio_id drop default;
  end if;

  -- plans
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans' and column_name = 'studio_id';
  if not found then
    execute format(
      'alter table plans add column studio_id uuid not null default %L references studios(id)',
      demo_id
    );
    alter table plans alter column studio_id drop default;
  end if;

  -- credit_transactions
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'credit_transactions' and column_name = 'studio_id';
  if not found then
    execute format(
      'alter table credit_transactions add column studio_id uuid not null default %L references studios(id)',
      demo_id
    );
    alter table credit_transactions alter column studio_id drop default;
  end if;

  -- ═══ 3. Drop the old user_id unique indexes; replace per ADR D3 ════
  drop index if exists idx_members_user_id;
  create unique index if not exists idx_members_studio_user
    on members(studio_id, user_id) where user_id is not null;

  drop index if exists idx_staff_user_id;
  create unique index if not exists idx_staff_studio_user
    on staff(studio_id, user_id);
end $migration$;

-- ═══ 4. current_studio_id() — derive caller's studio_id ════════════════
-- ADR Decision 2. STABLE so Postgres can cache the result within a
-- transaction. SECURITY DEFINER so it can read staff/members regardless
-- of caller RLS (safe today — RLS is off on data tables, on-with-self-
-- read on staff). search_path locked to public so a hostile session
-- can't shadow `staff` / `members` via temp schemas.
--
-- COALESCE prefers staff over members per ADR Decision 2 (operator
-- session implies "operator view"). Cross-studio session-scoped
-- override (set_current_studio_id) is deliberately NOT pre-built — see
-- ADR Decision 2's open question.

create or replace function current_studio_id() returns uuid
language sql stable security definer set search_path = public as $function$
  select coalesce(
    (select studio_id from staff   where user_id = auth.uid() limit 1),
    (select studio_id from members where user_id = auth.uid() limit 1)
  );
$function$;

-- ═══ 5. PL/pgSQL function bodies updated for studio_id filtering ══════
-- Pattern: slug-based lookups take an optional p_studio_id (defaults to
-- current_studio_id()) and add `and studio_id = v_studio_id` to the
-- WHERE clauses. Inserts into tenant-scoped tables include studio_id
-- (looked up from the parent row when not passed). Return shapes
-- unchanged. Internal helpers that take ids (sf_consume_credit,
-- sf_refund_credit, sf_auto_promote, sf_count_booked,
-- sf_resequence_waitlist) keep their existing signatures — the id
-- itself encodes the studio identity.

-- sf_consume_credit — internal helper, signature unchanged. Inserts
-- credit_transactions; studio_id resolved from the member row.
create or replace function sf_consume_credit(
  p_member_id    uuid,
  p_reason_code  text,
  p_source       text default 'system',
  p_class_id     uuid default null,
  p_booking_id   uuid default null,
  p_note         text default null,
  p_operator_key text default null
) returns jsonb language plpgsql as $function$
declare
  v_plan text;
  v_studio uuid;
  v_bal_after integer;
  v_ledger_id uuid;
begin
  select plan_type, studio_id into v_plan, v_studio
  from members where id = p_member_id for update;

  if v_plan in ('class_pack','trial') then
    update members
    set credits_remaining = greatest(coalesce(credits_remaining, 0) - 1, 0),
        updated_at = now()
    where id = p_member_id
    returning credits_remaining into v_bal_after;

    insert into credit_transactions (
      member_id, studio_id, delta, balance_after, reason_code, source,
      class_id, booking_id, note, operator_key
    )
    values (
      p_member_id, v_studio, -1, v_bal_after, p_reason_code, p_source,
      p_class_id, p_booking_id, p_note, p_operator_key
    )
    returning id into v_ledger_id;

    return jsonb_build_object(
      'consumed', true,
      'balance_after', v_bal_after,
      'ledger_id', v_ledger_id
    );
  end if;
  return jsonb_build_object('consumed', false);
end;
$function$;

-- sf_refund_credit — internal helper, signature unchanged. Same shape
-- as sf_consume_credit but credits a single unit back.
create or replace function sf_refund_credit(
  p_member_id    uuid,
  p_reason_code  text,
  p_source       text default 'system',
  p_class_id     uuid default null,
  p_booking_id   uuid default null,
  p_note         text default null,
  p_operator_key text default null
) returns jsonb language plpgsql as $function$
declare
  v_plan text;
  v_studio uuid;
  v_bal_after integer;
  v_ledger_id uuid;
begin
  select plan_type, studio_id into v_plan, v_studio
  from members where id = p_member_id for update;

  if v_plan in ('class_pack','trial') then
    update members
    set credits_remaining = coalesce(credits_remaining, 0) + 1,
        updated_at = now()
    where id = p_member_id
    returning credits_remaining into v_bal_after;

    insert into credit_transactions (
      member_id, studio_id, delta, balance_after, reason_code, source,
      class_id, booking_id, note, operator_key
    )
    values (
      p_member_id, v_studio, 1, v_bal_after, p_reason_code, p_source,
      p_class_id, p_booking_id, p_note, p_operator_key
    )
    returning id into v_ledger_id;

    return jsonb_build_object(
      'refunded', true,
      'balance_after', v_bal_after,
      'ledger_id', v_ledger_id
    );
  end if;
  return jsonb_build_object('refunded', false);
end;
$function$;

-- sf_adjust_credit — slug-based, gets p_studio_id with current_studio_id
-- fallback. Member lookup filters by (slug, studio_id). credit_transactions
-- insert carries studio_id.
create or replace function sf_adjust_credit(
  p_member_slug  text,
  p_delta        integer,
  p_reason_code  text,
  p_note         text default null,
  p_operator_key text default null,
  p_studio_id    uuid default null
) returns jsonb language plpgsql as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
  v_member RECORD;
  v_bal_after integer;
  v_ledger_id uuid;
  v_allowed text[] := array[
    'bereavement', 'medical', 'studio_error',
    'goodwill', 'admin_correction', 'service_recovery'
  ];
begin
  if v_studio_id is null then
    return jsonb_build_object('error', 'no_studio_context');
  end if;
  if p_delta = 0 then
    return jsonb_build_object('error', 'Delta must be non-zero');
  end if;
  if p_reason_code is null or not (p_reason_code = any(v_allowed)) then
    return jsonb_build_object(
      'error',
      'Reason code required — one of: ' || array_to_string(v_allowed, ', ')
    );
  end if;

  select id, plan_type, credits_remaining into v_member
  from members where slug = p_member_slug and studio_id = v_studio_id for update;

  if v_member is null then
    return jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  end if;

  if v_member.plan_type = 'unlimited' then
    return jsonb_build_object('error', 'Cannot adjust credits on an unlimited plan');
  end if;
  if v_member.plan_type = 'drop_in' then
    return jsonb_build_object('error', 'Cannot adjust credits on a drop-in member');
  end if;

  v_bal_after := greatest(coalesce(v_member.credits_remaining, 0) + p_delta, 0);

  update members
  set credits_remaining = v_bal_after,
      updated_at = now()
  where id = v_member.id;

  insert into credit_transactions (
    member_id, studio_id, delta, balance_after, reason_code, source,
    note, operator_key
  )
  values (
    v_member.id, v_studio_id, p_delta, v_bal_after, p_reason_code, 'operator',
    p_note, p_operator_key
  )
  returning id into v_ledger_id;

  return jsonb_build_object(
    'ok', true,
    'balance_after', v_bal_after,
    'ledger_id', v_ledger_id,
    'delta', p_delta,
    'reason_code', p_reason_code
  );
end;
$function$;

-- sf_auto_promote — internal helper, takes class_id directly. Resolves
-- studio_id from the class row for the booking_events insert.
create or replace function sf_auto_promote(p_class_id uuid, p_capacity integer)
returns integer language plpgsql as $function$
declare
  v_studio uuid;
  v_booked integer;
  v_next RECORD;
  v_promoted integer := 0;
  v_elig jsonb;
  v_skipped_ids uuid[] := array[]::uuid[];
begin
  select studio_id into v_studio from classes where id = p_class_id;

  loop
    v_booked := sf_count_booked(p_class_id);
    exit when v_booked >= p_capacity;

    select id, member_id, waitlist_position into v_next
    from class_bookings
    where class_id = p_class_id
      and booking_status = 'waitlisted'
      and is_active = true
      and not (id = any(v_skipped_ids))
    order by waitlist_position asc
    limit 1;

    exit when v_next is null;

    v_elig := sf_check_eligibility(v_next.member_id);
    if (v_elig->>'can_book')::boolean = false then
      v_skipped_ids := array_append(v_skipped_ids, v_next.id);
      continue;
    end if;

    update class_bookings set
      booking_status = 'booked',
      promotion_source = 'auto',
      promoted_at = now(),
      waitlist_position = null,
      updated_at = now()
    where id = v_next.id;

    perform sf_consume_credit(
      v_next.member_id, 'auto_promotion', 'system', p_class_id, v_next.id
    );

    insert into booking_events (
      class_id, member_id, booking_id, studio_id,
      event_type, event_label, metadata
    )
    values (
      p_class_id, v_next.member_id, v_next.id, v_studio,
      'promoted_auto',
      'Auto-promoted from waitlist #' || v_next.waitlist_position,
      jsonb_build_object('original_position', v_next.waitlist_position)
    );

    v_promoted := v_promoted + 1;
  end loop;

  return v_promoted;
end;
$function$;

-- sf_book_member — slug-based, takes p_studio_id with current_studio_id
-- fallback. Both class and member lookups filter by studio_id. The
-- class_bookings + booking_events inserts carry studio_id.
create or replace function sf_book_member(
  p_class_slug  text,
  p_member_slug text,
  p_studio_id   uuid default null
) returns jsonb language plpgsql as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
  v_class RECORD;
  v_member RECORD;
  v_existing RECORD;
  v_booked integer;
  v_next_pos integer;
  v_booking_id uuid;
  v_status text;
  v_elig jsonb;
begin
  if v_studio_id is null then
    return jsonb_build_object('error', 'no_studio_context');
  end if;

  select id into v_member from members
  where slug = p_member_slug and studio_id = v_studio_id;
  if v_member is null then
    return jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  end if;

  v_elig := sf_check_eligibility(v_member.id);
  if (v_elig->>'can_book')::boolean = false then
    return jsonb_build_object(
      'status', 'blocked',
      'reason', v_elig->>'reason',
      'entitlement_label', v_elig->>'entitlement_label',
      'credits_remaining', v_elig->'credits_remaining',
      'action_hint', v_elig->>'action_hint',
      'status_code', v_elig->>'status_code'
    );
  end if;

  select id, capacity, starts_at, ends_at into v_class
  from classes where slug = p_class_slug and studio_id = v_studio_id for update;
  if v_class is null then
    return jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  end if;

  if v_class.ends_at < now() then
    return jsonb_build_object('error', 'Class is completed');
  end if;
  if v_class.starts_at <= now() and v_class.ends_at >= now() then
    return jsonb_build_object('error', 'Class is currently live');
  end if;

  select id, booking_status into v_existing
  from class_bookings
  where class_id = v_class.id and member_id = v_member.id and is_active = true;

  if v_existing is not null then
    return jsonb_build_object(
      'status', v_existing.booking_status,
      'booking_id', v_existing.id,
      'already_exists', true
    );
  end if;

  v_booked := sf_count_booked(v_class.id);

  if v_booked < v_class.capacity then
    v_status := 'booked';
    insert into class_bookings (
      class_id, member_id, studio_id, booking_status, booked_at, is_active
    )
    values (v_class.id, v_member.id, v_studio_id, 'booked', now(), true)
    returning id into v_booking_id;

    perform sf_consume_credit(
      v_member.id, 'booking', 'system', v_class.id, v_booking_id
    );
  else
    v_status := 'waitlisted';
    select coalesce(max(waitlist_position), 0) + 1 into v_next_pos
    from class_bookings
    where class_id = v_class.id and booking_status = 'waitlisted' and is_active = true;

    insert into class_bookings (
      class_id, member_id, studio_id, booking_status, waitlist_position, is_active
    )
    values (v_class.id, v_member.id, v_studio_id, 'waitlisted', v_next_pos, true)
    returning id into v_booking_id;
  end if;

  insert into booking_events (
    class_id, member_id, booking_id, studio_id, event_type, event_label
  )
  values (
    v_class.id, v_member.id, v_booking_id, v_studio_id, v_status,
    case v_status
      when 'booked' then 'Booked into class'
      when 'waitlisted' then 'Added to waitlist #' || v_next_pos
    end
  );

  return jsonb_build_object('status', v_status, 'booking_id', v_booking_id);
end;
$function$;

-- sf_cancel_booking — slug-based, takes p_studio_id. Filters both class
-- and member lookups by studio_id. booking_events insert carries
-- studio_id.
create or replace function sf_cancel_booking(
  p_class_slug  text,
  p_member_slug text,
  p_studio_id   uuid default null
) returns jsonb language plpgsql as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_result text;
  v_promoted integer := 0;
  v_cutoff timestamptz;
  v_refunded boolean := false;
begin
  if v_studio_id is null then
    return jsonb_build_object('error', 'no_studio_context');
  end if;

  select id into v_member from members
  where slug = p_member_slug and studio_id = v_studio_id;
  if v_member is null then
    return jsonb_build_object('error', 'Member not found');
  end if;

  select id, capacity, starts_at, ends_at, cancellation_window_hours into v_class
  from classes where slug = p_class_slug and studio_id = v_studio_id for update;
  if v_class is null then
    return jsonb_build_object('error', 'Class not found');
  end if;

  if v_class.ends_at < now() then
    return jsonb_build_object('error', 'Class is completed');
  end if;
  if v_class.starts_at <= now() and v_class.ends_at >= now() then
    return jsonb_build_object('error', 'Class is currently live');
  end if;

  select id, booking_status, waitlist_position, promotion_source into v_booking
  from class_bookings
  where class_id = v_class.id and member_id = v_member.id and is_active = true;
  if v_booking is null then
    return jsonb_build_object('error', 'No active booking found');
  end if;

  if v_booking.booking_status = 'waitlisted' then
    v_result := 'cancelled';
    update class_bookings set
      is_active = false,
      booking_status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
    where id = v_booking.id;

    insert into booking_events (
      class_id, member_id, booking_id, studio_id, event_type, event_label
    )
    values (
      v_class.id, v_member.id, v_booking.id, v_studio_id, 'cancelled',
      'Removed from waitlist #' || v_booking.waitlist_position
    );

    perform sf_resequence_waitlist(v_class.id);
  else
    v_cutoff := v_class.starts_at - (v_class.cancellation_window_hours || ' hours')::interval;

    if now() < v_cutoff then
      v_result := 'cancelled';
    else
      v_result := 'late_cancel';
    end if;

    update class_bookings set
      is_active = false,
      booking_status = v_result,
      cancelled_at = now(),
      updated_at = now()
    where id = v_booking.id;

    if v_result = 'cancelled' then
      perform sf_refund_credit(
        v_member.id, 'cancel_refund', 'system', v_class.id, v_booking.id
      );
      v_refunded := true;
    end if;

    insert into booking_events (
      class_id, member_id, booking_id, studio_id, event_type, event_label, metadata
    )
    values (
      v_class.id, v_member.id, v_booking.id, v_studio_id, v_result,
      case v_result
        when 'cancelled' then 'Booking cancelled'
        when 'late_cancel' then 'Late cancellation (after cutoff)'
      end,
      jsonb_build_object('refunded', v_refunded)
    );

    v_promoted := sf_auto_promote(v_class.id, v_class.capacity);

    perform sf_resequence_waitlist(v_class.id);
  end if;

  return jsonb_build_object(
    'result', v_result,
    'auto_promoted', v_promoted,
    'refunded', v_refunded
  );
end;
$function$;

-- sf_promote_member — slug-based, takes p_studio_id.
create or replace function sf_promote_member(
  p_class_slug  text,
  p_member_slug text,
  p_studio_id   uuid default null
) returns jsonb language plpgsql as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_promoted integer := 0;
  v_elig jsonb;
begin
  if v_studio_id is null then
    return jsonb_build_object('error', 'no_studio_context');
  end if;

  select id into v_member from members
  where slug = p_member_slug and studio_id = v_studio_id;
  if v_member is null then
    return jsonb_build_object('error', 'Member not found');
  end if;

  select id, capacity, starts_at, ends_at into v_class
  from classes where slug = p_class_slug and studio_id = v_studio_id for update;
  if v_class is null then
    return jsonb_build_object('error', 'Class not found');
  end if;

  select id, waitlist_position into v_booking
  from class_bookings
  where class_id = v_class.id and member_id = v_member.id
    and booking_status = 'waitlisted' and is_active = true;
  if v_booking is null then
    return jsonb_build_object('error', 'No waitlisted booking found');
  end if;

  v_elig := sf_check_eligibility(v_member.id);
  if (v_elig->>'can_book')::boolean = false then
    return jsonb_build_object('error', 'Cannot promote — ' || (v_elig->>'reason'));
  end if;

  update class_bookings set
    booking_status = 'booked',
    promotion_source = 'manual',
    promoted_at = now(),
    waitlist_position = null,
    updated_at = now()
  where id = v_booking.id;

  perform sf_consume_credit(
    v_member.id, 'manual_promotion', 'system', v_class.id, v_booking.id
  );

  insert into booking_events (
    class_id, member_id, booking_id, studio_id, event_type, event_label, metadata
  )
  values (
    v_class.id, v_member.id, v_booking.id, v_studio_id, 'promoted_manual',
    'Promoted from waitlist #' || v_booking.waitlist_position,
    jsonb_build_object('original_position', v_booking.waitlist_position)
  );

  v_promoted := sf_auto_promote(v_class.id, v_class.capacity);

  perform sf_resequence_waitlist(v_class.id);

  return jsonb_build_object('result', 'promoted', 'auto_promoted', v_promoted);
end;
$function$;

-- sf_unpromote_member — slug-based, takes p_studio_id.
create or replace function sf_unpromote_member(
  p_class_slug        text,
  p_member_slug       text,
  p_original_position integer,
  p_studio_id         uuid default null
) returns jsonb language plpgsql as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_auto RECORD;
  v_base_booked integer;
  v_slots_for_auto integer;
  v_auto_count integer;
  v_orig_pos integer;
begin
  if v_studio_id is null then
    return jsonb_build_object('error', 'no_studio_context');
  end if;

  select id into v_member from members
  where slug = p_member_slug and studio_id = v_studio_id;
  if v_member is null then
    return jsonb_build_object('error', 'Member not found');
  end if;

  select id, capacity into v_class from classes
  where slug = p_class_slug and studio_id = v_studio_id for update;
  if v_class is null then
    return jsonb_build_object('error', 'Class not found');
  end if;

  select id into v_booking
  from class_bookings
  where class_id = v_class.id and member_id = v_member.id
    and booking_status = 'booked' and promotion_source = 'manual' and is_active = true;
  if v_booking is null then
    return jsonb_build_object('error', 'No manually-promoted booking found');
  end if;

  update class_bookings set
    booking_status = 'waitlisted',
    promotion_source = null,
    promoted_at = null,
    waitlist_position = p_original_position,
    updated_at = now()
  where id = v_booking.id;

  perform sf_refund_credit(
    v_member.id, 'unpromote_refund', 'system', v_class.id, v_booking.id
  );

  insert into booking_events (
    class_id, member_id, booking_id, studio_id, event_type, event_label, metadata
  )
  values (
    v_class.id, v_member.id, v_booking.id, v_studio_id, 'unpromoted',
    'Promotion reverted (back to waitlist #' || p_original_position || ')',
    jsonb_build_object('original_position', p_original_position)
  );

  select count(*)::integer into v_base_booked
  from class_bookings
  where class_id = v_class.id and is_active = true
    and booking_status = 'booked'
    and (promotion_source is null or promotion_source = 'manual');

  v_slots_for_auto := greatest(0, v_class.capacity - v_base_booked);

  select count(*)::integer into v_auto_count
  from class_bookings
  where class_id = v_class.id and is_active = true
    and booking_status = 'booked' and promotion_source = 'auto';

  if v_auto_count > v_slots_for_auto then
    for v_auto in
      select cb.id, cb.member_id, be.metadata->>'original_position' as orig_pos
      from class_bookings cb
      left join lateral (
        select metadata from booking_events
        where booking_id = cb.id and event_type = 'promoted_auto'
        order by created_at desc limit 1
      ) be on true
      where cb.class_id = v_class.id and cb.is_active = true
        and cb.booking_status = 'booked' and cb.promotion_source = 'auto'
      order by cb.promoted_at desc
      limit (v_auto_count - v_slots_for_auto)
    loop
      v_orig_pos := coalesce(v_auto.orig_pos::integer, 999);
      update class_bookings set
        booking_status = 'waitlisted',
        promotion_source = null,
        promoted_at = null,
        waitlist_position = v_orig_pos,
        updated_at = now()
      where id = v_auto.id;

      perform sf_refund_credit(
        v_auto.member_id, 'unpromote_refund', 'system', v_class.id, v_auto.id
      );
    end loop;
  end if;

  perform sf_auto_promote(v_class.id, v_class.capacity);
  perform sf_resequence_waitlist(v_class.id);

  return jsonb_build_object('result', 'unpromoted');
end;
$function$;

-- sf_check_in — slug-based, takes p_studio_id.
create or replace function sf_check_in(
  p_class_slug  text,
  p_member_slug text,
  p_source      text,
  p_studio_id   uuid default null
) returns jsonb language plpgsql as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
  v_class    RECORD;
  v_member   RECORD;
  v_booking  RECORD;
  v_opens_at timestamptz;
begin
  if v_studio_id is null then
    return jsonb_build_object('error', 'no_studio_context');
  end if;
  if p_source is null or p_source not in ('client', 'operator') then
    return jsonb_build_object(
      'error', 'Invalid source — must be one of: client, operator'
    );
  end if;

  select id into v_member from members
  where slug = p_member_slug and studio_id = v_studio_id;
  if v_member is null then
    return jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  end if;

  select id, starts_at, ends_at, check_in_window_minutes into v_class
  from classes where slug = p_class_slug and studio_id = v_studio_id for update;
  if v_class is null then
    return jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  end if;

  v_opens_at := v_class.starts_at - make_interval(mins => v_class.check_in_window_minutes);

  if now() < v_opens_at then
    return jsonb_build_object(
      'error', 'Check-in is not open yet',
      'status_code', 'too_early',
      'opens_at', v_opens_at
    );
  end if;

  if v_class.ends_at < now() then
    return jsonb_build_object(
      'error', 'Class has ended — check-in is closed',
      'status_code', 'closed'
    );
  end if;

  select id, booking_status into v_booking
  from class_bookings
  where class_id = v_class.id and member_id = v_member.id
    and is_active = true and booking_status in ('booked', 'checked_in');
  if v_booking is null then
    return jsonb_build_object(
      'error', 'No eligible booking — member is not booked into this class',
      'status_code', 'not_booked'
    );
  end if;

  if v_booking.booking_status = 'checked_in' then
    return jsonb_build_object(
      'ok', true,
      'source', p_source,
      'already_checked_in', true,
      'noop', true
    );
  end if;

  update class_bookings set
    booking_status = 'checked_in',
    checked_in_at = now(),
    updated_at = now()
  where id = v_booking.id;

  insert into booking_events (
    class_id, member_id, booking_id, studio_id,
    event_type, event_label, metadata
  )
  values (
    v_class.id, v_member.id, v_booking.id, v_studio_id,
    'checked_in',
    'Checked in (' || p_source || ')',
    jsonb_build_object('source', p_source)
  );

  return jsonb_build_object('ok', true, 'source', p_source);
end;
$function$;

-- sf_finalise_class — slug-based, takes p_studio_id.
create or replace function sf_finalise_class(
  p_class_slug text,
  p_studio_id  uuid default null
) returns jsonb language plpgsql as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
  v_class RECORD;
  v_count integer := 0;
  r RECORD;
begin
  if v_studio_id is null then
    return jsonb_build_object('error', 'no_studio_context');
  end if;

  select id, starts_at, ends_at into v_class
  from classes where slug = p_class_slug and studio_id = v_studio_id for update;
  if v_class is null then
    return jsonb_build_object('error', 'Class not found');
  end if;

  if v_class.ends_at > now() then
    return jsonb_build_object('ok', true, 'swept', 0, 'noop', true);
  end if;

  for r in
    select id, member_id from class_bookings
    where class_id = v_class.id and is_active = true and booking_status = 'booked'
  loop
    update class_bookings set
      booking_status = 'no_show',
      updated_at = now()
    where id = r.id;

    insert into booking_events (
      class_id, member_id, booking_id, studio_id,
      event_type, event_label, metadata
    )
    values (
      v_class.id, r.member_id, r.id, v_studio_id,
      'auto_no_show',
      'Auto marked no-show at class close',
      jsonb_build_object('source', 'auto_close')
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'swept', v_count);
end;
$function$;

-- sf_mark_attendance — slug-based, takes p_studio_id.
create or replace function sf_mark_attendance(
  p_class_slug  text,
  p_member_slug text,
  p_outcome     text,
  p_studio_id   uuid default null
) returns jsonb language plpgsql as $function$
declare
  v_studio_id uuid := coalesce(p_studio_id, current_studio_id());
  v_class    RECORD;
  v_member   RECORD;
  v_booking  RECORD;
  v_is_live  boolean;
  v_is_done  boolean;
begin
  if v_studio_id is null then
    return jsonb_build_object('error', 'no_studio_context');
  end if;
  if p_outcome not in ('checked_in', 'no_show', 'booked') then
    return jsonb_build_object(
      'error',
      'Invalid outcome — must be one of: checked_in, no_show, booked'
    );
  end if;

  select id into v_member from members
  where slug = p_member_slug and studio_id = v_studio_id;
  if v_member is null then
    return jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  end if;

  select id, starts_at, ends_at into v_class
  from classes where slug = p_class_slug and studio_id = v_studio_id for update;
  if v_class is null then
    return jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  end if;

  v_is_done := v_class.ends_at < now();
  v_is_live := v_class.starts_at <= now() and not v_is_done;

  if not v_is_live and not v_is_done then
    return jsonb_build_object(
      'error', 'Class has not started — attendance cannot be marked yet'
    );
  end if;

  if v_is_done and p_outcome = 'booked' then
    return jsonb_build_object(
      'error',
      'Class is completed — cannot revert to booked. Use Mark as checked in or Mark as no-show.'
    );
  end if;

  select id, booking_status into v_booking
  from class_bookings
  where class_id = v_class.id and member_id = v_member.id
    and is_active = true and booking_status in ('booked', 'checked_in', 'no_show');
  if v_booking is null then
    return jsonb_build_object(
      'error', 'No eligible booking found for this member in this class'
    );
  end if;

  if v_booking.booking_status = p_outcome then
    return jsonb_build_object(
      'ok', true,
      'outcome', p_outcome,
      'previous', v_booking.booking_status,
      'noop', true
    );
  end if;

  update class_bookings set
    booking_status = p_outcome,
    updated_at = now()
  where id = v_booking.id;

  insert into booking_events (
    class_id, member_id, booking_id, studio_id,
    event_type, event_label, metadata
  )
  values (
    v_class.id, v_member.id, v_booking.id, v_studio_id,
    case
      when v_is_done and p_outcome = 'checked_in' then 'correction_checked_in'
      when v_is_done and p_outcome = 'no_show'    then 'correction_no_show'
      when p_outcome = 'checked_in' then 'attendance_checked_in'
      when p_outcome = 'no_show'    then 'attendance_no_show'
      when p_outcome = 'booked'     then 'attendance_reverted'
    end,
    case
      when v_is_done and p_outcome = 'checked_in' then 'Marked as checked in (correction)'
      when v_is_done and p_outcome = 'no_show'    then 'Marked as no-show (correction)'
      when p_outcome = 'checked_in' then 'Marked as checked in'
      when p_outcome = 'no_show'    then 'Marked as no-show'
      when p_outcome = 'booked'     then 'Attendance reverted to booked'
    end,
    jsonb_build_object(
      'previous_status', v_booking.booking_status,
      'lifecycle', case when v_is_done then 'completed' else 'live' end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'outcome', p_outcome,
    'previous', v_booking.booking_status
  );
end;
$function$;

-- sf_apply_purchase — id-based caller (member_id), studio_id resolved
-- from the member row. Signature unchanged (no breaking call-site
-- change for applyPurchase.ts). Inserts purchases with studio_id.
create or replace function sf_apply_purchase(
  p_member_id   uuid,
  p_plan_id     text,
  p_plan_type   text,
  p_plan_name   text,
  p_credits     integer,
  p_source      text,
  p_external_id text
) returns jsonb language plpgsql as $function$
declare
  v_studio uuid;
  v_purchase_id     uuid;
  v_new_credits     integer;
  v_normalised_type text;
begin
  select studio_id into v_studio from members where id = p_member_id;
  if v_studio is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'sf_apply_purchase: member not found or has no studio_id'
    );
  end if;

  v_normalised_type := case p_plan_type
    when 'credit_pack' then 'class_pack'
    else p_plan_type
  end;

  begin
    insert into purchases (member_id, studio_id, plan_id, source, external_id)
    values (p_member_id, v_studio, p_plan_id, p_source, p_external_id)
    returning id into v_purchase_id;
  exception when unique_violation then
    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'external_id', p_external_id
    );
  end;

  if v_normalised_type = 'class_pack' then
    update members
      set credits_remaining = coalesce(credits_remaining, 0) + coalesce(p_credits, 0),
          plan_type         = 'class_pack',
          plan_name         = p_plan_name,
          updated_at        = now()
      where id = p_member_id
      returning credits_remaining into v_new_credits;
    return jsonb_build_object(
      'ok', true,
      'already_processed', false,
      'purchase_id', v_purchase_id,
      'plan_type_applied', 'class_pack',
      'credits_remaining', v_new_credits,
      'external_id', p_external_id
    );
  elsif v_normalised_type = 'unlimited' then
    update members
      set plan_type         = 'unlimited',
          plan_name         = p_plan_name,
          credits_remaining = null,
          updated_at        = now()
      where id = p_member_id;
    return jsonb_build_object(
      'ok', true,
      'already_processed', false,
      'purchase_id', v_purchase_id,
      'plan_type_applied', 'unlimited',
      'credits_remaining', null,
      'external_id', p_external_id
    );
  else
    delete from purchases where id = v_purchase_id;
    raise exception 'sf_apply_purchase: unknown plan_type %', p_plan_type;
  end if;
end;
$function$;

-- sf_refund_purchase — id-based caller (purchase_id), studio_id
-- resolved from the purchase row. Signature unchanged. Inserts
-- credit_transactions with studio_id.
create or replace function sf_refund_purchase(p_purchase_id uuid)
returns jsonb language plpgsql as $function$
declare
  v_purchase     RECORD;
  v_plan         RECORD;
  v_balance      integer;
  v_new_balance  integer;
  v_ledger_id    uuid;
begin
  select id, member_id, studio_id, plan_id, source, status,
         price_cents_paid, credits_granted, external_id, created_at
    into v_purchase
    from purchases
    where id = p_purchase_id
    for update;
  if v_purchase is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_found',
      'error', 'Purchase not found: ' || p_purchase_id::text
    );
  end if;

  if v_purchase.status <> 'completed' then
    return jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'status', v_purchase.status,
      'purchase_id', v_purchase.id
    );
  end if;

  select id, type, credits, price_cents into v_plan
    from plans
    where id = v_purchase.plan_id and studio_id = v_purchase.studio_id;
  if v_plan is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'plan_not_found',
      'error', 'Plan not found for purchase: ' || v_purchase.plan_id
    );
  end if;

  if v_plan.type <> 'class_pack' then
    return jsonb_build_object(
      'ok', false,
      'code', 'unsupported_plan_type',
      'plan_type', v_plan.type,
      'error',
        'Refund not supported for plan type: ' || v_plan.type
        || '. v0.16.0 supports class_pack refunds only.'
    );
  end if;

  if v_purchase.credits_granted is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'no_credits_granted_recorded',
      'error',
        'Purchase has no credits_granted recorded — '
        || 'cannot determine refund amount.'
    );
  end if;

  select credits_remaining into v_balance
    from members
    where id = v_purchase.member_id
    for update;
  if v_balance is null or v_balance < v_purchase.credits_granted then
    return jsonb_build_object(
      'ok', false,
      'code', 'insufficient_credits_to_refund',
      'credits_remaining', v_balance,
      'credits_to_refund', v_purchase.credits_granted,
      'error',
        'Member has used some of the credits granted by this '
        || 'purchase already. Cannot refund without going negative.'
    );
  end if;

  update purchases set status = 'refunded' where id = v_purchase.id;

  update members
    set credits_remaining = credits_remaining - v_purchase.credits_granted,
        updated_at = now()
    where id = v_purchase.member_id
    returning credits_remaining into v_new_balance;

  insert into credit_transactions (
    member_id, studio_id, delta, balance_after, reason_code, source, note
  ) values (
    v_purchase.member_id,
    v_purchase.studio_id,
    -v_purchase.credits_granted,
    v_new_balance,
    'purchase_refund',
    'system',
    'Refund of purchase ' || v_purchase.external_id
  ) returning id into v_ledger_id;

  return jsonb_build_object(
    'ok', true,
    'already_refunded', false,
    'purchase_id', v_purchase.id,
    'external_id', v_purchase.external_id,
    'refunded_credits', v_purchase.credits_granted,
    'new_balance', v_new_balance,
    'ledger_id', v_ledger_id
  );
end;
$function$;

-- sf_refresh_qa_fixtures — QA fixtures are always demo-studio scoped.
-- Resolves demo studio id once and stamps it on every insert into
-- class_bookings + booking_events. The QA class/member rows themselves
-- already carry studio_id from the migration's column-add backfill.
create or replace function sf_refresh_qa_fixtures()
returns jsonb language plpgsql as $function$
declare
  v_now      timestamptz := now();
  v_studio   uuid := (select id from studios where slug = 'demo');
  v_qa_class uuid[] := array[
    'd0000000-0000-0000-0000-000000000001'::uuid,
    'd0000000-0000-0000-0000-000000000002'::uuid,
    'd0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid,
    'd0000000-0000-0000-0000-000000000005'::uuid
  ];
  v_alex  uuid := 'c0000000-0000-0000-0000-000000000001';
  v_blake uuid := 'c0000000-0000-0000-0000-000000000002';
  v_casey uuid := 'c0000000-0000-0000-0000-000000000003';
begin
  if v_studio is null then
    raise exception 'sf_refresh_qa_fixtures: demo studio not found';
  end if;

  update classes set
    starts_at = v_now + interval '60 minutes',
    ends_at   = v_now + interval '120 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  where id = 'd0000000-0000-0000-0000-000000000001';

  update classes set
    starts_at = v_now - interval '5 minutes',
    ends_at   = v_now + interval '55 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  where id = 'd0000000-0000-0000-0000-000000000002';

  update classes set
    starts_at = v_now - interval '5 minutes',
    ends_at   = v_now + interval '55 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  where id = 'd0000000-0000-0000-0000-000000000003';

  update classes set
    starts_at = v_now - interval '90 minutes',
    ends_at   = v_now - interval '30 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  where id = 'd0000000-0000-0000-0000-000000000004';

  update classes set
    starts_at = v_now - interval '180 minutes',
    ends_at   = v_now - interval '120 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  where id = 'd0000000-0000-0000-0000-000000000005';

  delete from booking_events where class_id = any(v_qa_class);
  delete from class_bookings where class_id = any(v_qa_class);

  insert into class_bookings (class_id, member_id, studio_id, booking_status, is_active) values
    ('d0000000-0000-0000-0000-000000000001', v_alex,  v_studio, 'booked', true),
    ('d0000000-0000-0000-0000-000000000001', v_blake, v_studio, 'booked', true);

  insert into class_bookings (class_id, member_id, studio_id, booking_status, is_active) values
    ('d0000000-0000-0000-0000-000000000002', v_alex,  v_studio, 'booked', true),
    ('d0000000-0000-0000-0000-000000000002', v_blake, v_studio, 'booked', true),
    ('d0000000-0000-0000-0000-000000000002', v_casey, v_studio, 'booked', true);

  insert into class_bookings (
    class_id, member_id, studio_id, booking_status, checked_in_at, is_active
  ) values
    ('d0000000-0000-0000-0000-000000000003', v_alex,  v_studio, 'checked_in', v_now, true),
    ('d0000000-0000-0000-0000-000000000003', v_blake, v_studio, 'booked', null, true);

  insert into booking_events (
    class_id, member_id, booking_id, studio_id, event_type, event_label, metadata
  )
  select
    cb.class_id, cb.member_id, cb.id, v_studio,
    'checked_in',
    'Checked in (qa_fixture)',
    jsonb_build_object('source', 'qa_fixture')
  from class_bookings cb
  where cb.class_id = 'd0000000-0000-0000-0000-000000000003'
    and cb.booking_status = 'checked_in';

  insert into class_bookings (
    class_id, member_id, studio_id, booking_status, checked_in_at, is_active
  ) values
    ('d0000000-0000-0000-0000-000000000004', v_alex,
     v_studio, 'checked_in', v_now - interval '75 minutes', true),
    ('d0000000-0000-0000-0000-000000000004', v_blake,
     v_studio, 'no_show', null, true);

  insert into class_bookings (
    class_id, member_id, studio_id, booking_status, checked_in_at, is_active
  ) values
    ('d0000000-0000-0000-0000-000000000005', v_alex,
     v_studio, 'checked_in', v_now - interval '165 minutes', true),
    ('d0000000-0000-0000-0000-000000000005', v_blake,
     v_studio, 'no_show', null, true),
    ('d0000000-0000-0000-0000-000000000005', v_casey,
     v_studio, 'checked_in', v_now - interval '165 minutes', true);

  return jsonb_build_object(
    'ok', true,
    'refreshed_at', v_now,
    'fixtures', jsonb_build_array(
      'qa-too-early', 'qa-open', 'qa-already-in', 'qa-closed', 'qa-correction'
    )
  );
end;
$function$;

-- ═══ 6. Sanity checks ══════════════════════════════════════════════════
-- Visible in the Supabase SQL Editor output when this script is run
-- manually. Expected post-migration:
--   studios row count            = 1
--   members with null studio_id  = 0
--   staff   with null studio_id  = 0
--   classes with null studio_id  = 0
select 'studios row count'          as check_name, count(*)::bigint as value from studios
union all
select 'members with null studio_id',  count(*) from members  where studio_id is null
union all
select 'staff with null studio_id',    count(*) from staff    where studio_id is null
union all
select 'classes with null studio_id',  count(*) from classes  where studio_id is null;

commit;
