-- StudioFlow v0.8.0 — Economic Truth Hardening + Credit Control
--
-- Run this in the Supabase SQL Editor after the v0.7.0 migration is already
-- applied. It is idempotent on its functions (CREATE OR REPLACE), the
-- credit_transactions table (CREATE IF NOT EXISTS), and the view
-- (CREATE OR REPLACE VIEW).
--
-- What it introduces:
--   1. credit_transactions — append-only financial ledger
--   2. sf_check_eligibility — extended to return status_code
--   3. v_members_with_access — server-side truth for booking access; the
--      client reads this view instead of duplicating rules in TypeScript
--   4. sf_consume_credit / sf_refund_credit — ledger-aware, require context
--   5. sf_adjust_credit — atomic manual operator adjustment with reason code
--   6. sf_book_member / sf_cancel_booking / sf_auto_promote /
--      sf_promote_member / sf_unpromote_member — updated to pass ledger
--      context through to the credit helpers

-- ═══ CREDIT_TRANSACTIONS — append-only financial truth ═════════════════
CREATE TABLE IF NOT EXISTS credit_transactions (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members(id) on delete cascade,
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

-- ═══ sf_check_eligibility — v0.8.0 update ══════════════════════════════
-- Adds status_code to the JSON result so the UI can switch on a stable key
-- instead of matching on human-readable reason strings. Everything else
-- mirrors src/lib/eligibility.ts v0.6.0 exactly (which was the v0.7.0
-- server port) so there are no behaviour regressions.
CREATE OR REPLACE FUNCTION sf_check_eligibility(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_member RECORD;
BEGIN
  SELECT id, status, plan_type, plan_name, credits_remaining
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

  -- Account lifecycle: inactive overrides everything
  IF v_member.status = 'inactive' THEN
    RETURN jsonb_build_object(
      'can_book', false,
      'reason', 'Account inactive',
      'entitlement_label', 'Inactive account',
      'credits_remaining', v_member.credits_remaining,
      'action_hint', 'Reactivate the account to allow booking',
      'status_code', 'account_inactive'
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

-- ═══ sf_consume_credit — v0.8.0 update ═════════════════════════════════
-- Now accepts full ledger context and writes a row on every consumption.
-- Unlimited plans remain a no-op (no balance change, no ledger row).
-- Returns the new balance and ledger row id, or {consumed:false} if it
-- was a no-op so callers can audit.
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
  v_bal_after integer;
  v_ledger_id uuid;
BEGIN
  SELECT plan_type INTO v_plan FROM members WHERE id = p_member_id FOR UPDATE;
  IF v_plan IN ('class_pack','trial') THEN
    UPDATE members
    SET credits_remaining = GREATEST(COALESCE(credits_remaining, 0) - 1, 0),
        updated_at = now()
    WHERE id = p_member_id
    RETURNING credits_remaining INTO v_bal_after;

    INSERT INTO credit_transactions (
      member_id, delta, balance_after, reason_code, source,
      class_id, booking_id, note, operator_key
    )
    VALUES (
      p_member_id, -1, v_bal_after, p_reason_code, p_source,
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

-- ═══ sf_refund_credit — v0.8.0 update ══════════════════════════════════
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
  v_bal_after integer;
  v_ledger_id uuid;
BEGIN
  SELECT plan_type INTO v_plan FROM members WHERE id = p_member_id FOR UPDATE;
  IF v_plan IN ('class_pack','trial') THEN
    UPDATE members
    SET credits_remaining = COALESCE(credits_remaining, 0) + 1,
        updated_at = now()
    WHERE id = p_member_id
    RETURNING credits_remaining INTO v_bal_after;

    INSERT INTO credit_transactions (
      member_id, delta, balance_after, reason_code, source,
      class_id, booking_id, note, operator_key
    )
    VALUES (
      p_member_id, 1, v_bal_after, p_reason_code, p_source,
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

-- ═══ sf_adjust_credit — new operator-driven manual adjustment ══════════
-- Atomic: locks the member row, applies the delta (clamped at 0), and
-- writes a single ledger row with source='operator'. Reason code is
-- required and must be one of the allowed operator reasons. Unlimited
-- and drop_in members cannot be adjusted (rejected with an error).
CREATE OR REPLACE FUNCTION sf_adjust_credit(
  p_member_slug  text,
  p_delta        integer,
  p_reason_code  text,
  p_note         text DEFAULT NULL,
  p_operator_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_member RECORD;
  v_bal_after integer;
  v_ledger_id uuid;
  v_allowed text[] := ARRAY[
    'bereavement', 'medical', 'studio_error',
    'goodwill', 'admin_correction', 'service_recovery'
  ];
BEGIN
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
  FROM members WHERE slug = p_member_slug FOR UPDATE;

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
    member_id, delta, balance_after, reason_code, source,
    note, operator_key
  )
  VALUES (
    v_member.id, p_delta, v_bal_after, p_reason_code, 'operator',
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

-- ═══ sf_auto_promote — v0.8.0 update ═══════════════════════════════════
-- Passes ledger context through to sf_consume_credit on promotion.
CREATE OR REPLACE FUNCTION sf_auto_promote(p_class_id uuid, p_capacity integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_booked integer;
  v_next RECORD;
  v_promoted integer := 0;
  v_elig jsonb;
  v_skipped_ids uuid[] := ARRAY[]::uuid[];
BEGIN
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

    INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
    VALUES (
      p_class_id, v_next.member_id, v_next.id,
      'promoted_auto',
      'Auto-promoted from waitlist #' || v_next.waitlist_position,
      jsonb_build_object('original_position', v_next.waitlist_position)
    );

    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN v_promoted;
END;
$$;

-- ═══ sf_book_member — v0.8.0 update ════════════════════════════════════
-- Passes ledger context on direct booking.
CREATE OR REPLACE FUNCTION sf_book_member(
  p_class_slug  text,
  p_member_slug text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class RECORD;
  v_member RECORD;
  v_existing RECORD;
  v_booked integer;
  v_next_pos integer;
  v_booking_id uuid;
  v_status text;
  v_elig jsonb;
BEGIN
  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
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

  SELECT id, capacity, starts_at, ends_at
  INTO v_class
  FROM classes WHERE slug = p_class_slug FOR UPDATE;

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
    INSERT INTO class_bookings (class_id, member_id, booking_status, booked_at, is_active)
    VALUES (v_class.id, v_member.id, 'booked', now(), true)
    RETURNING id INTO v_booking_id;

    -- v0.8.0: ledger-aware consume
    PERFORM sf_consume_credit(
      v_member.id, 'booking', 'system', v_class.id, v_booking_id
    );
  ELSE
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_pos
    FROM class_bookings
    WHERE class_id = v_class.id AND booking_status = 'waitlisted' AND is_active = true;

    INSERT INTO class_bookings (class_id, member_id, booking_status, waitlist_position, is_active)
    VALUES (v_class.id, v_member.id, 'waitlisted', v_next_pos, true)
    RETURNING id INTO v_booking_id;
  END IF;

  INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label)
  VALUES (v_class.id, v_member.id, v_booking_id, v_status,
    CASE v_status
      WHEN 'booked' THEN 'Booked into class'
      WHEN 'waitlisted' THEN 'Added to waitlist #' || v_next_pos
    END
  );

  RETURN jsonb_build_object('status', v_status, 'booking_id', v_booking_id);
END;
$$;

-- ═══ sf_cancel_booking — v0.8.0 update ═════════════════════════════════
-- Passes ledger context on in-window refund.
CREATE OR REPLACE FUNCTION sf_cancel_booking(
  p_class_slug  text,
  p_member_slug text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_result text;
  v_promoted integer := 0;
  v_cutoff timestamptz;
  v_refunded boolean := false;
BEGIN
  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;

  SELECT id, capacity, starts_at, ends_at, cancellation_window_hours
  INTO v_class
  FROM classes WHERE slug = p_class_slug FOR UPDATE;

  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found');
  END IF;

  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object('error', 'Class is completed');
  END IF;
  IF v_class.starts_at <= now() AND v_class.ends_at >= now() THEN
    RETURN jsonb_build_object('error', 'Class is currently live');
  END IF;

  SELECT id, booking_status, waitlist_position, promotion_source
  INTO v_booking
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

    INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label)
    VALUES (v_class.id, v_member.id, v_booking.id, 'cancelled',
      'Removed from waitlist #' || v_booking.waitlist_position);

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
      -- v0.8.0: ledger-aware refund
      PERFORM sf_refund_credit(
        v_member.id, 'cancel_refund', 'system', v_class.id, v_booking.id
      );
      v_refunded := true;
    END IF;

    INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
    VALUES (v_class.id, v_member.id, v_booking.id, v_result,
      CASE v_result
        WHEN 'cancelled' THEN 'Booking cancelled'
        WHEN 'late_cancel' THEN 'Late cancellation (after cutoff)'
      END,
      jsonb_build_object('refunded', v_refunded));

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

-- ═══ sf_promote_member — v0.8.0 update ═════════════════════════════════
CREATE OR REPLACE FUNCTION sf_promote_member(
  p_class_slug  text,
  p_member_slug text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_promoted integer := 0;
  v_elig jsonb;
BEGIN
  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;

  SELECT id, capacity, starts_at, ends_at
  INTO v_class FROM classes WHERE slug = p_class_slug FOR UPDATE;

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

  -- v0.8.0: ledger-aware consume
  PERFORM sf_consume_credit(
    v_member.id, 'manual_promotion', 'system', v_class.id, v_booking.id
  );

  INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
  VALUES (v_class.id, v_member.id, v_booking.id, 'promoted_manual',
    'Promoted from waitlist #' || v_booking.waitlist_position,
    jsonb_build_object('original_position', v_booking.waitlist_position));

  v_promoted := sf_auto_promote(v_class.id, v_class.capacity);

  PERFORM sf_resequence_waitlist(v_class.id);

  RETURN jsonb_build_object('result', 'promoted', 'auto_promoted', v_promoted);
END;
$$;

-- ═══ sf_unpromote_member — v0.8.0 update ═══════════════════════════════
CREATE OR REPLACE FUNCTION sf_unpromote_member(
  p_class_slug       text,
  p_member_slug      text,
  p_original_position integer
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_auto RECORD;
  v_base_booked integer;
  v_slots_for_auto integer;
  v_auto_count integer;
  v_orig_pos integer;
BEGIN
  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;

  SELECT id, capacity FROM classes WHERE slug = p_class_slug
  INTO v_class FOR UPDATE;

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

  -- v0.8.0: ledger-aware refund for the unpromoted member
  PERFORM sf_refund_credit(
    v_member.id, 'unpromote_refund', 'system', v_class.id, v_booking.id
  );

  INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
  VALUES (v_class.id, v_member.id, v_booking.id, 'unpromoted',
    'Promotion reverted (back to waitlist #' || p_original_position || ')',
    jsonb_build_object('original_position', p_original_position));

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
