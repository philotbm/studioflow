-- v0.9.4.1 Booking Truth Simplification migration.
--
-- Removes account-status as an access gate in sf_check_eligibility.
-- Account status (members.status: active/paused/inactive) is not yet a
-- designed StudioFlow product concept — it was leaking into booking
-- eligibility via the inactive-override branch, and v0.9.4.1 removes
-- that leak at the source.
--
-- Booking truth for this phase is entitlement only:
--   unlimited plan                 → can book
--   positive credits (pack/trial)  → can book
--   otherwise                      → cannot book
--
-- Idempotent — CREATE OR REPLACE FUNCTION replaces any prior definition.
-- Safe to re-apply.

CREATE OR REPLACE FUNCTION sf_check_eligibility(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_member RECORD;
BEGIN
  SELECT id, plan_type, plan_name, credits_remaining
  INTO v_member FROM members WHERE id = p_member_id;

  IF v_member IS NULL THEN
    RETURN jsonb_build_object(
      'can_book', false,
      'reason', 'Member not found',
      'entitlement_label', 'Unknown',
      'credits_remaining', NULL,
      'action_hint', 'Member record missing',
      'status_code', 'not_found'
    );
  END IF;

  -- Unlimited
  IF v_member.plan_type = 'unlimited' THEN
    RETURN jsonb_build_object(
      'can_book', true,
      'reason', 'Unlimited access',
      'entitlement_label', 'Unlimited',
      'credits_remaining', NULL,
      'action_hint', 'Member can book any class',
      'status_code', 'ok'
    );
  END IF;

  -- Class pack
  IF v_member.plan_type = 'class_pack' THEN
    IF COALESCE(v_member.credits_remaining, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'can_book', false,
        'reason', 'No credits remaining',
        'entitlement_label', v_member.plan_name || ' (0 left)',
        'credits_remaining', 0,
        'action_hint', 'Sell a new class pack or adjust credits manually',
        'status_code', 'no_credits'
      );
    END IF;
    RETURN jsonb_build_object(
      'can_book', true,
      'reason', CASE WHEN v_member.credits_remaining = 1
                     THEN '1 credit remaining — last class on this pack'
                     ELSE v_member.credits_remaining || ' credits remaining' END,
      'entitlement_label', 'Class pack (' || v_member.credits_remaining || ' left)',
      'credits_remaining', v_member.credits_remaining,
      'action_hint', CASE WHEN v_member.credits_remaining = 1
                          THEN 'Offer a renewal after this booking'
                          ELSE 'Member can book a class' END,
      'status_code', 'ok'
    );
  END IF;

  -- Trial
  IF v_member.plan_type = 'trial' THEN
    IF COALESCE(v_member.credits_remaining, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'can_book', false,
        'reason', 'Trial used up',
        'entitlement_label', 'Trial (0 left)',
        'credits_remaining', 0,
        'action_hint', 'Convert trial to a full plan to book again',
        'status_code', 'trial_used'
      );
    END IF;
    RETURN jsonb_build_object(
      'can_book', true,
      'reason', 'Trial entitlement active',
      'entitlement_label', 'Trial (' || v_member.credits_remaining || ' left)',
      'credits_remaining', v_member.credits_remaining,
      'action_hint', 'Follow up after class to convert',
      'status_code', 'ok'
    );
  END IF;

  -- Drop-in / unknown
  RETURN jsonb_build_object(
    'can_book', false,
    'reason', 'No active entitlement',
    'entitlement_label', 'Drop-in',
    'credits_remaining', v_member.credits_remaining,
    'action_hint', 'Member needs a plan or credit pack before booking',
    'status_code', 'no_entitlement'
  );
END;
$$;
