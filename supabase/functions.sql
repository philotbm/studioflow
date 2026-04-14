-- StudioFlow v0.5.0 — Booking & Cancellation Engine
-- Run this in the Supabase SQL Editor after schema.sql + seed.sql

-- ═══ WAITLIST PERFORMANCE INDEX ═════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_waitlist_position
  ON class_bookings (class_id, waitlist_position)
  WHERE booking_status = 'waitlisted' AND is_active = true;

-- ═══ HELPER: count active booked (non-waitlisted) entries ═══════════════
-- Used inside multiple functions. Excludes waitlisted, cancelled, late_cancel.
CREATE OR REPLACE FUNCTION sf_count_booked(p_class_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer
  FROM class_bookings
  WHERE class_id = p_class_id
    AND is_active = true
    AND booking_status NOT IN ('waitlisted', 'cancelled', 'late_cancel');
$$;

-- ═══ HELPER: auto-promote from waitlist (FIFO) ═════════════════════════
-- Fills freed capacity by promoting lowest-position waitlisted entries.
-- Must be called within an existing transaction that holds the class lock.
CREATE OR REPLACE FUNCTION sf_auto_promote(p_class_id uuid, p_capacity integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_booked integer;
  v_next RECORD;
  v_promoted integer := 0;
BEGIN
  LOOP
    -- Recount booked on each iteration (capacity may have changed)
    v_booked := sf_count_booked(p_class_id);
    EXIT WHEN v_booked >= p_capacity;

    -- Get next waitlisted entry (strict FIFO)
    SELECT id, member_id, waitlist_position INTO v_next
    FROM class_bookings
    WHERE class_id = p_class_id
      AND booking_status = 'waitlisted'
      AND is_active = true
    ORDER BY waitlist_position ASC
    LIMIT 1;

    EXIT WHEN v_next IS NULL;

    -- Promote
    UPDATE class_bookings SET
      booking_status = 'booked',
      promotion_source = 'auto',
      promoted_at = now(),
      waitlist_position = NULL,
      updated_at = now()
    WHERE id = v_next.id;

    -- Log event
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

-- ═══ sf_book_member ═════════════════════════════════════════════════════
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
BEGIN
  -- Resolve member
  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found: ' || p_member_slug);
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
    -- Book directly
    v_status := 'booked';
    INSERT INTO class_bookings (class_id, member_id, booking_status, booked_at, is_active)
    VALUES (v_class.id, v_member.id, 'booked', now(), true)
    RETURNING id INTO v_booking_id;
  ELSE
    -- Add to waitlist
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_next_pos
    FROM class_bookings
    WHERE class_id = v_class.id AND booking_status = 'waitlisted' AND is_active = true;

    INSERT INTO class_bookings (class_id, member_id, booking_status, waitlist_position, is_active)
    VALUES (v_class.id, v_member.id, 'waitlisted', v_next_pos, true)
    RETURNING id INTO v_booking_id;
  END IF;

  -- Log event
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

-- ═══ sf_cancel_booking ══════════════════════════════════════════════════
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
BEGIN
  -- Resolve member
  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;

  -- Lock class row
  SELECT id, capacity, starts_at, ends_at, cancellation_window_hours
  INTO v_class
  FROM classes
  WHERE slug = p_class_slug
  FOR UPDATE;

  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found');
  END IF;

  -- Check lifecycle
  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object('error', 'Class is completed');
  END IF;
  IF v_class.starts_at <= now() AND v_class.ends_at >= now() THEN
    RETURN jsonb_build_object('error', 'Class is currently live');
  END IF;

  -- Find active booking
  SELECT id, booking_status, waitlist_position, promotion_source
  INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id AND member_id = v_member.id AND is_active = true;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('error', 'No active booking found');
  END IF;

  IF v_booking.booking_status = 'waitlisted' THEN
    -- Cancel waitlist entry
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

    -- Resequence remaining waitlist
    PERFORM sf_resequence_waitlist(v_class.id);

  ELSE
    -- Cancel booked entry — check cancellation window
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

    INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label)
    VALUES (v_class.id, v_member.id, v_booking.id, v_result,
      CASE v_result
        WHEN 'cancelled' THEN 'Booking cancelled'
        WHEN 'late_cancel' THEN 'Late cancellation (after cutoff)'
      END);

    -- Auto-promote to fill freed spot
    v_promoted := sf_auto_promote(v_class.id, v_class.capacity);

    -- Resequence remaining waitlist
    PERFORM sf_resequence_waitlist(v_class.id);
  END IF;

  RETURN jsonb_build_object(
    'result', v_result,
    'auto_promoted', v_promoted
  );
END;
$$;

-- ═══ sf_promote_member (manual) ═════════════════════════════════════════
CREATE OR REPLACE FUNCTION sf_promote_member(
  p_class_slug text,
  p_member_slug text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class RECORD;
  v_member RECORD;
  v_booking RECORD;
  v_promoted integer := 0;
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

  -- Promote
  UPDATE class_bookings SET
    booking_status = 'booked',
    promotion_source = 'manual',
    promoted_at = now(),
    waitlist_position = NULL,
    updated_at = now()
  WHERE id = v_booking.id;

  INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
  VALUES (v_class.id, v_member.id, v_booking.id, 'promoted_manual',
    'Promoted from waitlist #' || v_booking.waitlist_position,
    jsonb_build_object('original_position', v_booking.waitlist_position));

  -- Auto-promote remaining if capacity allows
  v_promoted := sf_auto_promote(v_class.id, v_class.capacity);

  -- Resequence
  PERFORM sf_resequence_waitlist(v_class.id);

  RETURN jsonb_build_object('result', 'promoted', 'auto_promoted', v_promoted);
END;
$$;

-- ═══ sf_unpromote_member ═════════════════════════════════════════════════
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

  INSERT INTO booking_events (class_id, member_id, booking_id, event_type, event_label, metadata)
  VALUES (v_class.id, v_member.id, v_booking.id, 'unpromoted',
    'Promotion reverted (back to waitlist #' || p_original_position || ')',
    jsonb_build_object('original_position', p_original_position));

  -- Revoke overflow auto-promotions
  -- Count non-auto booked entries (original bookings + manual promotions)
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
    -- Revert excess auto-promotions (most recently promoted first)
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
    END LOOP;
  END IF;

  -- Re-run auto-promote to stabilize
  PERFORM sf_auto_promote(v_class.id, v_class.capacity);

  -- Resequence
  PERFORM sf_resequence_waitlist(v_class.id);

  RETURN jsonb_build_object('result', 'unpromoted');
END;
$$;
