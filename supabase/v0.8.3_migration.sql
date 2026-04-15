-- StudioFlow v0.8.3 — Check-In as Attendance Truth + QR
--
-- Run this in the Supabase SQL Editor after the v0.8.2 migration is
-- already applied. It is idempotent.
--
-- What it changes:
--   1. class_bookings.booking_status check constraint: 'checked_in' is
--      added as an allowed value. 'attended' is retained as a tolerated
--      legacy value so existing rows do not violate the constraint
--      during the transition, but no new writes produce it.
--   2. Any existing class_bookings rows with booking_status='attended'
--      are normalised to 'checked_in' so the product speaks one
--      attendance language across all views.
--   3. sf_check_in — new RPC. Live-class only. booked → checked_in.
--      Duplicate-prevention, waitlist/cancelled/late_cancel/not-booked
--      rejection, lifecycle gating. Writes a booking_events row with
--      source metadata.
--   4. sf_finalise_class — new RPC. Sweeps active bookings where
--      booking_status='booked' → 'no_show' on a completed class. The
--      client auto-invokes this when a completed class is viewed, so
--      the first visitor after class-end deterministically finalises
--      it (pull-based close; see the release report for why we are
--      not using a scheduled background job in this phase).
--   5. sf_mark_attendance — updated for the post-close correction
--      path. Outcomes are now 'checked_in', 'no_show', or 'booked'
--      (revert, live classes only). Completed classes now accept the
--      correction outcomes 'checked_in' and 'no_show' but NOT 'booked',
--      so a finalised class cannot be silently reverted into limbo.
--      Upcoming classes are still rejected. Legacy 'attended' is
--      rejected at input-validation time.

-- ═══ 1. class_bookings.booking_status — allow checked_in ═══════════════
ALTER TABLE class_bookings
  DROP CONSTRAINT IF EXISTS class_bookings_booking_status_check;

ALTER TABLE class_bookings
  ADD CONSTRAINT class_bookings_booking_status_check
  CHECK (booking_status IN (
    'booked', 'waitlisted', 'cancelled',
    'late_cancel', 'attended', 'no_show', 'checked_in'
  ));

-- ═══ 2. Normalise legacy 'attended' → 'checked_in' ═════════════════════
-- Any row still carrying the pre-v0.8.3 'attended' language becomes
-- 'checked_in'. The audit trail is preserved (this UPDATE does not
-- touch booking_events).
UPDATE class_bookings
SET booking_status = 'checked_in', updated_at = now()
WHERE booking_status = 'attended';

-- ═══ 3. sf_check_in ════════════════════════════════════════════════════
-- Positive attendance truth input. One of the three input channels
-- (client app page, QR-scanned URL, instructor fallback) calls this.
-- Source is recorded in booking_events metadata for audit.
--
-- Rules:
--   - Class must be LIVE (starts_at <= now() <= ends_at). Upcoming and
--     completed classes are rejected.
--   - Active booking must exist and currently be 'booked'.
--     Waitlisted, cancelled, late_cancel, and "not booked at all"
--     cases all resolve to the same "No eligible booking" error.
--   - Already-checked-in rows are rejected with a clear duplicate error
--     — the front-end hides the Check in button in that case, but the
--     DB is the backstop.
--   - Source must be one of 'client', 'operator' (v0.8.3). A future
--     release can extend this set.
--
-- Return: { ok: true } or { error: "..." }.
CREATE OR REPLACE FUNCTION sf_check_in(
  p_class_slug  text,
  p_member_slug text,
  p_source      text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class   RECORD;
  v_member  RECORD;
  v_booking RECORD;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('client', 'operator') THEN
    RETURN jsonb_build_object(
      'error', 'Invalid source — must be one of: client, operator'
    );
  END IF;

  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  END IF;

  SELECT id, starts_at, ends_at
  INTO v_class
  FROM classes
  WHERE slug = p_class_slug
  FOR UPDATE;

  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  END IF;

  -- Lifecycle gate: live only
  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object('error', 'Class is completed — check-in closed');
  END IF;
  IF v_class.starts_at > now() THEN
    RETURN jsonb_build_object('error', 'Class has not started — check-in is not open yet');
  END IF;

  -- Find eligible booking. Must be active AND currently booked or
  -- checked_in (already-checked-in is rejected separately below so we
  -- return the precise error).
  SELECT id, booking_status INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id
    AND member_id = v_member.id
    AND is_active = true
    AND booking_status IN ('booked', 'checked_in');

  IF v_booking IS NULL THEN
    -- This catches waitlisted, cancelled, late_cancel, and "no booking" all
    -- with the same operator-safe message.
    RETURN jsonb_build_object(
      'error', 'No eligible booking — member is not booked into this class'
    );
  END IF;

  IF v_booking.booking_status = 'checked_in' THEN
    RETURN jsonb_build_object('error', 'Already checked in');
  END IF;

  UPDATE class_bookings SET
    booking_status = 'checked_in',
    checked_in_at = now(),
    updated_at = now()
  WHERE id = v_booking.id;

  INSERT INTO booking_events (
    class_id, member_id, booking_id, event_type, event_label, metadata
  )
  VALUES (
    v_class.id, v_member.id, v_booking.id,
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
CREATE OR REPLACE FUNCTION sf_finalise_class(p_class_slug text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class RECORD;
  v_count integer := 0;
  r RECORD;
BEGIN
  SELECT id, starts_at, ends_at INTO v_class
  FROM classes WHERE slug = p_class_slug FOR UPDATE;

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
      class_id, member_id, booking_id, event_type, event_label, metadata
    )
    VALUES (
      v_class.id, r.member_id, r.id,
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
  p_outcome     text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class    RECORD;
  v_member   RECORD;
  v_booking  RECORD;
  v_is_live  boolean;
  v_is_done  boolean;
BEGIN
  IF p_outcome NOT IN ('checked_in', 'no_show', 'booked') THEN
    RETURN jsonb_build_object(
      'error',
      'Invalid outcome — must be one of: checked_in, no_show, booked'
    );
  END IF;

  SELECT id INTO v_member FROM members WHERE slug = p_member_slug;
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found: ' || p_member_slug);
  END IF;

  SELECT id, starts_at, ends_at INTO v_class
  FROM classes WHERE slug = p_class_slug FOR UPDATE;

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
      'Class is completed — cannot revert to booked; use checked_in or no_show'
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
    class_id, member_id, booking_id, event_type, event_label, metadata
  )
  VALUES (
    v_class.id, v_member.id, v_booking.id,
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
