-- v0.15.3 Legacy Purchase Cleanup
--
-- One-time, idempotent backfill of the two known post-cutoff legacy
-- 'fake' rows on `purchases`. These rows were created during the
-- v0.15.1 silent-fallback window on 2026-04-27 — both belong to
-- emma-kelly, both reference the pack_5 plan, and both currently
-- carry source='fake' with NULL price_cents_paid and NULL
-- credits_granted. /api/admin/purchase-health flags them under
-- suspicious_fake_post_release and incomplete_completed_rows.
--
-- This migration:
--   - Updates ONLY the two named external_ids.
--   - Preserves id, member_id, plan_id, external_id, created_at.
--   - Sets source = the canonical value the row was meant to carry
--     ('operator_manual' for the op_* row, 'dev_fake' for the
--     fake_* row).
--   - Sets status = 'completed' (it already is on both, but we set
--     it to make the post-state explicit and not depend on the
--     column DEFAULT for the audit trail).
--   - Sets price_cents_paid + credits_granted from the live `plans`
--     row resolved at cleanup time. The plan_id is text on
--     purchases (no FK), so this is a value lookup. Both rows
--     reference pack_5; reading the live plan keeps the cleanup
--     correct under any future plan-price edits.
--   - Does NOT mutate members.credits_remaining (Emma's 15 credits
--     are derived from the original three apply-purchase calls,
--     not from these rows' economics fields, and the brief is
--     explicit: leave entitlement state alone).
--   - Does NOT insert into credit_transactions.
--   - Does NOT touch any other purchase row.
--
-- Pre-flight guards (the entire DO block is one transaction; any
-- guard failure RAISES EXCEPTION and rolls back):
--   - Both target external_ids must exist.
--   - Each target row must have source='fake'.
--   - Each target row must have price_cents_paid IS NULL OR
--     credits_granted IS NULL.
--
-- Idempotency: re-running after a successful application is a
-- no-op — the source guard ('fake') and the NULL-economics guard
-- both fail because the row is now correctly stamped, and the
-- DO block raises so a stale re-run cannot silently rewrite a
-- post-cleanup row's source.

DO $$
DECLARE
  v_op_row     RECORD;
  v_fake_row   RECORD;
  v_op_plan    RECORD;
  v_fake_plan  RECORD;
  v_op_ext     constant text := 'op_1777300464902_1tbnrkz2';
  v_fake_ext   constant text := 'fake_1777298367579_1f0fbmee';
BEGIN
  ----------------------------------------------------------------
  -- 1. Lookup target rows. Fail loudly if either is missing.
  ----------------------------------------------------------------
  SELECT id, member_id, plan_id, source, status,
         price_cents_paid, credits_granted, created_at
    INTO v_op_row
    FROM purchases
    WHERE external_id = v_op_ext;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'v0.15.3 cleanup: target row missing: %', v_op_ext;
  END IF;

  SELECT id, member_id, plan_id, source, status,
         price_cents_paid, credits_granted, created_at
    INTO v_fake_row
    FROM purchases
    WHERE external_id = v_fake_ext;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'v0.15.3 cleanup: target row missing: %', v_fake_ext;
  END IF;

  ----------------------------------------------------------------
  -- 2. Pre-flight assertions.
  ----------------------------------------------------------------
  IF v_op_row.source <> 'fake' THEN
    RAISE EXCEPTION
      'v0.15.3 cleanup: % source=%, expected fake (already cleaned?)',
      v_op_ext, v_op_row.source;
  END IF;
  IF v_fake_row.source <> 'fake' THEN
    RAISE EXCEPTION
      'v0.15.3 cleanup: % source=%, expected fake (already cleaned?)',
      v_fake_ext, v_fake_row.source;
  END IF;
  IF v_op_row.price_cents_paid IS NOT NULL
     AND v_op_row.credits_granted IS NOT NULL THEN
    RAISE EXCEPTION
      'v0.15.3 cleanup: % already has both economics fields populated',
      v_op_ext;
  END IF;
  IF v_fake_row.price_cents_paid IS NOT NULL
     AND v_fake_row.credits_granted IS NOT NULL THEN
    RAISE EXCEPTION
      'v0.15.3 cleanup: % already has both economics fields populated',
      v_fake_ext;
  END IF;

  ----------------------------------------------------------------
  -- 3. Resolve plan economics from the live `plans` row.
  ----------------------------------------------------------------
  SELECT id, price_cents, credits, type
    INTO v_op_plan
    FROM plans
    WHERE id = v_op_row.plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'v0.15.3 cleanup: plan not found for %: plan_id=%',
      v_op_ext, v_op_row.plan_id;
  END IF;

  SELECT id, price_cents, credits, type
    INTO v_fake_plan
    FROM plans
    WHERE id = v_fake_row.plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'v0.15.3 cleanup: plan not found for %: plan_id=%',
      v_fake_ext, v_fake_row.plan_id;
  END IF;

  ----------------------------------------------------------------
  -- 4. Apply the cleanup. Each UPDATE re-asserts the source and
  --    NULL-economics guards in its WHERE so a concurrent rewrite
  --    cannot slip through. NOT FOUND from either UPDATE is a
  --    fatal inconsistency — the lookup at step 1 saw the guard
  --    pass, so anything else changed the row underneath us.
  ----------------------------------------------------------------
  UPDATE purchases
    SET source = 'operator_manual',
        status = 'completed',
        price_cents_paid = v_op_plan.price_cents,
        credits_granted  = CASE
          WHEN v_op_plan.type = 'unlimited' THEN NULL
          ELSE v_op_plan.credits
        END
    WHERE external_id = v_op_ext
      AND source = 'fake'
      AND (price_cents_paid IS NULL OR credits_granted IS NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'v0.15.3 cleanup: UPDATE for % did not match expected guard',
      v_op_ext;
  END IF;

  UPDATE purchases
    SET source = 'dev_fake',
        status = 'completed',
        price_cents_paid = v_fake_plan.price_cents,
        credits_granted  = CASE
          WHEN v_fake_plan.type = 'unlimited' THEN NULL
          ELSE v_fake_plan.credits
        END
    WHERE external_id = v_fake_ext
      AND source = 'fake'
      AND (price_cents_paid IS NULL OR credits_granted IS NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'v0.15.3 cleanup: UPDATE for % did not match expected guard',
      v_fake_ext;
  END IF;

  RAISE NOTICE 'v0.15.3 cleanup: 2 rows updated';
END $$;

----------------------------------------------------------------
-- Audit: post-state of the two cleaned rows. Run alongside the
-- DO block so the SQL Editor result panel shows the new values
-- ready to paste back into the release report.
----------------------------------------------------------------
SELECT id, external_id, plan_id, source, status,
       price_cents_paid, credits_granted, created_at
  FROM purchases
  WHERE external_id IN (
    'op_1777300464902_1tbnrkz2',
    'fake_1777298367579_1f0fbmee'
  )
  ORDER BY created_at;
