-- v0.20.0 Member Authentication Foundation.
--
-- Adds members.user_id linking each member row to a row in auth.users.
-- The slug remains the public/display URL but is no longer the
-- credential — auth.uid() is. requireMemberAccess() in src/lib/auth.ts
-- looks up a member by slug and accepts the request only if user_id
-- matches the authenticated user.
--
-- Existing demo rows have user_id = NULL until claimed via magic-link
-- signup. Pre-production state: those rows simply stop being reachable
-- through /my/{slug} until a manual SQL UPDATE binds them to a real
-- auth.users row, or until a follow-up release ships an in-app claim
-- flow (deferred to v0.20.1; see docs/specs/m1-member-auth.md).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT
-- EXISTS. Safe to re-apply.
--
-- Out of scope (handled in M2/M3/M4):
--   - Operator / instructor auth (M2).
--   - studio_id multi-tenancy (M3).
--   - RLS enablement (M4).

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Partial unique index — at most one members row per auth user, while
-- still allowing multiple un-claimed rows (user_id IS NULL) to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_user_id
  ON members(user_id) WHERE user_id IS NOT NULL;
