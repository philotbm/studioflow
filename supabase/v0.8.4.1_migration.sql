-- StudioFlow v0.8.4.1 — Deterministic QA Fixtures + Temporal Test Control
--
-- Run this in the Supabase SQL Editor after v0.8.4_migration.sql. It is
-- fully idempotent — safe to re-run.
--
-- What this changes
-- =================
--
-- Production logic is untouched. This migration introduces a dedicated
-- QA fixture layer so live QA URLs always demonstrate their intended
-- state, independent of when they were last seeded.
--
-- 1. QA member rows (qa-alex, qa-blake, qa-casey)
--    Deterministic slugs, unlimited plan (so booking rules never
--    interfere with check-in tests). Inserted once; refresh does not
--    touch them after that.
--
-- 2. QA fixture class rows with deterministic slugs:
--      qa-too-early     — starts in the future, before the check-in window
--      qa-open          — in-window, fresh booked members ready to check in
--      qa-already-in    — in-window, one member is already checked_in so
--                         a tap on that row demonstrates the idempotent
--                         "You're already checked in" success path
--      qa-closed        — ended; fresh client check-in is blocked
--      qa-correction    — ended long ago; mixed checked_in/no_show state
--                         for testing the instructor correction path
--
-- 3. sf_refresh_qa_fixtures() — idempotent RPC that (re-)aligns every
--    QA fixture's starts_at/ends_at relative to now() and rewrites its
--    bookings into the expected state. Safe to call on every /qa page
--    load; the fixtures snap back to their documented state each time.
--    Non-QA classes and non-QA members are never touched.

-- ═══ 1. QA member seed ═════════════════════════════════════════════════
INSERT INTO members (
  id, slug, full_name, status, plan_type, plan_name,
  credits_remaining, insights_json, purchase_insights_json,
  opportunity_signals_json, history_summary_json
) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'qa-alex',  'QA Alex',
   'active', 'unlimited', 'QA Unlimited', NULL, '{}', '{}', '[]', '[]'),
  ('c0000000-0000-0000-0000-000000000002', 'qa-blake', 'QA Blake',
   'active', 'unlimited', 'QA Unlimited', NULL, '{}', '{}', '[]', '[]'),
  ('c0000000-0000-0000-0000-000000000003', 'qa-casey', 'QA Casey',
   'active', 'unlimited', 'QA Unlimited', NULL, '{}', '{}', '[]', '[]')
ON CONFLICT (id) DO NOTHING;

-- ═══ 2. QA fixture class seed (time columns are placeholders — the
--        refresh RPC is the authoritative writer of starts_at/ends_at) ═══
INSERT INTO classes (
  id, slug, title, instructor_name,
  starts_at, ends_at, capacity, location_name,
  cancellation_window_hours, check_in_window_minutes
) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'qa-too-early',
   'QA — Too Early', 'QA Staff',
   now() + interval '60 minutes', now() + interval '120 minutes',
   10, 'QA Studio', 24, 15),
  ('d0000000-0000-0000-0000-000000000002', 'qa-open',
   'QA — Check-in Open', 'QA Staff',
   now() - interval '5 minutes', now() + interval '55 minutes',
   10, 'QA Studio', 24, 15),
  ('d0000000-0000-0000-0000-000000000003', 'qa-already-in',
   'QA — Already Checked In', 'QA Staff',
   now() - interval '5 minutes', now() + interval '55 minutes',
   10, 'QA Studio', 24, 15),
  ('d0000000-0000-0000-0000-000000000004', 'qa-closed',
   'QA — Closed', 'QA Staff',
   now() - interval '90 minutes', now() - interval '30 minutes',
   10, 'QA Studio', 24, 15),
  ('d0000000-0000-0000-0000-000000000005', 'qa-correction',
   'QA — Correction Path', 'QA Staff',
   now() - interval '180 minutes', now() - interval '120 minutes',
   10, 'QA Studio', 24, 15)
ON CONFLICT (id) DO NOTHING;

-- ═══ 3. sf_refresh_qa_fixtures ═════════════════════════════════════════
-- Resets all QA fixture timings and bookings to the documented state.
--
-- Guarantees after one call:
--   qa-too-early     now < opens_at < starts_at (pre-window)
--     bookings: qa-alex, qa-blake (status=booked)
--   qa-open          opens_at < now < ends_at, class already started
--     bookings: qa-alex, qa-blake, qa-casey (status=booked)
--   qa-already-in    opens_at < now < ends_at, class already started
--     bookings: qa-alex (checked_in), qa-blake (booked)
--   qa-closed        now > ends_at
--     bookings: qa-alex (checked_in), qa-blake (no_show)
--   qa-correction    now > ends_at (ended a while ago)
--     bookings: qa-alex (checked_in), qa-blake (no_show),
--               qa-casey (checked_in)
--
-- The booking_events table is reset for these QA class ids on every
-- refresh so repeat QA cycles are not polluted by audit rows from
-- prior runs. This reset is scoped exclusively to QA fixture ids;
-- production class audit remains append-only.
CREATE OR REPLACE FUNCTION sf_refresh_qa_fixtures()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_now        timestamptz := now();
  v_qa_class   uuid[] := ARRAY[
    'd0000000-0000-0000-0000-000000000001'::uuid,
    'd0000000-0000-0000-0000-000000000002'::uuid,
    'd0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid,
    'd0000000-0000-0000-0000-000000000005'::uuid
  ];
  v_alex       uuid := 'c0000000-0000-0000-0000-000000000001';
  v_blake      uuid := 'c0000000-0000-0000-0000-000000000002';
  v_casey      uuid := 'c0000000-0000-0000-0000-000000000003';
BEGIN
  -- ── Re-align fixture timings relative to now() ──────────────────────
  UPDATE classes SET
    starts_at = v_now + interval '60 minutes',
    ends_at   = v_now + interval '120 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000001'; -- qa-too-early

  UPDATE classes SET
    starts_at = v_now - interval '5 minutes',
    ends_at   = v_now + interval '55 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000002'; -- qa-open

  UPDATE classes SET
    starts_at = v_now - interval '5 minutes',
    ends_at   = v_now + interval '55 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000003'; -- qa-already-in

  UPDATE classes SET
    starts_at = v_now - interval '90 minutes',
    ends_at   = v_now - interval '30 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000004'; -- qa-closed

  UPDATE classes SET
    starts_at = v_now - interval '180 minutes',
    ends_at   = v_now - interval '120 minutes',
    check_in_window_minutes = 15,
    updated_at = v_now
  WHERE id = 'd0000000-0000-0000-0000-000000000005'; -- qa-correction

  -- ── Wipe QA booking audit + bookings (scoped to QA ids only) ────────
  DELETE FROM booking_events WHERE class_id = ANY(v_qa_class);
  DELETE FROM class_bookings WHERE class_id = ANY(v_qa_class);

  -- ── qa-too-early: two booked members, no attendance signal ──────────
  INSERT INTO class_bookings (class_id, member_id, booking_status, is_active) VALUES
    ('d0000000-0000-0000-0000-000000000001', v_alex,  'booked', true),
    ('d0000000-0000-0000-0000-000000000001', v_blake, 'booked', true);

  -- ── qa-open: three booked members ready to check in ─────────────────
  INSERT INTO class_bookings (class_id, member_id, booking_status, is_active) VALUES
    ('d0000000-0000-0000-0000-000000000002', v_alex,  'booked', true),
    ('d0000000-0000-0000-0000-000000000002', v_blake, 'booked', true),
    ('d0000000-0000-0000-0000-000000000002', v_casey, 'booked', true);

  -- ── qa-already-in: qa-alex is pre-checked-in, qa-blake is booked ────
  INSERT INTO class_bookings (
    class_id, member_id, booking_status, checked_in_at, is_active
  ) VALUES
    ('d0000000-0000-0000-0000-000000000003', v_alex,  'checked_in', v_now, true),
    ('d0000000-0000-0000-0000-000000000003', v_blake, 'booked', NULL, true);

  -- Audit row for the pre-existing checked_in state so the class audit
  -- log is not empty on the operator view.
  INSERT INTO booking_events (
    class_id, member_id, booking_id, event_type, event_label, metadata
  )
  SELECT
    cb.class_id, cb.member_id, cb.id,
    'checked_in',
    'Checked in (qa_fixture)',
    jsonb_build_object('source', 'qa_fixture')
  FROM class_bookings cb
  WHERE cb.class_id = 'd0000000-0000-0000-0000-000000000003'
    AND cb.booking_status = 'checked_in';

  -- ── qa-closed: one checked_in, one no_show ──────────────────────────
  INSERT INTO class_bookings (
    class_id, member_id, booking_status, checked_in_at, is_active
  ) VALUES
    ('d0000000-0000-0000-0000-000000000004', v_alex,
     'checked_in', v_now - interval '75 minutes', true),
    ('d0000000-0000-0000-0000-000000000004', v_blake,
     'no_show', NULL, true);

  -- ── qa-correction: mixed state so the instructor correction path
  --    has something meaningful to flip ─────────────────────────────────
  INSERT INTO class_bookings (
    class_id, member_id, booking_status, checked_in_at, is_active
  ) VALUES
    ('d0000000-0000-0000-0000-000000000005', v_alex,
     'checked_in', v_now - interval '165 minutes', true),
    ('d0000000-0000-0000-0000-000000000005', v_blake,
     'no_show', NULL, true),
    ('d0000000-0000-0000-0000-000000000005', v_casey,
     'checked_in', v_now - interval '165 minutes', true);

  RETURN jsonb_build_object(
    'ok', true,
    'refreshed_at', v_now,
    'fixtures', jsonb_build_array(
      'qa-too-early', 'qa-open', 'qa-already-in', 'qa-closed', 'qa-correction'
    )
  );
END;
$$;
