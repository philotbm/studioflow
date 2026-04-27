-- v0.15.0 Purchase Lifecycle Foundation.
--
-- Adds clear lifecycle fields to the purchases table and replaces
-- sf_apply_purchase IN PLACE (same 7-arg signature) so live behaviour
-- doesn't change while the row schema gains structure for future
-- refund / dispute / status flows. No Stripe code paths change
-- behaviour: the Stripe webhook, the dev fake-purchase route, and the
-- operator test-purchase panel all flow through the same applyPurchase
-- wrapper. Only the recorded `source` distinguishes them in history.
--
-- Adds:
--   1. purchases.status                — completed | failed | refunded |
--                                        cancelled. Default 'completed'
--                                        because every existing row is a
--                                        successful fulfilment.
--   2. purchases.price_cents_paid      — frozen at apply time so purchase
--                                        history reflects the amount the
--                                        member actually paid, regardless
--                                        of subsequent plan-price edits.
--                                        Nullable on legacy pre-v0.15.0
--                                        rows (no value to backfill).
--   3. purchases.credits_granted       — frozen at apply time. Nullable
--                                        on unlimited and legacy rows.
--   4. purchases_source_check widened  — adds 'dev_fake' (member-home
--                                        self-serve fallback when Stripe
--                                        isn't configured) and
--                                        'operator_manual' (operator
--                                        test-purchase panel). Legacy
--                                        'fake' stays valid so historical
--                                        rows continue to validate.
--   5. sf_apply_purchase replaced      — same 7-arg signature. Body
--                                        normalises 'credit_pack' (the
--                                        v0.13.0 alias the original
--                                        wrapper passed) to 'class_pack',
--                                        so a stale caller never falls
--                                        through to RAISE EXCEPTION.
--                                        Lifecycle columns stay NULL on
--                                        the function-side INSERT;
--                                        applyPurchase enriches them in
--                                        a follow-up UPDATE so the
--                                        function signature is stable.
--
-- Does NOT touch:
--   - members / classes / class_bookings / booking_events
--   - credit_transactions
--   - plans
--   - any other sf_* function
--   - UNIQUE(external_id) idempotency guard (still the only dedup truth)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS,
-- CREATE OR REPLACE FUNCTION. Safe to re-apply.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';

ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE purchases
  ADD CONSTRAINT purchases_status_check
    CHECK (status IN ('completed', 'failed', 'refunded', 'cancelled'));

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS price_cents_paid integer;
ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_price_cents_paid_check;
ALTER TABLE purchases
  ADD CONSTRAINT purchases_price_cents_paid_check
    CHECK (price_cents_paid IS NULL OR price_cents_paid >= 0);

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS credits_granted integer;
ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_credits_granted_check;
ALTER TABLE purchases
  ADD CONSTRAINT purchases_credits_granted_check
    CHECK (credits_granted IS NULL OR credits_granted >= 0);

ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_source_check;
ALTER TABLE purchases
  ADD CONSTRAINT purchases_source_check
    CHECK (source IN ('stripe', 'fake', 'dev_fake', 'operator_manual'));

-- sf_apply_purchase: signature unchanged (7 args). Body normalises the
-- legacy 'credit_pack' input to 'class_pack' so a v0.13.0-wrapper-style
-- caller can never fall through to the RAISE EXCEPTION path. Lifecycle
-- columns are not written here — applyPurchase does a follow-up UPDATE
-- on the returned purchase_id row, so this function stays decoupled
-- from the row schema and a future schema change won't require a
-- function rebuild.
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
  v_purchase_id     uuid;
  v_new_credits     integer;
  v_normalised_type text;
BEGIN
  v_normalised_type := CASE p_plan_type
    WHEN 'credit_pack' THEN 'class_pack'
    ELSE p_plan_type
  END;

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
    -- Unknown plan_type — undo the log insert so the caller can retry
    -- once the catalogue is fixed.
    DELETE FROM purchases WHERE id = v_purchase_id;
    RAISE EXCEPTION 'sf_apply_purchase: unknown plan_type %', p_plan_type;
  END IF;
END;
$$;
