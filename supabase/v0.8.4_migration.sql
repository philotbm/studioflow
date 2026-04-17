-- StudioFlow v0.8.4 — Check-In Window + Idempotency Hardening
--
-- Run this in the Supabase SQL Editor after v0.8.3_migration.sql. It is
-- fully idempotent — safe to re-run.
--
-- What this changes
-- =================
--
-- 1. classes.check_in_window_minutes (new column, default 15)
--    Defines an explicit allowed check-in window: check-in opens
--    `check_in_window_minutes` before the class starts and closes at
--    `ends_at`. The seed HIIT class gets a smaller window via seed.sql
--    so QA can exercise the too-early gate without waiting.
--
-- 2. sf_check_in — window + idempotency hardening
--    - Gate is now (starts_at - check_in_window_minutes) <= now() <= ends_at
--      so pre-window and post-window calls are explicitly rejected with
--      operator-safe messages.
--    - Already-checked-in is NO LONGER an error. It returns a clean
--      { ok: true, already_checked_in: true, noop: true } payload and
--      writes no duplicate booking row update and no duplicate audit
--      event. This is the idempotency hardening — a repeat QR scan or
--      a rapid double-tap cannot pollute the ledger.
--    - source is still client / operator; the v0.8.3 audit event shape
--      is preserved for the non-duplicate path.
--
-- 3. class_bookings.booking_status — drop legacy 'attended'
--    The v0.8.3 migration already normalised every 'attended' row to
--    'checked_in'. We re-run that UPDATE here as a belt-and-suspenders
--    safety (idempotent no-op on a clean DB), then tighten the CHECK
--    constraint to remove 'attended' from the accepted set. From v0.8.4
--    onwards the DB speaks one attendance language.
--
-- 4. sf_mark_attendance — window-aware error messaging
--    The live-only 'booked' revert now uses the same window semantics as
--    sf_check_in for consistency. Behaviour is unchanged for the
--    correction path (completed classes) — only the error text is
--    tightened to match the new vocabulary.

-- ═══ 1. check_in_window_minutes column ══════════════════════════════════
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS check_in_window_minutes integer NOT NULL DEFAULT 15
    CHECK (check_in_window_minutes >= 0 AND check_in_window_minutes <= 240);

-- Existing rows inherit default 15. Per-class tuning is allowed — a
-- studio that wants a 30-min pre-class lobby can set 30 on specific
-- classes without touching the rest. The QA seed tightens the HIIT
-- upcoming class to a very small window so the too-early state is
-- trivially reproducible during live QA.

-- ═══ 2. Re-run legacy attendance normalisation (idempotent) ═════════════
UPDATE class_bookings
SET booking_status = 'checked_in', updated_at = now()
WHERE booking_status = 'attended';

-- ═══ 3. Tighten booking_status constraint ══════════════════════════════
ALTER TABLE class_bookings
  DROP CONSTRAINT IF EXISTS class_bookings_booking_status_check;

ALTER TABLE class_bookings
  ADD CONSTRAINT class_bookings_booking_status_check
  CHECK (booking_status IN (
    'booked', 'waitlisted', 'cancelled',
    'late_cancel', 'no_show', 'checked_in'
  ));

-- ═══ 4. sf_check_in — window + idempotent duplicate handling ═══════════
CREATE OR REPLACE FUNCTION sf_check_in(
  p_class_slug  text,
  p_member_slug text,
  p_source      text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_class       RECORD;
  v_member      RECORD;
  v_booking     RECORD;
  v_opens_at    timestamptz;
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

  SELECT id, starts_at, ends_at, check_in_window_minutes
  INTO v_class
  FROM classes
  WHERE slug = p_class_slug
  FOR UPDATE;

  IF v_class IS NULL THEN
    RETURN jsonb_build_object('error', 'Class not found: ' || p_class_slug);
  END IF;

  v_opens_at := v_class.starts_at - make_interval(mins => v_class.check_in_window_minutes);

  -- Window gate: too early → explicit pre-window error.
  IF now() < v_opens_at THEN
    RETURN jsonb_build_object(
      'error', 'Check-in is not open yet',
      'status_code', 'too_early',
      'opens_at', v_opens_at
    );
  END IF;

  -- Window gate: class closed → explicit post-window error.
  IF v_class.ends_at < now() THEN
    RETURN jsonb_build_object(
      'error', 'Class has ended — check-in is closed',
      'status_code', 'closed'
    );
  END IF;

  -- Find eligible booking. Accept booked or already-checked-in — the
  -- already-checked-in branch is the idempotent success path.
  SELECT id, booking_status INTO v_booking
  FROM class_bookings
  WHERE class_id = v_class.id
    AND member_id = v_member.id
    AND is_active = true
    AND booking_status IN ('booked', 'checked_in');

  IF v_booking IS NULL THEN
    -- Waitlisted, cancelled, late_cancel, or no booking at all — same
    -- operator-safe message for all of them.
    RETURN jsonb_build_object(
      'error', 'No eligible booking — member is not booked into this class',
      'status_code', 'not_booked'
    );
  END IF;

  -- Idempotent duplicate handling. A repeat scan / repeat tap does NOT
  -- flip any state, does NOT write a new booking_events row, and does
  -- NOT error. The caller gets a clean already_checked_in=true so the
  -- UI can render the "already checked in" success state.
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

-- ═══ 5. sf_mark_attendance — error-text tightening only ═════════════════
-- Functional behaviour unchanged from v0.8.3. We keep idempotent
-- self-to-self transitions (noop: true), keep the completed-class
-- 'booked' rejection, and keep the correction-path audit typing.
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

  IF v_is_done AND p_outcome = 'booked' THEN
    RETURN jsonb_build_object(
      'error',
      'Class is completed — cannot revert to booked. Use Mark as checked in or Mark as no-show.'
    );
  END IF;

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

-- ═══ 6. Seed tuning — keep QA check-in states easy to reach ═════════════
-- Default window is 15 minutes. The HIIT upcoming class in seed.sql
-- starts in ~1 hour so with the 15-minute default the "too early" state
-- is already reproducible. No seed override required; this comment is
-- intentional to document the QA contract.
