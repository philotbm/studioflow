-- StudioFlow v0.22.0 — Economic Engine + Check-In Truth + Multi-tenancy (canonical)
--
-- This file is the CURRENT STATE of all StudioFlow PL/pgSQL — run it in
-- the Supabase SQL Editor after schema.sql when setting up a fresh
-- project. For incremental deploys the per-version migrations live in
-- supabase/v0.X.Y_migration.sql. v0.22.0 (M3 multi-tenancy) is the
-- most recent — it added studio_id to every tenant-scoped table and
-- added the current_studio_id() helper, then rewrote every slug-based
-- RPC to filter by it. See docs/adr/0001-multi-tenancy.md and
-- docs/specs/M3_multi_tenancy.md for the rationale.
-- Every function is CREATE OR REPLACE and the credit_transactions
-- table / v_members_with_access view are idempotent so re-runs are safe.
--
-- v0.8.0 introduced:
--   - credit_transactions table (append-only financial ledger)
--   - v_members_with_access view (DB is the only eligibility truth)
--   - sf_adjust_credit (atomic manual operator adjustment)
--   - sf_check_eligibility returns status_code alongside reason/hint
--   - sf_consume_credit / sf_refund_credit ledger-aware
--   - sf_book_member / sf_cancel_booking / sf_auto_promote /
--     sf_promote_member / sf_unpromote_member thread ledger context
--
-- v0.8.2 added:
--   - sf_mark_attendance (first-pass attendance transitions)
--
-- v0.8.3 replaced the attendance model with check-in as truth:
--   - class_bookings.booking_status now allows 'checked_in'
--   - sf_check_in — positive attendance truth input (client/QR/operator)
--   - sf_finalise_class — idempotent close sweep booked → no_show
--   - sf_mark_attendance — correction path (checked_in ↔ no_show),
--     'booked' revert live-only, 'attended' outcome removed
--
-- v0.8.4 hardened check-in for live operational use:
--   - classes.check_in_window_minutes (default 15) defines the allowed
--     window: (starts_at - window) ... ends_at.
--   - sf_check_in gates on that window (too_early + closed status codes)
--     and is now idempotent on duplicate calls — repeat scans return
--     { ok: true, already_checked_in: true, noop: true } and write NO
--     additional audit row or state change.
--   - class_bookings.booking_status constraint drops legacy 'attended'.
--     All rows were normalised in v0.8.3; v0.8.4 locks the vocabulary
--     so the app speaks one attendance language end to end.
--
-- v0.8.4.1 added deterministic QA fixtures:
--   - sf_refresh_qa_fixtures — idempotent RPC that snaps a fixed set of
--     qa-* classes back to their intended state relative to now().
--     Production data is untouched; this lives purely to give live QA a
--     stable too-early / open / already-in / closed / correction matrix.
--
-- v0.22.0 (M3) added multi-tenancy:
--   - current_studio_id() helper — derives caller's studio_id from
--     staff (preferred) or members. Anonymous → NULL.
--   - Every slug-based RPC gains p_studio_id uuid default null and
--     filters by `(slug, studio_id)`. Id-based RPCs resolve studio_id
--     from the row referenced by the id parameter. Internal helpers
--     resolve studio_id at the insert site from the parent row.
--   - credit_transactions / booking_events / class_bookings /
--     purchases / plans / classes / staff / members all carry
--     studio_id uuid not null references studios(id).

-- ═══ WAITLIST PERFORMANCE INDEX ═════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_waitlist_position
  ON class_bookings (class_id, waitlist_position)
  WHERE booking_status = 'waitlisted' AND is_active = true;

-- ═══ HELPER: count active booked (non-waitlisted) entries ═══════════════
CREATE OR REPLACE FUNCTION sf_count_booked(p_class_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer
  FROM class_bookings
  WHERE class_id = p_class_id
    AND is_active = true
    AND booking_status NOT IN ('waitlisted', 'cancelled', 'late_cancel');
$$;

-- ═══ HELPER: resequence waitlist positions ══════════════════════════════
CREATE OR REPLACE FUNCTION sf_resequence_waitlist(p_class_id uuid)
RETURNS void LANGUAGE sql AS $$
  WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC) AS new_pos
    FROM class_bookings
    WHERE class_id = p_class_id
      AND booking_status = 'waitlisted'
      AND is_active = true
  )
  UPDATE class_bookings cb
  SET waitlist_position = n.new_pos, updated_at = now()
  FROM numbered n
  WHERE cb.id = n.id AND cb.waitlist_position IS DISTINCT FROM n.new_pos;
$$;

-- ═══ CREDIT_TRANSACTIONS — append-only financial truth ═════════════════
-- v0.22.0: studio_id added (M3 multi-tenancy). New rows must carry it;
-- the scopedQuery proxy injects it on the application side, and every
-- PL/pgSQL function in this file resolves it from the parent row.
CREATE TABLE IF NOT EXISTS credit_transactions (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members(id) on delete cascade,
  studio_id      uuid not null references studios(id),
  delta          integer not null,
  balance_after  integer not null,
  reason_code    text not null,
  source         text not null check (source in ('system','operator')),
  note           text,
  class_id       uuid references classes(id) on delete set null,
  booking_id     uuid references class_bookings(id) on delete set null,
  operator_key   text,
  created_at     timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_member
  ON credit_transactions(member_id, created_at DESC);

-- Ensure permissive access (project has no auth layer; RLS disabled elsewhere)
ALTER TABLE credit_transactions DISABLE ROW LEVEL SECURITY;

-- ═══ current_studio_id() — v0.22.0 (M3 multi-tenancy) ══════════════════
-- ADR Decision 2. STABLE for per-transaction caching. SECURITY DEFINER
-- so it can read staff/members regardless of caller RLS (safe today —
-- RLS is off on data tables, on-with-self-read on staff). search_path
-- locked to public.
--
-- Resolution: staff_studio_id first (operator session implies operator
-- view), then members_studio_id, then NULL (anonymous).
CREATE OR REPLACE FUNCTION current_studio_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT studio_id FROM staff   WHERE user_id = auth.uid() LIMIT 1),
    (SELECT studio_id FROM members WHERE user_id = auth.uid() LIMIT 1)
  );
$$;

-- ═══ sf_check_eligibility — v0.9.4.1 Booking Truth Simplification ═════
-- Booking truth for this phase is entitlement only:
--   unlimited plan                 → can book
--   positive credits (pack/trial)  → can book
--   otherwise                      → cannot book
-- Account status is NOT a StudioFlow product concept at this phase and
-- is not read here at all. If a lifecycle feature ships later it will
-- be a deliberate design, not an accidental leak from the members.status
-- column.
CREATE OR REPLACE FUNCTION sf_check_eligibility(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_member RECORD;
BEGIN
  SELECT id, plan_type, plan_name, credits_remaining
  INTO v_member FROM members WHERE id = p_member_id;

  IF v_member IS NULL THEN
    RETURN jsonb_build_object(
      'can_book', false,
      'reason', 'Member not found',
      'entitlement_label', 'Unknown',
      'credits_remaining', NULL,
      'action_hint', 'Member record missing',
      'status_code', 'not_found'
    );
  END IF;

  -- Unlimited
  IF v_member.plan_type = 'unlimited' THEN
    RETURN jsonb_build_object(
      'can_book', true,
      'reason', 'Unlimited access',
      'entitlement_label', 'Unlimited',
      'credits_remaining', NULL,
      'action_hint', 'Member can book any class',
      'status_code', 'ok'
    );
  END IF;

  -- Class pack
  IF v_member.plan_type = 'class_pack' THEN
    IF COALESCE(v_member.credits_remaining, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'can_book', false,
        'reason', 'No credits remaining',
        'entitlement_label', v_member.plan_name || ' (0 left)',
        'credits_remaining', 0,
        'action_hint', 'Sell a new class pack or adjust credits manually',
        'status_code', 'no_credits'
      );
    END IF;
    RETURN jsonb_build_object(
      'can_book', true,
      'reason', CASE WHEN v_member.credits_remaining = 1
                     THEN '1 credit remaining — last class on this pack'
                     ELSE v_member.credits_remaining || ' credits remaining' END,
      'entitlement_label', 'Class pack (' || v_member.credits_remaining || ' left)',
      'credits_remaining', v_member.credits_remaining,
      'action_hint', CASE WHEN v_member.credits_remaining = 1
                          THEN 'Offer a renewal after this booking'
                          ELSE 'Member can book a class' END,
      'status_code', 'ok'
    );
  END IF;

  -- Trial
  IF v_member.plan_type = 'trial' THEN
    IF COALESCE(v_member.credits_remaining, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'can_book', false,
        'reason', 'Trial used up',
        'entitlement_label', 'Trial (0 left)',
        'credits_remaining', 0,
        'action_hint', 'Convert trial to a full plan to book again',
        'status_code', 'trial_used'
      );
    END IF;
    RETURN jsonb_build_object(
      'can_book', true,
      'reason', 'Trial entitlement active',
      'entitlement_label', 'Trial (' || v_member.credits_remaining || ' left)',
      'credits_remaining', v_member.credits_remaining,
      'action_hint', 'Follow up after class to convert',
      'status_code', 'ok'
    );
  END IF;

  -- Drop-in / unknown
  RETURN jsonb_build_object(
    'can_book', false,
    'reason', 'No active entitlement',
    'entitlement_label', 'Drop-in',
    'credits_remaining', v_member.credits_remaining,
    'action_hint', 'Member needs a plan or credit pack before booking',
    'status_code', 'no_entitlement'
  );
END;
$$;

-- ═══ v_members_with_access — read view for server-derived access state ═
-- PostgREST exposes this as if it were a table. The client queries it in
-- place of `members` and unpacks the `access` column. This makes the
-- database the ONLY place booking-access business rules live — the
-- TypeScript client no longer re-implements any of them.
CREATE OR REPLACE VIEW v_members_with_access AS
SELECT
  m.*,
  sf_check_eligibility(m.id) AS access
FROM members m;

-- ═══ sf_consume_credit — v0.8.0 update, v0.22.0 studio_id awareness ═══
-- v0.22.0 (M3): signature unchanged. Resolves studio_id from the member
-- row at the insert site so credit_transactions carries it. Internal
-- helper — callers pass member_id, which already encodes studio identity.
CREATE OR REPLACE FUNCTION sf_consume_credit(
  p_member_id    uuid,
  p_reason_code  text,
  p_source       text DEFAULT 'system',
  p_class_id     uuid DEFAULT NULL,
  p_booking_id   uuid DEFAULT NULL,
  p_note         text DEFAULT NULL,
  p_operator_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_plan text;
  v_studio uuid;
  v_bal_after integer;
  v_ledger_id uuid;
BEGIN
  SELECT plan_type, studio_id INTO v_plan, v_studio
  FROM members WHERE id = p_member_id FOR UPDATE;

  IF v_plan IN ('class_pack','trial') THEN
    UPDATE members
    SET credits_remaining = GREATEST(COALESCE(credits_remaining, 0) - 1, 0),
        updated_at = now()
    WHERE id = p_member_id
    RETURNING credits_remaining INTO v_bal_after;

    INSERT INTO credit_transactions (
      member_id, studio_id, delta, balance_after, reason_code, source,
      class_id, booking_id, note, operator_key
    )
    VALUES (
      p_member_id, v_studio, -1, v_bal_after, p_reason_code, p_source,
      p_class_id, p_booking_id, p_note, p_operator_key
    )
    RETURNING id INTO v_ledger_id;

    RETURN jsonb_build_object(
      'consumed', true,
      'balance_after', v_bal_after,
      'ledger_id', v_ledger_id
    );
  END IF;
  RETURN jsonb_build_object('consumed', false);
END;
$$;

-- ═══ sf_refund_credit — v0.8.0 update, v0.22.0 studio_id awareness ═══
-- v0.22.0 (M3): signature unchanged. Mirrors sf_consume_credit.
CREATE OR REPLACE FUNCTION sf_refund_credit(
  p_member_id    uuid,
  p_reason_code  text,
  p_source       text DEFAULT 'system',
  p_class_id     uuid DEFAULT NULL,
  p_booking_id   uuid DEFAULT NULL,
  p_note         text DEFAULT NULL,
  p_operator_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_plan text;
  v_studio uuid;
  v_bal_after integer;
  v_ledger_id uuid;
BEGIN
  SELECT plan_type, studio_id INTO v_plan, v_studio
  FROM members WHERE id = p_member_id FOR UPDATE;

  IF v_plan IN ('class_pack','trial') THEN
    UPDATE members
    SET credits_remaining = COALESCE(credits_remaining, 0) + 1,
        updated_at = now()
    WHERE id = p_member_id
    RETURNING credits_remaining INTO v_bal_after;

    INSERT INTO credit_transactions (
      member_id, studio_id, delta, balance_after, reason_code, source,
      class_id, booking_id, note, operator_key
    )
    VALUES (
      p_member_id, v_studio, 1, v_bal_after, p_reason_code, p_source,
      p_class_id, p_booking_id, p_note, p_operator_key
    )
    RETURNING id INTO v_ledger_id;

    RETURN jsonb_build_object(
      'refunded', true,
      'balance_after', v_bal_after,
      'ledger_id', v_ledger_id
    );
  END IF;
  RETURN jsonb_build_object('refunded', false);
END;
$$;

-- ═══ sf_adjust_credit — v0.8.0, v0.22.0 studio_id awareness ══════════
-- v0.22.0 (M3): adds p_studio_id (defaults to current_studio_id()).
-- Member lookup filters by (slug, studio_id). credit_transactions
-- insert carries studio_id.
CREATE OR REPLACE FUNCTION sf_adjust_credit(
  p_member_slug  text,
  p_delta        integer,
  p_reason_code  text,
  p_note         text DEFAULT NULL,
  p_operator_key text DEFAULT NULL,
  p_studio_id    uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio_id uuid := COALESCE(p_studio_id, current_studio_id());
  v_member RECORD;
  v_bal_after integer;
  v_ledger_id uuid;
  v_allowed text[] := ARRAY[
    'bereavement', 'medical', 'studio_error',
    'goodwill', 'admin_correction', 'service_recovery'
  ];
BEGIN
  IF v_studio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_studio_context');
  END IF;
  IF p_delta = 0 THEN
    RETURN jsonb_build_object('error', 'Delta must be non-zero');
  END IF;
  IF p_reason_code IS NULL OR NOT (p_reason_code = ANY(v_allowed)) THEN
    RETURN jsonb_build_object(
      'error',
      'Reason code required — one of: ' || array_to_string(v_allowed, ', ')
    );
  END IF;

  SELECT id, plan_type, credits_remaining INTO v_member
  FROM members WHERE slug = p_member_slug AND studio_id = v_studio_id FOR UPDATE;

  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  END IF;

  IF v_member.plan_type = 'unlimited' THEN
    RETURN jsonb_build_object('error', 'Cannot adjust credits on an unlimited plan');
  END IF;
  IF v_member.plan_type = 'drop_in' THEN
    RETURN jsonb_build_object('error', 'Cannot adjust credits on a drop-in member');
  END IF;

  v_bal_after := GREATEST(COALESCE(v_member.credits_remaining, 0) + p_delta, 0);

  UPDATE members
  SET credits_remaining = v_bal_after,
      updated_at = now()
  WHERE id = v_member.id;

  INSERT INTO credit_transactions (
    member_id, studio_id, delta, balance_after, reason_code, source,
    note, operator_key
  )
  VALUES (
    v_member.id, v_studio_id, p_delta, v_bal_after, p_reason_code, 'operator',
    p_note, p_operator_key
  )
  RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'ok', true,
    'balance_after', v_bal_after,
    'ledger_id', v_ledger_id,
    'delta', p_delta,
    'reason_code', p_reason_code
  );
END;
$$;

-- ═══ sf_auto_promote — v0.8.0, v0.22.0 studio_id awareness ═══════════
-- v0.22.0 (M3): signature unchanged. Internal helper called from
-- sf_cancel_booking / sf_promote_member / sf_unpromote_member. Resolves
-- studio_id from the class row for the booking_events insert.
CREATE OR REPLACE FUNCTION sf_auto_promote(p_class_id uuid, p_capacity integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_studio uuid;
  v_booked integer;
  v_next RECORD;
  v_promoted integer := 0;
  v_elig jsonb;
  v_skipped_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT studio_id INTO v_studio FROM classes WHERE id = p_class_id;

  LOOP
    v_booked := sf_count_booked(p_class_id);
    EXIT WHEN v_booked >= p_capacity;

    SELECT id, member_id, waitlist_position INTO v_next
    FROM class_bookings
    WHERE class_id = p_class_id
      AND booking_status = 'waitlisted'
      AND is_active = true
      AND NOT (id = ANY(v_skipped_ids))
    ORDER BY waitlist_position ASC
    LIMIT 1;

    EXIT WHEN v_next IS NULL;

    v_elig := sf_check_eligibility(v_next.member_id);
    IF (v_elig->>'can_book')::boolean = false THEN
      v_skipped_ids := array_append(v_skipped_ids, v_next.id);
      CONTINUE;
    END IF;

    UPDATE class_bookings SET
      booking_status = 'booked',
      promotion_source = 'auto',
      promoted_at = now(),
      waitlist_position = NULL,
      updated_at = now()
    WHERE id = v_next.id;

    -- v0.8.0: ledger-aware consume
    PERFORM sf_consume_credit(
      v_next.member_id, 'auto_promotion', 'system', p_class_id, v_next.id
    );

    INSERT INTO booking_events (
      class_id, member_id, booking_id, studio_id,
      event_type, event_label, metadata
    )
    VALUES (
      p_class_id, v_next.member_id, v_next.id, v_studio,
      'promoted_auto',
      'Auto-promoted from waitlist #' || v_next.waitlist_position,
      jsonb_build_object('original_position', v_next.waitlist_position)
    );

    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN v_promoted;
END;
$$;

-- ═══ sf_book_member — v0.8.0, v0.22.0 studio_id awareness ═══════════
-- v0.22.0 (M3): adds p_studio_id. Both class and member lookups filter
-- by (slug, studio_id). class_bookings + booking_events inserts carry
-- studio_id.
CREATE OR REPLACE FUNCTION sf_book_member(
  p_class_slug  text,
  p_member_slug text,
  p_studio_id   uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio_id uuid := COALESCE(p_studio_id, current_studio_id());
  v_class RECORD;
  v_member RECORD;
  v_existing RECORD;
  v_booked integer;
  v_next_pos integer;
  v_booking_id uuid;
  v_status text;
  v_elig jsonb;
BEGIN
  IF v_studio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_studio_context');
  END IF;

  SELECT id INTO v_member FROM members
  WHERE slug = p_member_slug AND studio_id = v_studio_id;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  END IF;

  v_elig := sf_check_eligibility(v_member.id);
  IF (v_elig->>'can_book')::boolean = false THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', v_elig->>'reason',
      'entitlement_label', v_elig->>'entitlement_label',
      'credits_remaining', v_elig->'credits_remaining',
      'action_hint', v_elig->>'action_hint',
      'status_code', v_elig->>'status_code'
    );
  END IF;

  SELECT id, capacity, starts_at, ends_at INTO v_class
  FROM classes WHERE slug = p_class_slug AND studio_id = v_studio_id FOR UPDATE;
  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  END IF;

  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object('error', 'Class is completed');
  END IF;
  IF v_class.starts_at <= now() AND v_class.ends_at >= now() THEN
    RETURN jsonb_build_object('error', 'Class is currently live');
  END IF;

  SELECT id, booking_status INTO v_existing
  FROM class_bookings
  WHERE class_id = v_class.id AND member_id = v_member.id AND is_active = true;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', v_existing.booking_status,
      'booking_id', v_existing.id,
      'already_exists', true
    );
  END IF;

  v_booked := sf_count_booked(v_class.id);

  IF v_booked < v_class.capacity THEN
    v_status := 'booked';
    INSERT INTO class_bookings (
      class_id, member_id, studio_id, booking_status, booked_at, is_active
    )
    VALUES (v_class.id, v_member.id, v_studio_id, 'booked', now(), true)
    RETURNING id INTO v_booking_id;

    PERFORM sf_consume_credit(
      v_member.id, 'booking', 'system', v_class.id, v_booking_id
    );
  ELSE
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_pos
    FROM class_bookings
    WHERE class_id = v_class.id AND booking_status = 'waitlisted' AND is_active = true;

    INSERT INTO class_bookings (
      class_id, member_id, studio_id, booking_status, waitlist_position, is_active
    )
    VALUES (v_class.id, v_member.id, v_studio_id, 'waitlisted', v_next_pos, true)
    RETURNING id INTO v_booking_id;
  END IF;

  INSERT INTO booking_events (
    class_id, member_id, booking_id, studio_id, event_type, event_label
  )
  VALUES (
    v_class.id, v_member.id, v_booking_id, v_studio_id, v_status,
    CASE v_status
      WHEN 'booked' THEN 'Booked into class'
      WHEN 'waitlisted' THEN 'Added to waitlist #' || v_next_pos
    END
  );

  RETURN jsonb_build_object('status', v_status, 'booking_id', v_booking_id);
END;
$$;

-- ═══ sf_cancel_booking — v0.8.0, v0.22.0 studio_id awareness ═════════
-- v0.22.0 (M3): adds p_studio_id. Lookups + inserts carry studio_id.
CREATE OR REPLACE FUNCTION sf_cancel_booking(
  p_class_slug  text,
  p_member_slug text,
  p_studio_id   uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio_id uuid := COALESCE(p_studio_id, current_studio_id());
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_result text;
  v_promoted integer := 0;
  v_cutoff timestamptz;
  v_refunded boolean := false;
BEGIN
  IF v_studio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_studio_context');
  END IF;

  SELECT id INTO v_member FROM members
  WHERE slug = p_member_slug AND studio_id = v_studio_id;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;

  SELECT id, capacity, starts_at, ends_at, cancellation_window_hours INTO v_class
  FROM classes WHERE slug = p_class_slug AND studio_id = v_studio_id FOR UPDATE;
  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found');
  END IF;

  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object('error', 'Class is completed');
  END IF;
  IF v_class.starts_at <= now() AND v_class.ends_at >= now() THEN
    RETURN jsonb_build_object('error', 'Class is currently live');
  END IF;

  SELECT id, booking_status, waitlist_position, promotion_source INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id AND member_id = v_member.id AND is_active = true;
  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('error', 'No active booking found');
  END IF;

  IF v_booking.booking_status = 'waitlisted' THEN
    v_result := 'cancelled';
    UPDATE class_bookings SET
      is_active = false,
      booking_status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
    WHERE id = v_booking.id;

    INSERT INTO booking_events (
      class_id, member_id, booking_id, studio_id, event_type, event_label
    )
    VALUES (
      v_class.id, v_member.id, v_booking.id, v_studio_id, 'cancelled',
      'Removed from waitlist #' || v_booking.waitlist_position
    );

    PERFORM sf_resequence_waitlist(v_class.id);
  ELSE
    v_cutoff := v_class.starts_at - (v_class.cancellation_window_hours || ' hours')::interval;

    IF now() < v_cutoff THEN
      v_result := 'cancelled';
    ELSE
      v_result := 'late_cancel';
    END IF;

    UPDATE class_bookings SET
      is_active = false,
      booking_status = v_result,
      cancelled_at = now(),
      updated_at = now()
    WHERE id = v_booking.id;

    IF v_result = 'cancelled' THEN
      PERFORM sf_refund_credit(
        v_member.id, 'cancel_refund', 'system', v_class.id, v_booking.id
      );
      v_refunded := true;
    END IF;

    INSERT INTO booking_events (
      class_id, member_id, booking_id, studio_id, event_type, event_label, metadata
    )
    VALUES (
      v_class.id, v_member.id, v_booking.id, v_studio_id, v_result,
      CASE v_result
        WHEN 'cancelled' THEN 'Booking cancelled'
        WHEN 'late_cancel' THEN 'Late cancellation (after cutoff)'
      END,
      jsonb_build_object('refunded', v_refunded)
    );

    v_promoted := sf_auto_promote(v_class.id, v_class.capacity);

    PERFORM sf_resequence_waitlist(v_class.id);
  END IF;

  RETURN jsonb_build_object(
    'result', v_result,
    'auto_promoted', v_promoted,
    'refunded', v_refunded
  );
END;
$$;

-- ═══ sf_promote_member — v0.8.0, v0.22.0 studio_id awareness ═════════
CREATE OR REPLACE FUNCTION sf_promote_member(
  p_class_slug  text,
  p_member_slug text,
  p_studio_id   uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio_id uuid := COALESCE(p_studio_id, current_studio_id());
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_promoted integer := 0;
  v_elig jsonb;
BEGIN
  IF v_studio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_studio_context');
  END IF;

  SELECT id INTO v_member FROM members
  WHERE slug = p_member_slug AND studio_id = v_studio_id;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;

  SELECT id, capacity, starts_at, ends_at INTO v_class
  FROM classes WHERE slug = p_class_slug AND studio_id = v_studio_id FOR UPDATE;
  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found');
  END IF;

  SELECT id, waitlist_position INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id AND member_id = v_member.id
    AND booking_status = 'waitlisted' AND is_active = true;
  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('error', 'No waitlisted booking found');
  END IF;

  v_elig := sf_check_eligibility(v_member.id);
  IF (v_elig->>'can_book')::boolean = false THEN
    RETURN jsonb_build_object('error', 'Cannot promote — ' || (v_elig->>'reason'));
  END IF;

  UPDATE class_bookings SET
    booking_status = 'booked',
    promotion_source = 'manual',
    promoted_at = now(),
    waitlist_position = NULL,
    updated_at = now()
  WHERE id = v_booking.id;

  PERFORM sf_consume_credit(
    v_member.id, 'manual_promotion', 'system', v_class.id, v_booking.id
  );

  INSERT INTO booking_events (
    class_id, member_id, booking_id, studio_id, event_type, event_label, metadata
  )
  VALUES (
    v_class.id, v_member.id, v_booking.id, v_studio_id, 'promoted_manual',
    'Promoted from waitlist #' || v_booking.waitlist_position,
    jsonb_build_object('original_position', v_booking.waitlist_position)
  );

  v_promoted := sf_auto_promote(v_class.id, v_class.capacity);

  PERFORM sf_resequence_waitlist(v_class.id);

  RETURN jsonb_build_object('result', 'promoted', 'auto_promoted', v_promoted);
END;
$$;

-- ═══ sf_unpromote_member — v0.8.0, v0.22.0 studio_id awareness ════════
CREATE OR REPLACE FUNCTION sf_unpromote_member(
  p_class_slug        text,
  p_member_slug       text,
  p_original_position integer,
  p_studio_id         uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio_id uuid := COALESCE(p_studio_id, current_studio_id());
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_auto RECORD;
  v_base_booked integer;
  v_slots_for_auto integer;
  v_auto_count integer;
  v_orig_pos integer;
BEGIN
  IF v_studio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_studio_context');
  END IF;

  SELECT id INTO v_member FROM members
  WHERE slug = p_member_slug AND studio_id = v_studio_id;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;

  SELECT id, capacity INTO v_class FROM classes
  WHERE slug = p_class_slug AND studio_id = v_studio_id FOR UPDATE;
  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found');
  END IF;

  SELECT id INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id AND member_id = v_member.id
    AND booking_status = 'booked' AND promotion_source = 'manual' AND is_active = true;
  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('error', 'No manually-promoted booking found');
  END IF;

  UPDATE class_bookings SET
    booking_status = 'waitlisted',
    promotion_source = NULL,
    promoted_at = NULL,
    waitlist_position = p_original_position,
    updated_at = now()
  WHERE id = v_booking.id;

  PERFORM sf_refund_credit(
    v_member.id, 'unpromote_refund', 'system', v_class.id, v_booking.id
  );

  INSERT INTO booking_events (
    class_id, member_id, booking_id, studio_id, event_type, event_label, metadata
  )
  VALUES (
    v_class.id, v_member.id, v_booking.id, v_studio_id, 'unpromoted',
    'Promotion reverted (back to waitlist #' || p_original_position || ')',
    jsonb_build_object('original_position', p_original_position)
  );

  SELECT count(*)::integer INTO v_base_booked
  FROM class_bookings
  WHERE class_id = v_class.id AND is_active = true
    AND booking_status = 'booked'
    AND (promotion_source IS NULL OR promotion_source = 'manual');

  v_slots_for_auto := GREATEST(0, v_class.capacity - v_base_booked);

  SELECT count(*)::integer INTO v_auto_count
  FROM class_bookings
  WHERE class_id = v_class.id AND is_active = true
    AND booking_status = 'booked' AND promotion_source = 'auto';

  IF v_auto_count > v_slots_for_auto THEN
    FOR v_auto IN
      SELECT cb.id, cb.member_id, be.metadata->>'original_position' AS orig_pos
      FROM class_bookings cb
      LEFT JOIN LATERAL (
        SELECT metadata FROM booking_events
        WHERE booking_id = cb.id AND event_type = 'promoted_auto'
        ORDER BY created_at DESC LIMIT 1
      ) be ON true
      WHERE cb.class_id = v_class.id AND cb.is_active = true
        AND cb.booking_status = 'booked' AND cb.promotion_source = 'auto'
      ORDER BY cb.promoted_at DESC
      LIMIT (v_auto_count - v_slots_for_auto)
    LOOP
      v_orig_pos := COALESCE(v_auto.orig_pos::integer, 999);
      UPDATE class_bookings SET
        booking_status = 'waitlisted',
        promotion_source = NULL,
        promoted_at = NULL,
        waitlist_position = v_orig_pos,
        updated_at = now()
      WHERE id = v_auto.id;

      -- v0.8.0: ledger-aware refund for each displaced auto-promotion
      PERFORM sf_refund_credit(
        v_auto.member_id, 'unpromote_refund', 'system', v_class.id, v_auto.id
      );
    END LOOP;
  END IF;

  PERFORM sf_auto_promote(v_class.id, v_class.capacity);
  PERFORM sf_resequence_waitlist(v_class.id);

  RETURN jsonb_build_object('result', 'unpromoted');
END;
$$;

-- ═══ 3. sf_check_in (v0.8.4) ═══════════════════════════════════════════
-- Positive attendance truth input. One of the three input channels
-- (client app page, QR-scanned URL, instructor fallback) calls this.
-- Source is recorded in booking_events metadata for audit.
--
-- Rules (v0.8.4):
--   - Check-in window is (starts_at - check_in_window_minutes) ... ends_at.
--     Default window is 15 min. Pre-window returns status_code='too_early'
--     with opens_at. Post-window returns status_code='closed'.
--   - Active booking must exist and currently be 'booked' or 'checked_in'.
--     Waitlisted, cancelled, late_cancel, and "not booked at all" all
--     resolve to the same status_code='not_booked' error.
--   - Idempotent: repeat calls for an already-checked-in booking return
--     { ok:true, already_checked_in:true, noop:true } and write NO
--     additional audit row, so repeat QR scans cannot flood the ledger.
--   - Source must be one of 'client', 'operator'. Future releases can
--     extend this set.
--
-- Return: success with { ok:true, source } or { ok:true, already_checked_in:true, noop:true },
-- or { error:"...", status_code } on a gated rejection.
CREATE OR REPLACE FUNCTION sf_check_in(
  p_class_slug  text,
  p_member_slug text,
  p_source      text,
  p_studio_id   uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio_id uuid := COALESCE(p_studio_id, current_studio_id());
  v_class    RECORD;
  v_member   RECORD;
  v_booking  RECORD;
  v_opens_at timestamptz;
BEGIN
  IF v_studio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_studio_context');
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('client', 'operator') THEN
    RETURN jsonb_build_object(
      'error', 'Invalid source — must be one of: client, operator'
    );
  END IF;

  SELECT id INTO v_member FROM members
  WHERE slug = p_member_slug AND studio_id = v_studio_id;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  END IF;

  SELECT id, starts_at, ends_at, check_in_window_minutes INTO v_class
  FROM classes WHERE slug = p_class_slug AND studio_id = v_studio_id FOR UPDATE;
  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  END IF;

  v_opens_at := v_class.starts_at - make_interval(mins => v_class.check_in_window_minutes);

  IF now() < v_opens_at THEN
    RETURN jsonb_build_object(
      'error', 'Check-in is not open yet',
      'status_code', 'too_early',
      'opens_at', v_opens_at
    );
  END IF;

  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object(
      'error', 'Class has ended — check-in is closed',
      'status_code', 'closed'
    );
  END IF;

  SELECT id, booking_status INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id
    AND member_id = v_member.id
    AND is_active = true
    AND booking_status IN ('booked', 'checked_in');

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'No eligible booking — member is not booked into this class',
      'status_code', 'not_booked'
    );
  END IF;

  -- v0.8.4 idempotency: repeat check-in is a clean no-op. No state flip,
  -- no duplicate booking_events row.
  IF v_booking.booking_status = 'checked_in' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'source', p_source,
      'already_checked_in', true,
      'noop', true
    );
  END IF;

  UPDATE class_bookings SET
    booking_status = 'checked_in',
    checked_in_at = now(),
    updated_at = now()
  WHERE id = v_booking.id;

  INSERT INTO booking_events (
    class_id, member_id, booking_id, studio_id,
    event_type, event_label, metadata
  )
  VALUES (
    v_class.id, v_member.id, v_booking.id, v_studio_id,
    'checked_in',
    'Checked in (' || p_source || ')',
    jsonb_build_object('source', p_source)
  );

  RETURN jsonb_build_object('ok', true, 'source', p_source);
END;
$$;

-- ═══ 4. sf_finalise_class ══════════════════════════════════════════════
-- Idempotent sweep: on a completed class, every active booking with
-- booking_status='booked' transitions to 'no_show' and gets a
-- booking_events audit row. Already-checked-in rows are left alone.
--
-- Returns { ok: true, swept: N } — N = number of rows transitioned.
-- noop when the class is not yet completed or there is nothing to sweep.
CREATE OR REPLACE FUNCTION sf_finalise_class(
  p_class_slug text,
  p_studio_id  uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio_id uuid := COALESCE(p_studio_id, current_studio_id());
  v_class RECORD;
  v_count integer := 0;
  r RECORD;
BEGIN
  IF v_studio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_studio_context');
  END IF;

  SELECT id, starts_at, ends_at INTO v_class
  FROM classes WHERE slug = p_class_slug AND studio_id = v_studio_id FOR UPDATE;
  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found');
  END IF;

  -- Only sweep completed classes. Live / upcoming classes are a no-op.
  IF v_class.ends_at > now() THEN
    RETURN jsonb_build_object('ok', true, 'swept', 0, 'noop', true);
  END IF;

  FOR r IN
    SELECT id, member_id
    FROM class_bookings
    WHERE class_id = v_class.id
      AND is_active = true
      AND booking_status = 'booked'
  LOOP
    UPDATE class_bookings SET
      booking_status = 'no_show',
      updated_at = now()
    WHERE id = r.id;

    INSERT INTO booking_events (
      class_id, member_id, booking_id, studio_id,
      event_type, event_label, metadata
    )
    VALUES (
      v_class.id, r.member_id, r.id, v_studio_id,
      'auto_no_show',
      'Auto marked no-show at class close',
      jsonb_build_object('source', 'auto_close')
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'swept', v_count);
END;
$$;

-- ═══ 5. sf_mark_attendance — v0.8.3 update ═════════════════════════════
-- This now serves the correction path (post-close mistake correction)
-- and the live-class instructor fallback. Outcomes:
--
--   'checked_in' — mark as checked in
--                  allowed on LIVE (instructor fallback) and COMPLETED
--                  (post-close correction).
--   'no_show'    — mark as no-show
--                  allowed on LIVE (rare, e.g. correcting an erroneous
--                  check-in during class) and COMPLETED (post-close
--                  correction).
--   'booked'     — revert a mistake back to the booked baseline.
--                  LIVE ONLY. A completed class cannot be reverted to
--                  the limbo "booked" state via this RPC — that would
--                  undo finalisation and is deliberately blocked.
--
-- Upcoming classes are always rejected. 'attended' is rejected at the
-- input-validation step — it is no longer an accepted outcome.
CREATE OR REPLACE FUNCTION sf_mark_attendance(
  p_class_slug  text,
  p_member_slug text,
  p_outcome     text,
  p_studio_id   uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio_id uuid := COALESCE(p_studio_id, current_studio_id());
  v_class    RECORD;
  v_member   RECORD;
  v_booking  RECORD;
  v_is_live  boolean;
  v_is_done  boolean;
BEGIN
  IF v_studio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_studio_context');
  END IF;
  IF p_outcome NOT IN ('checked_in', 'no_show', 'booked') THEN
    RETURN jsonb_build_object(
      'error',
      'Invalid outcome — must be one of: checked_in, no_show, booked'
    );
  END IF;

  SELECT id INTO v_member FROM members
  WHERE slug = p_member_slug AND studio_id = v_studio_id;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  END IF;

  SELECT id, starts_at, ends_at INTO v_class
  FROM classes WHERE slug = p_class_slug AND studio_id = v_studio_id FOR UPDATE;
  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  END IF;

  v_is_done := v_class.ends_at < now();
  v_is_live := v_class.starts_at <= now() AND NOT v_is_done;

  IF NOT v_is_live AND NOT v_is_done THEN
    RETURN jsonb_build_object(
      'error', 'Class has not started — attendance cannot be marked yet'
    );
  END IF;

  -- 'booked' (revert) is live-only; completed classes are finalised.
  IF v_is_done AND p_outcome = 'booked' THEN
    RETURN jsonb_build_object(
      'error',
      'Class is completed — cannot revert to booked. Use Mark as checked in or Mark as no-show.'
    );
  END IF;

  -- Eligible booking: active AND one of the attendance-bearing states.
  SELECT id, booking_status INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id
    AND member_id = v_member.id
    AND is_active = true
    AND booking_status IN ('booked', 'checked_in', 'no_show');

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'No eligible booking found for this member in this class'
    );
  END IF;

  -- Idempotent no-op.
  IF v_booking.booking_status = p_outcome THEN
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', p_outcome,
      'previous', v_booking.booking_status,
      'noop', true
    );
  END IF;

  UPDATE class_bookings SET
    booking_status = p_outcome,
    updated_at = now()
  WHERE id = v_booking.id;

  INSERT INTO booking_events (
    class_id, member_id, booking_id, studio_id,
    event_type, event_label, metadata
  )
  VALUES (
    v_class.id, v_member.id, v_booking.id, v_studio_id,
    CASE
      WHEN v_is_done AND p_outcome = 'checked_in' THEN 'correction_checked_in'
      WHEN v_is_done AND p_outcome = 'no_show'    THEN 'correction_no_show'
      WHEN p_outcome = 'checked_in' THEN 'attendance_checked_in'
      WHEN p_outcome = 'no_show'    THEN 'attendance_no_show'
      WHEN p_outcome = 'booked'     THEN 'attendance_reverted'
    END,
    CASE
      WHEN v_is_done AND p_outcome = 'checked_in' THEN 'Marked as checked in (correction)'
      WHEN v_is_done AND p_outcome = 'no_show'    THEN 'Marked as no-show (correction)'
      WHEN p_outcome = 'checked_in' THEN 'Marked as checked in'
      WHEN p_outcome = 'no_show'    THEN 'Marked as no-show'
      WHEN p_outcome = 'booked'     THEN 'Attendance reverted to booked'
    END,
    jsonb_build_object(
      'previous_status', v_booking.booking_status,
      'lifecycle', CASE WHEN v_is_done THEN 'completed' ELSE 'live' END
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', p_outcome,
    'previous', v_booking.booking_status
  );
END;
$$;

-- ═══ 6. sf_refresh_qa_fixtures (v0.8.4.1) ══════════════════════════════
-- Snaps the deterministic QA fixture set back to its documented state
-- relative to now(). Scoped to qa-* class ids only — production classes,
-- members, and audit are never touched.
--
-- Guarantees after one call:
--   qa-too-early   pre-window (starts in 60 min, 15-min window)
--   qa-open        in-window, three fresh booked QA members
--   qa-already-in  in-window, qa-alex pre-checked-in (idempotent demo)
--   qa-closed      ended 30 min ago, one checked_in + one no_show
--   qa-correction  ended 2 h ago, mixed state for correction testing
--
-- booking_events rows for QA fixture classes are wiped on each refresh
-- so repeat QA cycles start clean. This reset is explicit fixture
-- infrastructure — it does NOT violate the append-only audit
-- invariant, which applies to production class ids only.
CREATE OR REPLACE FUNCTION sf_refresh_qa_fixtures()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_now      timestamptz := now();
  -- v0.22.0: QA fixtures live in the demo studio. Resolved at function
  -- entry so insert sites stamp it explicitly.
  v_studio   uuid := (SELECT id FROM studios WHERE slug = 'demo');
  v_qa_class uuid[] := ARRAY[
    'd0000000-0000-0000-0000-000000000001'::uuid,
    'd0000000-0000-0000-0000-000000000002'::uuid,
    'd0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid,
    'd0000000-0000-0000-0000-000000000005'::uuid
  ];
  v_alex  uuid := 'c0000000-0000-0000-0000-000000000001';
  v_blake uuid := 'c0000000-0000-0000-0000-000000000002';
  v_casey uuid := 'c0000000-0000-0000-0000-000000000003';
BEGIN
  IF v_studio IS NULL THEN
    RAISE EXCEPTION 'sf_refresh_qa_fixtures: demo studio not found';
  END IF;
  UPDATE classes SET
    starts_at = v_now + interval '60 minutes',
    ends_at   = v_now + interval '120 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000001';

  UPDATE classes SET
    starts_at = v_now - interval '5 minutes',
    ends_at   = v_now + interval '55 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000002';

  UPDATE classes SET
    starts_at = v_now - interval '5 minutes',
    ends_at   = v_now + interval '55 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000003';

  UPDATE classes SET
    starts_at = v_now - interval '90 minutes',
    ends_at   = v_now - interval '30 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000004';

  UPDATE classes SET
    starts_at = v_now - interval '180 minutes',
    ends_at   = v_now - interval '120 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000005';

  DELETE FROM booking_events WHERE class_id = ANY(v_qa_class);
  DELETE FROM class_bookings WHERE class_id = ANY(v_qa_class);

  INSERT INTO class_bookings (class_id, member_id, studio_id, booking_status, is_active) VALUES
    ('d0000000-0000-0000-0000-000000000001', v_alex,  v_studio, 'booked', true),
    ('d0000000-0000-0000-0000-000000000001', v_blake, v_studio, 'booked', true);

  INSERT INTO class_bookings (class_id, member_id, studio_id, booking_status, is_active) VALUES
    ('d0000000-0000-0000-0000-000000000002', v_alex,  v_studio, 'booked', true),
    ('d0000000-0000-0000-0000-000000000002', v_blake, v_studio, 'booked', true),
    ('d0000000-0000-0000-0000-000000000002', v_casey, v_studio, 'booked', true);

  INSERT INTO class_bookings (
    class_id, member_id, studio_id, booking_status, checked_in_at, is_active
  ) VALUES
    ('d0000000-0000-0000-0000-000000000003', v_alex,  v_studio, 'checked_in', v_now, true),
    ('d0000000-0000-0000-0000-000000000003', v_blake, v_studio, 'booked', NULL, true);

  INSERT INTO booking_events (
    class_id, member_id, booking_id, studio_id, event_type, event_label, metadata
  )
  SELECT
    cb.class_id, cb.member_id, cb.id, v_studio,
    'checked_in',
    'Checked in (qa_fixture)',
    jsonb_build_object('source', 'qa_fixture')
  FROM class_bookings cb
  WHERE cb.class_id = 'd0000000-0000-0000-0000-000000000003'
    AND cb.booking_status = 'checked_in';

  INSERT INTO class_bookings (
    class_id, member_id, studio_id, booking_status, checked_in_at, is_active
  ) VALUES
    ('d0000000-0000-0000-0000-000000000004', v_alex,
     v_studio, 'checked_in', v_now - interval '75 minutes', true),
    ('d0000000-0000-0000-0000-000000000004', v_blake,
     v_studio, 'no_show', NULL, true);

  INSERT INTO class_bookings (
    class_id, member_id, studio_id, booking_status, checked_in_at, is_active
  ) VALUES
    ('d0000000-0000-0000-0000-000000000005', v_alex,
     v_studio, 'checked_in', v_now - interval '165 minutes', true),
    ('d0000000-0000-0000-0000-000000000005', v_blake,
     v_studio, 'no_show', NULL, true),
    ('d0000000-0000-0000-0000-000000000005', v_casey,
     v_studio, 'checked_in', v_now - interval '165 minutes', true);

  RETURN jsonb_build_object(
    'ok', true,
    'refreshed_at', v_now,
    'fixtures', jsonb_build_array(
      'qa-too-early', 'qa-open', 'qa-already-in', 'qa-closed', 'qa-correction'
    )
  );
END;
$$;

-- ═══ sf_apply_purchase — v0.13.0 (lifecycle row schema added v0.15.0) ═
-- Atomic idempotent fulfilment for Stripe webhook, member-home self-
-- serve fallback, and operator test-purchase panel. Signature is
-- unchanged from v0.13.0; v0.15.0 normalises the legacy 'credit_pack'
-- alias to 'class_pack' so any straggler caller is safe. Lifecycle
-- columns (status, price_cents_paid, credits_granted) are written by
-- applyPurchase in a follow-up UPDATE on the returned purchase_id —
-- keeping this function decoupled from the row schema means future
-- schema changes do not require a function rebuild. Full docs:
-- supabase/v0.15.0_migration.sql.
CREATE OR REPLACE FUNCTION sf_apply_purchase(
  p_member_id   uuid,
  p_plan_id     text,
  p_plan_type   text,
  p_plan_name   text,
  p_credits     integer,
  p_source      text,
  p_external_id text
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_studio          uuid;
  v_purchase_id     uuid;
  v_new_credits     integer;
  v_normalised_type text;
BEGIN
  -- v0.22.0: studio_id resolved from the member row referenced by
  -- p_member_id. Signature unchanged so applyPurchase.ts is not touched.
  SELECT studio_id INTO v_studio FROM members WHERE id = p_member_id;
  IF v_studio IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'sf_apply_purchase: member not found or has no studio_id'
    );
  END IF;

  v_normalised_type := CASE p_plan_type
    WHEN 'credit_pack' THEN 'class_pack'
    ELSE p_plan_type
  END;

  BEGIN
    INSERT INTO purchases (member_id, studio_id, plan_id, source, external_id)
    VALUES (p_member_id, v_studio, p_plan_id, p_source, p_external_id)
    RETURNING id INTO v_purchase_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'external_id', p_external_id
    );
  END;

  IF v_normalised_type = 'class_pack' THEN
    UPDATE members
      SET credits_remaining = COALESCE(credits_remaining, 0) + COALESCE(p_credits, 0),
          plan_type         = 'class_pack',
          plan_name         = p_plan_name,
          updated_at        = now()
      WHERE id = p_member_id
      RETURNING credits_remaining INTO v_new_credits;
    RETURN jsonb_build_object(
      'ok', true,
      'already_processed', false,
      'purchase_id', v_purchase_id,
      'plan_type_applied', 'class_pack',
      'credits_remaining', v_new_credits,
      'external_id', p_external_id
    );
  ELSIF v_normalised_type = 'unlimited' THEN
    UPDATE members
      SET plan_type         = 'unlimited',
          plan_name         = p_plan_name,
          credits_remaining = NULL,
          updated_at        = now()
      WHERE id = p_member_id;
    RETURN jsonb_build_object(
      'ok', true,
      'already_processed', false,
      'purchase_id', v_purchase_id,
      'plan_type_applied', 'unlimited',
      'credits_remaining', NULL,
      'external_id', p_external_id
    );
  ELSE
    DELETE FROM purchases WHERE id = v_purchase_id;
    RAISE EXCEPTION 'sf_apply_purchase: unknown plan_type %', p_plan_type;
  END IF;
END;
$$;

-- ═══ sf_refund_purchase — v0.16.0 ════════════════════════════════════
-- Class-pack refund flow. Reverses a completed purchase by flipping
-- purchases.status to 'refunded', decrementing members.credits_remaining
-- by the recorded credits_granted, and writing a ledger row with
-- reason_code='purchase_refund'. Idempotent — a duplicate call after
-- success returns { ok:true, already_refunded:true } without mutating
-- state. Full docs + safety rationale: supabase/v0.16.0_migration.sql.
CREATE OR REPLACE FUNCTION sf_refund_purchase(p_purchase_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_purchase     RECORD;
  v_plan         RECORD;
  v_balance      integer;
  v_new_balance  integer;
  v_ledger_id    uuid;
BEGIN
  SELECT id, member_id, studio_id, plan_id, source, status,
         price_cents_paid, credits_granted, external_id, created_at
    INTO v_purchase
    FROM purchases
    WHERE id = p_purchase_id
    FOR UPDATE;
  IF v_purchase IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'not_found',
      'error', 'Purchase not found: ' || p_purchase_id::text
    );
  END IF;

  IF v_purchase.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'status', v_purchase.status,
      'purchase_id', v_purchase.id
    );
  END IF;

  -- v0.22.0: plans is tenant-scoped — match purchase's studio_id.
  SELECT id, type, credits, price_cents
    INTO v_plan
    FROM plans
    WHERE id = v_purchase.plan_id AND studio_id = v_purchase.studio_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'plan_not_found',
      'error', 'Plan not found for purchase: ' || v_purchase.plan_id
    );
  END IF;

  IF v_plan.type <> 'class_pack' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'unsupported_plan_type',
      'plan_type', v_plan.type,
      'error',
        'Refund not supported for plan type: ' || v_plan.type
        || '. v0.16.0 supports class_pack refunds only.'
    );
  END IF;

  IF v_purchase.credits_granted IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'no_credits_granted_recorded',
      'error',
        'Purchase has no credits_granted recorded — '
        || 'cannot determine refund amount.'
    );
  END IF;

  SELECT credits_remaining INTO v_balance
    FROM members
    WHERE id = v_purchase.member_id
    FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_purchase.credits_granted THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'insufficient_credits_to_refund',
      'credits_remaining', v_balance,
      'credits_to_refund', v_purchase.credits_granted,
      'error',
        'Member has used some of the credits granted by this '
        || 'purchase already. Cannot refund without going negative.'
    );
  END IF;

  UPDATE purchases SET status = 'refunded' WHERE id = v_purchase.id;

  UPDATE members
    SET credits_remaining = credits_remaining - v_purchase.credits_granted,
        updated_at = now()
    WHERE id = v_purchase.member_id
    RETURNING credits_remaining INTO v_new_balance;

  INSERT INTO credit_transactions (
    member_id, studio_id, delta, balance_after, reason_code, source, note
  ) VALUES (
    v_purchase.member_id,
    v_purchase.studio_id,
    -v_purchase.credits_granted,
    v_new_balance,
    'purchase_refund',
    'system',
    'Refund of purchase ' || v_purchase.external_id
  ) RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_refunded', false,
    'purchase_id', v_purchase.id,
    'external_id', v_purchase.external_id,
    'refunded_credits', v_purchase.credits_granted,
    'new_balance', v_new_balance,
    'ledger_id', v_ledger_id
  );
END;
$$;
