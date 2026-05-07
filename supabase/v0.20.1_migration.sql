-- v0.20.1 Member self-claim flow.
--
-- Adds two columns to support the phone-last-4 challenge introduced
-- in /auth/claim:
--
--   claim_attempts      — count of consecutive wrong-digit submissions
--                         since the last successful claim or the last
--                         lockout reset. Reset on success and when a
--                         lockout is set (a fresh 1h window starts then).
--   claim_locked_until  — when set in the future, /auth/claim refuses
--                         to evaluate digits for this row and tells
--                         the user to contact their studio. Studio
--                         admins can clear this manually via SQL if
--                         a real user gets locked out and identity
--                         is confirmed out-of-band.
--
-- Both columns are additive, idempotent, and untouched by every
-- existing query — sf_book_member, the Stripe webhook, /api/admin/*,
-- the v_members_with_access view, etc. all keep working.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-apply.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS claim_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_locked_until timestamptz;
