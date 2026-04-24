-- v0.14.1 Plan Builder Guardrails + Operator-Safe Creation.
--
-- Adds:
--   1. `plans.active` boolean column (default true). Operator-facing
--      purchase surfaces (member home PlansSection) filter to
--      active=true; historical purchase resolution (member-detail
--      Purchase history) still sees inactive rows so a de-listed plan
--      keeps its name on old purchases instead of degrading to a raw id.
--   2. Deactivate the QA-created `5classpass` row (€2,000 for 5 credits
--      — obviously a mistake during v0.14.0 smoke-test). The row stays
--      in the table for purchase-history resolution; it just can't be
--      bought any more.
--
-- Does NOT touch:
--   - plans.(id, name, type, price_cents, credits, created_at) — same
--   - sf_apply_purchase — unchanged
--   - members / purchases / credit_transactions / classes / bookings
--   - RLS — no new policies in this phase (no auth layer yet)
--
-- Idempotent: safe to re-apply. ADD COLUMN IF NOT EXISTS + UPDATE is
-- safe on a repeat run.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Targeted cleanup of the abnormal QA row. No other rows deactivated.
UPDATE plans SET active = false WHERE id = '5classpass';
