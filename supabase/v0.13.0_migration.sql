-- v0.13.0 Stripe Checkout + Entitlement Sync migration.
--
-- Adds:
--   1. `purchases` table — minimal idempotent log. One row per
--      fulfilled Stripe Checkout session OR dev-fake purchase call.
--      The UNIQUE(external_id) constraint is the idempotency guard.
--   2. `sf_apply_purchase(...)` RPC — the atomic fulfillment entry
--      point. Called by both /api/stripe/webhook and /api/dev/fake-
--      purchase via the shared TS `applyPurchase` wrapper.
--
-- Does NOT touch:
--   - members table schema (only data updates — credits_remaining,
--     plan_type, plan_name, updated_at).
--   - class_bookings / booking_events / classes / credit_transactions
--     tables or any existing sf_* booking / cancellation / waitlist /
--     attendance / eligibility function.
--   - v_members_with_access view.
--
-- Idempotent: safe to re-apply. CREATE TABLE IF NOT EXISTS + CREATE OR
-- REPLACE FUNCTION.

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('stripe', 'fake')),
  external_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_id)
);

CREATE INDEX IF NOT EXISTS idx_purchases_member_created
  ON purchases (member_id, created_at DESC);

-- sf_apply_purchase: atomic, idempotent fulfillment.
--
-- Input:
--   p_member_id      uuid    — the resolved member row id.
--   p_plan_id        text    — PlanOption.id from src/lib/plans.ts.
--   p_plan_type      text    — 'credit_pack' | 'unlimited'.
--   p_plan_name      text    — human-readable name; written to members.plan_name.
--   p_credits        integer — credits to ADD for credit_pack; ignored for unlimited.
--   p_source         text    — 'stripe' | 'fake'.
--   p_external_id    text    — Stripe Checkout session id OR fake_<ts>_<rand>.
--
-- Output JSON:
--   { ok: true, already_processed: bool, purchase_id: uuid | null,
--     plan_type_applied: 'class_pack' | 'unlimited' | null,
--     credits_remaining: integer | null, external_id: text }
--
-- Idempotency: the UNIQUE(external_id) constraint on `purchases` is
-- the single source of truth. A repeat insert fires unique_violation
-- which we catch and return as already_processed=true with NO mutation
-- to the members row. That means Stripe webhook retries are safe.
--
-- Race safety: the members UPDATE uses
-- `credits_remaining = COALESCE(credits_remaining, 0) + p_credits`
-- rather than read-modify-write in TypeScript, so a booking that
-- decrements credits between fulfillment check and update cannot
-- overwrite the purchase amount.
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
  v_purchase_id  uuid;
  v_new_credits  integer;
BEGIN
  -- Idempotency guard: attempt the log insert first.
  BEGIN
    INSERT INTO purchases (member_id, plan_id, source, external_id)
    VALUES (p_member_id, p_plan_id, p_source, p_external_id)
    RETURNING id INTO v_purchase_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'external_id', p_external_id
    );
  END;

  IF p_plan_type = 'credit_pack' THEN
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
  ELSIF p_plan_type = 'unlimited' THEN
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
    -- Unknown plan_type — undo the log insert so the caller can retry
    -- once the plan catalogue is fixed.
    DELETE FROM purchases WHERE id = v_purchase_id;
    RAISE EXCEPTION 'sf_apply_purchase: unknown plan_type %', p_plan_type;
  END IF;
END;
$$;
