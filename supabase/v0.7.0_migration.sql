-- StudioFlow v0.7.0 — Economic Engine: Consumption + Server Enforcement
--
-- Run this in the Supabase SQL Editor AFTER schema.sql and the v0.5.0
-- functions.sql are already applied. This migration is idempotent
-- (every function is CREATE OR REPLACE) and can be re-run safely.
--
-- What it introduces:
--   1. sf_check_eligibility — server-side mirror of src/lib/eligibility.ts
--   2. sf_consume_credit    — decrement credits_remaining by 1 (no-op for unlimited)
--   3. sf_refund_credit     — increment credits_remaining by 1 (no-op for unlimited)
--   4. sf_auto_promote      — now re-checks eligibility per waitlist entry and
--                             consumes credit on promotion
--   5. sf_book_member       — enforces eligibility server-side, consumes credit
--                             on direct booking, never on waitlist, returns
--                             {status:"blocked", reason} on ineligible
--   6. sf_cancel_booking    — refunds credit on in-window cancellation only
--                             (no refund for late_cancel or waitlist removal)
--   7. sf_promote_member    — manual promotion now re-checks eligibility and
--                             consumes credit
--   8. sf_unpromote_member  — refunds credit when reverting a manual promotion

-- ═══ HELPER: server-side eligibility check ═════════════════════════════
-- Mirrors src/lib/eligibility.ts exactly. Returns JSONB, never throws.
CREATE OR REPLACE FUNCTION sf_check_eligibility(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_member RECORD;
BEGIN
  SELECT id, status, plan_type, plan_name, credits_remaining
  INTO v_member FROM members WHERE id = p_member_id;

  IF v_member IS NULL THEN
    RETURN jsonb_build_object('can_book', false, 'reason', 'Member not found');
  END IF;

  -- Hard expiry short-circuits everything else (mirror TS rule 1)
  IF v_member.status = 'inactive' THEN
    RETURN jsonb_build_object(
      'can_book', false,
      'reason', 'Membership expired',
      'entitlement_label', 'Expired',
      'credits_remaining', v_member.credits_remaining,
      'action_hint', 'Renew plan or purchase a new pack to book'
    );
  END IF;

  -- Unlimited always allowed (mirror TS rule 2)
  IF v_member.plan_type = 'unlimited' THEN
    RETURN jsonb_build_object(
      'can_book', true,
      'reason', 'Unlimited access',
      'entitlement_label', 'Unlimited',
      'credits_remaining', NULL,
      'action_hint', 'Member can book any class'
    );
  END IF;

  -- Class pack — credits must be positive (mirror TS rule 3)
  IF v_member.plan_type = 'class_pack' THEN
    IF COALESCE(v_member.credits_remaining, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'can_book', false,
        'reason', 'No credits remaining',
        'entitlement_label', v_member.plan_name || ' (0 left)',
        'credits_remaining', 0,
        'action_hint', 'Sell a new class pack to continue booking'
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
                          ELSE 'Member can book a class' END
    );
  END IF;

  -- Trial — credits must be positive (mirror TS rule 4)
  IF v_member.plan_type = 'trial' THEN
    IF COALESCE(v_member.credits_remaining, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'can_book', false,
        'reason', 'Trial used up',
        'entitlement_label', 'Trial (0 left)',
        'credits_remaining', 0,
        'action_hint', 'Convert trial to a full plan to book again'
      );
    END IF;
    RETURN jsonb_build_object(
      'can_book', true,
      'reason', 'Trial entitlement active',
      'entitlement_label', 'Trial (' || v_member.credits_remaining || ' left)',
      'credits_remaining', v_member.credits_remaining,
      'action_hint', 'Follow up after class to convert'
    );
  END IF;

  -- Drop-in / unknown — no ongoing entitlement (mirror TS rule 5)
  RETURN jsonb_build_object(
    'can_book', false,
    'reason', 'No active entitlement',
    'entitlement_label', 'Drop-in',
    'credits_remaining', v_member.credits_remaining,
    'action_hint', 'Member needs a plan or credit pack before booking'
  );
END;
$$;

-- ═══ HELPER: consume a single credit (no-op for unlimited) ═════════════
-- Only decrements class_pack / trial. Caller must have already locked
-- the member row via its parent transaction's class-level lock, or call
-- this inside a transaction where races are acceptable.
CREATE OR REPLACE FUNCTION sf_consume_credit(p_member_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_plan text;
BEGIN
  SELECT plan_type INTO v_plan FROM members WHERE id = p_member_id FOR UPDATE;
  IF v_plan IN ('class_pack', 'trial') THEN
    UPDATE members
    SET credits_remaining = GREATEST(COALESCE(credits_remaining, 0) - 1, 0),
        updated_at = now()
    WHERE id = p_member_id;
  END IF;
END;
$$;

-- ═══ HELPER: refund a single credit (no-op for unlimited) ══════════════
CREATE OR REPLACE FUNCTION sf_refund_credit(p_member_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_plan text;
BEGIN
  SELECT plan_type INTO v_plan FROM members WHERE id = p_member_id FOR UPDATE;
  IF v_plan IN ('class_pack', 'trial') THEN
    UPDATE members
    SET credits_remaining = COALESCE(credits_remaining, 0) + 1,
        updated_at = now()
    WHERE id = p_member_id;
  END IF;
END;
$$;

-- ═══ sf_auto_promote — v0.7.0 update ═══════════════════════════════════
-- Now re-checks eligibility per waitlist entry. Ineligible waitlist entries
-- are SKIPPED (they stay in place) and the loop continues with the next
-- eligible candidate, preserving FIFO among eligible members. Consumes one
-- credit per successful promotion.
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

    -- Get next eligible waitlisted entry (strict FIFO among eligible)
    SELECT id, member_id, waitlist_position INTO v_next
    FROM class_bookings
    WHERE class_id = p_class_id
      AND booking_status = 'waitlisted'
      AND is_active = true
      AND NOT (id = ANY(v_skipped_ids))
    ORDER BY waitlist_position ASC
    LIMIT 1;

    EXIT WHEN v_next IS NULL;

    -- v0.7.0: check eligibility before promoting
    v_elig := sf_check_eligibility(v_next.member_id);
    IF (v_elig->>'can_book')::boolean = false THEN
      -- Skip this member for this promotion pass — they remain on the
      -- waitlist in their current position. The loop continues with the
      -- next candidate, so one ineligible entry doesn't block the list.
      v_skipped_ids := array_append(v_skipped_ids, v_next.id);
      CONTINUE;
    END IF;

    -- Promote
    UPDATE class_bookings SET
      booking_status = 'booked',
      promotion_source = 'auto',
      promoted_at = now(),
      waitlist_position = NULL,
      updated_at = now()
    WHERE id = v_next.id;

    -- v0.7.0: consume credit on promotion
    PERFORM sf_consume_credit(v_next.member_id);

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

-- ═══ sf_book_member — v0.7.0 update ════════════════════════════════════
-- Enforces eligibility server-side. Consumes credit on direct booking only
-- (never on waitlist). Returns structured blocked response.
CREATE OR REPLACE FUNCTION sf_book_member(
  p_class_slug text,
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
  -- Resolve member
  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  END IF;

  -- v0.7.0: server-side eligibility enforcement (BEFORE locking class row)
  v_elig := sf_check_eligibility(v_member.id);
  IF (v_elig->>'can_book')::boolean = false THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', v_elig->>'reason',
      'entitlement_label', v_elig->>'entitlement_label',
      'credits_remaining', v_elig->'credits_remaining',
      'action_hint', v_elig->>'action_hint'
    );
  END IF;

  -- Lock class row (prevents concurrent booking races)
  SELECT id, capacity, starts_at, ends_at
  INTO v_class
  FROM classes
  WHERE slug = p_class_slug
  FOR UPDATE;

  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  END IF;

  -- Check lifecycle (upcoming only)
  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object('error', 'Class is completed');
  END IF;
  IF v_class.starts_at <= now() AND v_class.ends_at >= now() THEN
    RETURN jsonb_build_object('error', 'Class is currently live');
  END IF;

  -- Idempotent: check for existing active booking
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

  -- Count current booked
  v_booked := sf_count_booked(v_class.id);

  IF v_booked < v_class.capacity THEN
    -- Direct booking path — consume credit
    v_status := 'booked';
    INSERT INTO class_bookings (class_id, member_id, booking_status, booked_at, is_active)
    VALUES (v_class.id, v_member.id, 'booked', now(), true)
    RETURNING id INTO v_booking_id;

    -- v0.7.0: consume credit (no-op for unlimited)
    PERFORM sf_consume_credit(v_member.id);
  ELSE
    -- Waitlist path — no credit consumed
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_pos
    FROM class_bookings
    WHERE class_id = v_class.id AND booking_status = 'waitlisted' AND is_active = true;

    INSERT INTO class_bookings (class_id, member_id, booking_status, waitlist_position, is_active)
    VALUES (v_class.id, v_member.id, 'waitlisted', v_next_pos, true)
    RETURNING id INTO v_booking_id;
  END IF;

  -- Log event (unchanged from v0.5.0)
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

-- ═══ sf_cancel_booking — v0.7.0 update ═════════════════════════════════
-- Refunds credit on in-window cancellation of a booked seat.
-- No refund on late_cancel. No refund on waitlist removal (never charged).
CREATE OR REPLACE FUNCTION sf_cancel_booking(
  p_class_slug text,
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
  FROM classes
  WHERE slug = p_class_slug
  FOR UPDATE;

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
    -- Waitlist removal: never charged, never refund
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
    -- Booked seat cancellation — check cancellation window
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

    -- v0.7.0: refund credit only on in-window cancellation
    IF v_result = 'cancelled' THEN
      PERFORM sf_refund_credit(v_member.id);
      v_refunded := true;
    END IF;

    INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
    VALUES (v_class.id, v_member.id, v_booking.id, v_result,
      CASE v_result
        WHEN 'cancelled' THEN 'Booking cancelled'
        WHEN 'late_cancel' THEN 'Late cancellation (after cutoff)'
      END,
      jsonb_build_object('refunded', v_refunded));

    -- Auto-promote to fill freed spot (v0.7.0: consumes credit per promotion)
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

-- ═══ sf_promote_member — v0.7.0 update ═════════════════════════════════
-- Manual promotion now re-checks eligibility and consumes credit.
CREATE OR REPLACE FUNCTION sf_promote_member(
  p_class_slug text,
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

  -- Find waitlisted booking
  SELECT id, waitlist_position INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id AND member_id = v_member.id
    AND booking_status = 'waitlisted' AND is_active = true;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('error', 'No waitlisted booking found');
  END IF;

  -- v0.7.0: check eligibility before promoting
  v_elig := sf_check_eligibility(v_member.id);
  IF (v_elig->>'can_book')::boolean = false THEN
    RETURN jsonb_build_object(
      'error', 'Cannot promote — ' || (v_elig->>'reason')
    );
  END IF;

  -- Promote
  UPDATE class_bookings SET
    booking_status = 'booked',
    promotion_source = 'manual',
    promoted_at = now(),
    waitlist_position = NULL,
    updated_at = now()
  WHERE id = v_booking.id;

  -- v0.7.0: consume credit on manual promotion
  PERFORM sf_consume_credit(v_member.id);

  INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
  VALUES (v_class.id, v_member.id, v_booking.id, 'promoted_manual',
    'Promoted from waitlist #' || v_booking.waitlist_position,
    jsonb_build_object('original_position', v_booking.waitlist_position));

  -- Auto-promote remaining if capacity allows
  v_promoted := sf_auto_promote(v_class.id, v_class.capacity);

  PERFORM sf_resequence_waitlist(v_class.id);

  RETURN jsonb_build_object('result', 'promoted', 'auto_promoted', v_promoted);
END;
$$;

-- ═══ sf_unpromote_member — v0.7.0 update ═══════════════════════════════
-- Refunds the credit that was consumed when the manual promotion happened.
-- The existing v0.5.0 overflow-revert path also refunds credits per
-- reverted auto-promotion so that we stay in balance.
CREATE OR REPLACE FUNCTION sf_unpromote_member(
  p_class_slug text,
  p_member_slug text,
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

  -- Find manually-promoted booking
  SELECT id INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id AND member_id = v_member.id
    AND booking_status = 'booked' AND promotion_source = 'manual' AND is_active = true;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('error', 'No manually-promoted booking found');
  END IF;

  -- Revert to waitlisted
  UPDATE class_bookings SET
    booking_status = 'waitlisted',
    promotion_source = NULL,
    promoted_at = NULL,
    waitlist_position = p_original_position,
    updated_at = now()
  WHERE id = v_booking.id;

  -- v0.7.0: refund the credit that was consumed when manually promoted
  PERFORM sf_refund_credit(v_member.id);

  INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
  VALUES (v_class.id, v_member.id, v_booking.id, 'unpromoted',
    'Promotion reverted (back to waitlist #' || p_original_position || ')',
    jsonb_build_object('original_position', p_original_position));

  -- Revoke overflow auto-promotions
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

      -- v0.7.0: refund credit consumed by the auto-promotion we're reverting
      PERFORM sf_refund_credit(v_auto.member_id);
    END LOOP;
  END IF;

  -- Re-run auto-promote to stabilize
  PERFORM sf_auto_promote(v_class.id, v_class.capacity);

  PERFORM sf_resequence_waitlist(v_class.id);

  RETURN jsonb_build_object('result', 'unpromoted');
END;
$$;
