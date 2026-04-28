-- v0.16.0 Purchase Refund Foundation.
--
-- Adds the sf_refund_purchase RPC. Idempotent — CREATE OR REPLACE
-- so re-running just rebuilds the function. No schema change to any
-- table; reuses the v0.15.0 purchases.status='refunded' value that's
-- already part of the lifecycle CHECK.
--
-- Behaviour:
--   - Fetch + lock the purchase row.
--   - Missing → { ok:false, code:'not_found' }.
--   - Status != 'completed' → { ok:true, already_refunded:true }
--     (idempotent: a duplicate call after a successful refund is a
--     clean no-op success, not an error).
--   - Resolve plan from `plans` by plan_id (text, no FK). Missing →
--     { ok:false, code:'plan_not_found' }.
--   - Class-pack only. Unlimited refunds are deferred — they would
--     need a different model (status flip on the members row plus
--     grace-period semantics) and aren't part of v0.16.0.
--   - credits_granted must be non-NULL. Pre-v0.15.0 legacy rows can
--     have NULL here; we don't know how many credits to take back,
--     so we refuse rather than guess.
--   - members.credits_remaining must be >= credits_granted. If the
--     member has already used some of the refunded credits, refusing
--     is the safer default — clamping to 0 would mean the ledger
--     delta no longer matches the purchase amount, breaking the
--     ledger-as-truth invariant.
--
-- Transactional sequence inside the function (one txn implicitly,
-- since this is a single PL/pgSQL invocation):
--   1. UPDATE purchases SET status='refunded' WHERE id = p_purchase_id
--   2. UPDATE members SET credits_remaining -= credits_granted
--   3. INSERT credit_transactions (delta=-credits_granted,
--      reason_code='purchase_refund', source='system',
--      note='Refund of purchase <external_id>')
--
-- Concurrency: the purchases row is locked with FOR UPDATE before
-- any state change. Two concurrent refund calls serialise — the
-- second one wakes after the first commits, sees status='refunded',
-- and returns already_refunded:true.
--
-- Does NOT:
--   - Refund Stripe (no money movement; this is a credit reversal).
--   - Touch class_bookings (a refunded purchase doesn't unbook
--     classes; the operator handles that separately if needed).
--   - Send email or any side effect outside DB state.

CREATE OR REPLACE FUNCTION sf_refund_purchase(p_purchase_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_purchase     RECORD;
  v_plan         RECORD;
  v_balance      integer;
  v_new_balance  integer;
  v_ledger_id    uuid;
BEGIN
  ----------------------------------------------------------------
  -- 1. Lookup + lock the purchase row.
  ----------------------------------------------------------------
  SELECT id, member_id, plan_id, source, status,
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

  ----------------------------------------------------------------
  -- 2. Idempotency: anything other than 'completed' is a no-op
  --    success. Covers status='refunded' (the typical case),
  --    'failed', 'cancelled'.
  ----------------------------------------------------------------
  IF v_purchase.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'status', v_purchase.status,
      'purchase_id', v_purchase.id
    );
  END IF;

  ----------------------------------------------------------------
  -- 3. Resolve plan. plan_id is text on purchases (no FK), so this
  --    is a value lookup. Inactive plans are still resolvable —
  --    refunding a plan that's been deactivated is fine.
  ----------------------------------------------------------------
  SELECT id, type, credits, price_cents
    INTO v_plan
    FROM plans
    WHERE id = v_purchase.plan_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'plan_not_found',
      'error', 'Plan not found for purchase: ' || v_purchase.plan_id
    );
  END IF;

  ----------------------------------------------------------------
  -- 4. v0.16.0 supports class_pack refunds only.
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 5. Need a recorded credits_granted to know how many credits
  --    to take back. Pre-v0.15.0 legacy rows can be NULL here.
  ----------------------------------------------------------------
  IF v_purchase.credits_granted IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'no_credits_granted_recorded',
      'error',
        'Purchase has no credits_granted recorded — '
        || 'cannot determine refund amount.'
    );
  END IF;

  ----------------------------------------------------------------
  -- 6. Lock the member row and read current balance. Refuse if
  --    the member has already burned some of the refunded credits.
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 7. Apply the refund. Order is: flip status, decrement balance,
  --    append ledger row (matches sf_consume_credit's order so the
  --    ledger always reads consistent with members.credits_remaining
  --    in any post-commit snapshot).
  ----------------------------------------------------------------
  UPDATE purchases
    SET status = 'refunded'
    WHERE id = v_purchase.id;

  UPDATE members
    SET credits_remaining = credits_remaining - v_purchase.credits_granted,
        updated_at = now()
    WHERE id = v_purchase.member_id
    RETURNING credits_remaining INTO v_new_balance;

  INSERT INTO credit_transactions (
    member_id, delta, balance_after, reason_code, source, note
  ) VALUES (
    v_purchase.member_id,
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
