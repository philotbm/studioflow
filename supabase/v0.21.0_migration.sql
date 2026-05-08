-- v0.21.0 Operator + Instructor Auth (RBAC).
--
-- Adds the `staff` table that backs M2's role gates. Three roles:
--
--   owner       — Full operator access. Can do anything a manager can,
--                 plus owner-only actions added by later milestones
--                 (refunds-for-owner-only, etc., when those gates land).
--   manager     — Operator access. Reaches /app/*, /instructor/*, and
--                 /api/admin/* in v0.21.0.
--   instructor  — Reaches /instructor/* only. No /app/*, no admin APIs.
--
-- Authentication is the existing Supabase magic-link flow shared with
-- members; differentiation happens at login surface choice (/login vs.
-- /staff/login) and at the gate (auth.uid() ↔ staff.user_id).
--
-- Multi-tenancy comes in M3, which will add `studio_id` and replace
-- the UNIQUE(user_id) index with UNIQUE(studio_id, user_id) — same
-- pattern members already follow. Do not pre-add studio_id here.
--
-- RLS is deliberately limited to a self-read policy on `staff` so the
-- proxy's session-bound supabase client (anon role) can resolve the
-- caller's role without the service role key. Tenant + manager/owner
-- policies land in M4 alongside RLS for the rest of the schema.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT
-- EXISTS, DROP POLICY IF EXISTS / CREATE POLICY. Safe to re-apply.
--
-- Out of scope (handled later):
--   - studio_id multi-tenancy (M3).
--   - Tenant + manager/owner RLS policies (M4).
--   - Granular per-feature roles beyond owner/manager/instructor.
--   - Operator self-service signup or invite flow.

CREATE TABLE IF NOT EXISTS staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  full_name   text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner','manager','instructor')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One staff row per auth user. M3 will drop this and replace with
-- UNIQUE(studio_id, user_id) so the same person can hold a staff role
-- at multiple studios.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_user_id ON staff(user_id);

-- RLS: only the row whose user_id matches auth.uid() is readable. The
-- proxy and getCurrentStaffFromCookies() both run as the user's own
-- session (anon role), so this policy is what lets them resolve the
-- caller's role. M4 will add manager/owner read policies for the
-- /app/members staff-list views, and per-tenant scoping.
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff can read self" ON staff;
CREATE POLICY "staff can read self" ON staff
  FOR SELECT USING (user_id = auth.uid());
