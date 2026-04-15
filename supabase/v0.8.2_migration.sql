-- StudioFlow v0.8.2 — Instructor View + Attendance Loop
--
-- Run this in the Supabase SQL Editor after the v0.8.0 migration is
-- already applied. It is idempotent — sf_mark_attendance is a
-- CREATE OR REPLACE and touches no schema.
--
-- What it introduces:
--   sf_mark_attendance — new RPC for instructor-driven attendance
--                        transitions (booked <-> attended <-> no_show)
--
-- No schema changes: the class_bookings.booking_status check constraint
-- already allows 'attended' and 'no_show' (see supabase/schema.sql).
-- No table columns added, no view changed.

-- ═══ sf_mark_attendance ════════════════════════════════════════════════
-- Transitions a single active booking's status between the three
-- instructor-relevant states: 'booked', 'attended', 'no_show'.
--
-- Rules:
--   - The class must be LIVE (starts_at <= now() AND ends_at >= now()).
--     Upcoming classes cannot be marked (instructor UI disables it too).
--     Completed classes are read-only (the DB enforces this as a
--     safety backstop so a stale tab can't overwrite a finalised class).
--   - The booking must be is_active = true AND currently one of
--     {booked, attended, no_show}. Waitlist, cancelled, and late_cancel
--     rows are explicitly ineligible.
--   - p_outcome must be one of 'attended', 'no_show', or 'booked'
--     (the last one is an explicit revert to the pre-marked state,
--     used for mistake correction).
--   - Writes exactly one row to booking_events for the transition,
--     carrying the previous status in metadata so the audit trail is
--     reversible.
--
-- Returns { ok: true, outcome, previous } on success, or
-- { error: "..." } on any validation failure.
CREATE OR REPLACE FUNCTION sf_mark_attendance(
  p_class_slug  text,
  p_member_slug text,
  p_outcome     text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class   RECORD;
  v_member  RECORD;
  v_booking RECORD;
BEGIN
  IF p_outcome NOT IN ('attended', 'no_show', 'booked') THEN
    RETURN jsonb_build_object(
      'error',
      'Invalid outcome — must be one of: attended, no_show, booked'
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

  -- Lifecycle guard. The instructor UI disables these actions outside
  -- the live window; this check is the server-side backstop.
  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object(
      'error',
      'Class is completed — attendance is read-only'
    );
  END IF;
  IF v_class.starts_at > now() THEN
    RETURN jsonb_build_object(
      'error',
      'Class has not started — attendance cannot be marked yet'
    );
  END IF;

  -- Only allow transitions on an active booked / attended / no_show row.
  -- Waitlist rows, cancelled rows, and late_cancel rows are off-limits.
  SELECT id, booking_status
  INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id
    AND member_id = v_member.id
    AND is_active = true
    AND booking_status IN ('booked', 'attended', 'no_show');

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object(
      'error',
      'No eligible booking found for this member in this class'
    );
  END IF;

  -- No-op if the outcome matches the current status — still return ok
  -- so the caller can treat it idempotently.
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
    CASE p_outcome
      WHEN 'attended' THEN 'attendance_attended'
      WHEN 'no_show'  THEN 'attendance_no_show'
      WHEN 'booked'   THEN 'attendance_reverted'
    END,
    CASE p_outcome
      WHEN 'attended' THEN 'Marked attended'
      WHEN 'no_show'  THEN 'Marked no-show'
      WHEN 'booked'   THEN 'Attendance reverted to booked'
    END,
    jsonb_build_object('previous_status', v_booking.booking_status)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', p_outcome,
    'previous', v_booking.booking_status
  );
END;
$$;
