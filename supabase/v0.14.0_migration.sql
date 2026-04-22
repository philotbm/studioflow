-- v0.14.0 Plan Catalogue + Purchase Truth Foundation.
--
-- Adds:
--   1. `plans` table — the canonical plan catalogue. Purchases reference
--      a row here by plan_id; entitlements are derived from the plan
--      record at fulfillment time (not from an in-code constant).
--   2. Seed of the three plans that existed as the PLAN_OPTIONS array
--      in src/lib/plans.ts up to v0.13.4 (pack_5, pack_10,
--      unlimited_monthly). Keeps all existing purchase rows coherent —
--      their plan_id values already reference these ids.
--   3. A relaxed sf_apply_purchase that also accepts 'class_pack' as
--      p_plan_type (alongside the existing 'credit_pack'). The new
--      plans table uses 'class_pack' to match members.plan_type; the
--      old term is kept working so old rows and in-flight callers
--      don't break while the TS layer is migrating.
--
-- Does NOT touch:
--   - members table schema (unchanged — plan_type / plan_name /
--     credits_remaining remain the render-time truth for the member
--     page; they are written by sf_apply_purchase from the plan record).
--   - purchases table schema. Its existing plan_id text column is kept;
--     we do NOT add a FK yet so that old fake_* rows that reference
--     legacy plan ids survive a future catalogue edit.
--   - booking / cancellation / waitlist / attendance / eligibility /
--     check-in / sweep functions or v_members_with_access.
--
-- Idempotent: safe to re-apply. CREATE TABLE IF NOT EXISTS +
-- INSERT ... ON CONFLICT DO NOTHING + CREATE OR REPLACE FUNCTION.

CREATE TABLE IF NOT EXISTS plans (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  type         text NOT NULL CHECK (type IN ('class_pack', 'unlimited')),
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  credits      integer CHECK (credits IS NULL OR credits > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Data-integrity guard: a class_pack plan MUST specify credits, and
  -- an unlimited plan MUST NOT. The CHECK above allows credits to be
  -- NULL for unlimited; this second CHECK ties credits to type.
  CONSTRAINT plans_type_credits_coherent CHECK (
    (type = 'class_pack' AND credits IS NOT NULL)
    OR
    (type = 'unlimited' AND credits IS NULL)
  )
);

INSERT INTO plans (id, name, type, price_cents, credits)
VALUES
  ('pack_5',            '5-Class Pass',      'class_pack', 5000,  5),
  ('pack_10',           '10-Class Pass',     'class_pack', 9000,  10),
  ('unlimited_monthly', 'Unlimited Monthly', 'unlimited',  12000, NULL)
ON CONFLICT (id) DO NOTHING;

-- Broad read access for anon/auth is required so the client-side store
-- can hydrate plans the same way it hydrates classes/members. No RLS
-- needed in this phase — StudioFlow has no auth layer yet.
GRANT SELECT ON plans TO anon, authenticated;

-- sf_apply_purchase: updated to accept 'class_pack' alongside the
-- legacy 'credit_pack' term. Any caller passing either value maps onto
-- the same members.plan_type = 'class_pack' write. Everything else
-- about this function is unchanged from v0.13.0.
CREATE OR REPLACE FUNCTION sf_apply_purchase(
  p_member_id   uuid,
  p_plan_id     text,
  p_plan_type   text,
  p_plan_name   text,
  p_credits     integer,
  p_source      text,
  p_external_id text
)
RETURNS jsonb LANGUAGE plpgsql AS $func$
DECLARE
  v_purchase_id  uuid;
  v_new_credits  integer;
BEGIN
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

  IF p_plan_type IN ('credit_pack', 'class_pack') THEN
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
    DELETE FROM purchases WHERE id = v_purchase_id;
    RAISE EXCEPTION 'sf_apply_purchase: unknown plan_type %', p_plan_type;
  END IF;
END;
$func$;
