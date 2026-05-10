# ADR-0001: Multi-Tenancy Architecture

**Status:** Accepted (2026-05-09, Phil)
**Date:** 2026-05-09
**Deciders:** Phil (founder, sole approver)
**Repo head at draft time:** `355c111` — v0.21.0 staff/RBAC merged + prod-verified 2026-05-08
**Target implementation version:** v0.22.0
**Committed location:** `docs/adr/0001-multi-tenancy.md`

---

## Context

StudioFlow today is a single-tenant codebase. There is no `studios` (or `tenants`) table, no `studio_id` column on any data row, and the entire application — schema, queries in `src/lib/db.ts` (~37 KB), Postgres RPCs in `supabase/functions.sql` (~49 KB), and the prod Supabase project — assumes one studio's worth of data. The 2026-05-07 audit and the 2026-05-08 plan both flag this as one of the three production blockers; M3 (this ADR's implementation) is the work that closes it.

Three forces shape the decision:

1. **Pilot timeline.** First studio onboarded ~2026-08-03 (≈12 weeks out). M3 must ship by week 4 (around 2026-06-01) to leave room for M4 RLS, the sellable track, and a buffer week. We cannot afford a multi-month re-platforming.
2. **Strategic intent: one auth profile, many studios.** A single `auth.users` row should eventually own *one `members` row per studio*, not one globally. A person who attends pilates at Studio A and yoga at Studio B is **one identity, two memberships**. This is a chosen differentiator vs. GloFox-style "each studio is an island" (per `studioflow_multistudio_intent.md`). Same principle applies to staff: one auth user can be `owner` at Studio A and `instructor` at Studio B in the future, although the v0.22.0 baseline only provisions for one.
3. **Pricing model is locked and tier-only, not metered.** Three EUR tiers — Starter €49 (≤50 active members), Pro €149 (≤250), Studio €299 (unlimited). No `usage_meter` table, no per-action billing, no per-feature gating. Tier + member-count cap is the only billing dimension. This *constrains the schema* — `studios` carries `plan_id` and `member_count_cap`, full stop.

Non-functional constraints worth stating up front:

- **Solo developer**, AI-assisted, target velocity ~1–2 minor versions per week. This biases toward a single big migration over a phased rollout — the rollout coordination cost is higher than the migration risk at this scale.
- **Pilot scale: 1–10 studios in 2026.** Choose for clarity, not scale. We can rearchitect for 100s of studios after first revenue, not before.
- **Ireland-only market**, GDPR applies. EU expansion deferred. Single Supabase project (EU region) for now; staging Supabase project lands separately as a hygiene chore (`chore/staging-env`, target v0.22.0.5).
- **No tests, no CI today.** CI baseline is a hygiene PR landing before M3 (`chore/ci-baseline`). M3 will be the first big PR running through it. **The migration must therefore be designed to be reviewable by reading, not by running** — small enough sub-steps that a careful diff review catches the bugs an integration test suite would otherwise catch.
- **RLS is currently OFF on data tables.** M4 (v0.23.0) turns it on. The M3 schema choices below have to leave M4 a clean job — RLS policies that filter by `studio_id` are trivial *if* `studio_id` is on every row and reachable from `auth.uid()` via a stable join. They're nightmarish if it isn't.

This ADR locks six decisions: (1) tenancy isolation model, (2) `studio_id` derivation per request, (3) multi-studio user identity, (4) Stripe webhook tenant resolution, (5) demo-data backfill, (6) whether to land a `scopedQuery` refactor as M2.5 *before* M3.

---

## Decision (summary, then expanded below)

1. **Single Postgres database, `studio_id` column on every tenant-scoped data row.** Reject schema-per-tenant.
2. **Derive `studio_id` per request from a `staff_studio_id` (or `member_studio_id`) lookup at session establishment**, cached in a Postgres helper function and read by RLS in M4. Defer JWT custom claim, defer subdomain routing, defer path-prefix routing.
3. **Drop `idx_members_user_id UNIQUE` and replace with `UNIQUE(studio_id, user_id)`.** Same shape on `staff`. One auth user, one row per studio per role-class, deliberate.
4. **Stripe webhook resolves tenant via `studios.stripe_customer_id`** (Stripe customer is per-studio, not per-member). Stripe Customer metadata carries `studio_id` as a defensive cross-check.
5. **Single-shot backfill of one `studios` row** ("Demo Studio", slug `demo`, `plan_id='studio'`, `member_count_cap=NULL`), then `UPDATE` every existing data table to set `studio_id` to that row. One transaction, one migration file.
6. **Yes, land `scopedQuery(studioId)` as M2.5 (`refactor/scoped-query`, ~v0.21.0.3) before M3.** It de-risks the M3 diff and gives CI a smaller change to fail on first.

---

## Decision detail

### Decision 1 — Tenancy isolation model

**Single Postgres database, `studio_id` column on every tenant-scoped data row.**

#### Options Considered

##### Option A: Single DB, `studio_id` column on every tenant-scoped table (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Low to medium |
| Migration risk | Medium (one big migration, but mechanical) |
| Cost | Single Supabase project, single Vercel project — no change |
| Scalability (pilot) | Excellent at 1–10 studios; adequate to ~1,000 |
| Ops burden | Low (one DB to back up, one to monitor) |
| RLS path to M4 | Clean — every policy is `studio_id = current_studio_id()` |
| Cross-studio analytics | Trivial (single SQL query) |
| Team familiarity | High — the team is one person who has been writing Supabase queries for months |

**Pros**
- Smallest delta from current code. Every change is mechanical: add `studio_id` column, add index, add filter to query, add RLS in M4.
- One backup story, one migration story, one Vercel env story. Solo dev wins.
- Cross-studio queries (admin reporting, future features) are first-class SQL.
- The action queue (`pending_actions`, `action_events`) is already designed to be per-studio rows; this fits.

**Cons**
- A bug that forgets `.eq('studio_id', X)` leaks data across tenants. Mitigated by RLS in M4 (the two layers of defense are why we're sequencing it this way) and by the `scopedQuery` helper in Decision 6.
- Noisy-neighbour scenarios at scale. Not a 2026 problem. Re-architect when one studio ≥ 30% of total load.

##### Option B: Schema-per-tenant (one Postgres schema per studio, identical structure)

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Migration risk | High (every schema change runs N times) |
| Cost | Same Supabase project initially |
| Scalability (pilot) | Worse than Option A at 1–10 (overhead of N schemas with zero rows) |
| Ops burden | High — schema migrations need a per-tenant runner |
| RLS path to M4 | Doesn't apply — isolation is by schema, not by row |
| Cross-studio analytics | Painful — `UNION ALL` across N schemas or a separate aggregation pipeline |
| Team familiarity | Low |

**Pros**
- Hard isolation between studios — a query in Studio A's connection physically cannot see Studio B's rows.
- Looks impressive in a sales conversation.

**Cons**
- Every migration runs `N` times. With 10 studios, every schema change is 10 migrations.
- Adding a new column means writing a per-tenant migration runner. We do not have one. We will not have time to build one well before pilot.
- Cross-studio cron jobs (the Vercel daily class-rebase) become "loop over schemas, switch search_path, run RPC, repeat" — fragile and hard to monitor.
- Supabase RLS, Realtime, and Auth all assume a single public schema. Schema-per-tenant fights the platform.

##### Option C: Database-per-tenant (one Supabase project per studio)

| Dimension | Assessment |
|---|---|
| Complexity | Very high |
| Migration risk | Very high |
| Cost | One Supabase project per studio (pricing math: free tier → $25/studio/mo at 250 members) |
| Scalability (pilot) | Worst at 1–10, would *break* the Pro tier economics |
| Ops burden | Very high |
| RLS path to M4 | Doesn't apply |
| Cross-studio analytics | Effectively impossible without an ETL layer |
| Team familiarity | Low |

**Pros**
- Maximum isolation, easy GDPR right-to-erasure (drop the project).

**Cons**
- Pricing math collapses. Pro tier is €149/mo; a per-studio Supabase Pro project at $25/mo plus the per-project overhead (auth, edge functions, SMTP) eats half the margin. This is a margin-death decision.
- Provisioning a new studio requires programmatic Supabase project creation. Out of scope.

#### Trade-off analysis

The decision is a function of how much we trust ourselves to put `studio_id` filters in the right places. Option B and Option C buy harder isolation by paying enormous migration- and ops-overhead — costs we cannot afford pre-pilot. Option A's risk (forgetting a `studio_id` filter) is mitigated by two complementary mechanisms: RLS in M4 (defense in depth at the database) and `scopedQuery` in Decision 6 (defense in depth at the application). Both layers are cheap; both layers can be added incrementally.

The "what if we get to 100 studios and noisy neighbours hurt us?" question has a clean answer: re-architect into Option C *only for the noisy neighbours*, leaving Option A for the long tail. This is the path Stripe, Linear, and Notion all took. It does not require pre-paying the Option C cost now.

#### Chosen: Option A — single DB, `studio_id` everywhere.

---

### Decision 2 — `studio_id` derivation per request

**Look up `studio_id` from `staff` or `members` at session establishment; expose via a `current_studio_id()` Postgres function for RLS use in M4. Defer JWT custom claims. Defer subdomain routing. Defer path-prefix routing.**

#### Options Considered

##### Option A: JWT custom claim, set at sign-in (what the plan v1 originally suggested)

Issuer (a Supabase Edge Function) reads the `staff`/`members` row, embeds `studio_id` in the access token. Every subsequent request carries it. RLS reads `auth.jwt() ->> 'studio_id'`.

- Pro: zero per-request DB lookup.
- Con: JWT contents can drift from DB state if a staff/member row is moved between studios. The token is good for ≤1 hour by default, but during that window a "removed from Studio A" instructor still has Studio A's `studio_id` claim. We'd need a token-rotation mechanism on every studio assignment change.
- Con: Setting custom claims on Supabase requires either a deploy-on-Auth-hook flow (still in beta on Supabase as of mid-2026) or a custom JWT signer, neither of which is solo-dev-cheap.
- Con: For the multi-studio future, a single JWT can only carry one `studio_id`. Switching studios mid-session would require a re-auth or a server-side studio-switch endpoint that mints a new JWT. Doable, but it pushes complexity into M3 that doesn't earn its keep at pilot scale.

##### Option B: Per-request DB lookup via stable Postgres function (chosen)

Add to `supabase/functions.sql`:

```sql
create or replace function current_studio_id() returns uuid
language sql stable security definer set search_path = public as $$
  -- For staff sessions, return their staff row's studio_id.
  -- For member sessions, return their member row's studio_id.
  -- For un-claimed/anon, return null.
  -- Multi-studio future: takes a parameter or uses a session GUC.
  select coalesce(
    (select studio_id from staff   where user_id = auth.uid() limit 1),
    (select studio_id from members where user_id = auth.uid() limit 1)
  );
$$;
```

This function is what RLS policies call in M4. It is also what `scopedQuery` calls server-side in TypeScript. Single source of truth for "what studio is the current user in?"

- Pro: Always consistent with DB state. No drift.
- Pro: Solo-dev-cheap — one PL/pgSQL function, no Auth hook deploys, no JWT rotation.
- Pro: Postgres caches per-row reads on staff/members within a transaction; cost is one extra `SELECT` per session.
- Pro: The multi-studio future is a clean change: extend the function to take a `studio_id` parameter or read a session GUC set by the application after a "switch studios" action.
- Con: One extra round-trip vs. JWT-claim. At pilot scale (~10 studios, low QPS), invisible. Re-evaluate at 100+ studios.

##### Option C: Subdomain routing (`acme.studioflow.ie` → studio "acme")

- Pro: Beautiful URLs; clear in the address bar.
- Con: Requires per-studio DNS, wildcard SSL, Vercel domain management for every studio. Solo-dev-expensive.
- Con: Conflicts with the "one user, many studios" intent — switching studios requires changing domains, which is a hard browser-level state break.
- **Explicit deferral**: not in M3, not in pilot. Revisit after first paying customer asks.

##### Option D: Path-prefix routing (`/s/{slug}/...`)

- Pro: No DNS work.
- Con: Touches every route file in `src/app/...`. The diff is enormous and adds zero functional value at pilot scale.
- Con: Conflicts with the existing routes — `/my/{member-slug}`, `/app`, `/instructor`, `/login`, `/staff/login` would all need rewrites.
- **Explicit deferral**: not in M3, not in pilot.

#### Chosen: Option B — `current_studio_id()` PL/pgSQL function reading from `staff` and `members`.

> **Open question (does not block ADR approval, but worth noting):** when one auth user is both `staff` of Studio A and a `member` of Studio B (Phil's case is *one* studio with both hats; the cross-studio version is a future possibility), `current_studio_id()` as written above prefers staff over member. That's a reasonable default — staff sessions imply the "operator view" — but the multi-studio future will need a session-scoped override (e.g. a `set_current_studio(uuid)` setter the app calls when the user switches between operator and member contexts). Add the setter when needed; do not pre-build it now.

---

### Decision 3 — Multi-studio user identity

**Drop `idx_members_user_id UNIQUE`. Add `studio_id NOT NULL REFERENCES studios(id)` to `members`. Add `UNIQUE(studio_id, user_id)`. Mirror exactly on `staff`.**

This is the load-bearing schema decision in the ADR. Get it wrong and the multi-studio strategic intent is dead until a v1.x rebuild.

#### Constraints

- One `auth.users` row may map to multiple `members` rows, **at most one per studio**.
- One `auth.users` row may map to multiple `staff` rows, **at most one per studio**.
- Email and phone identity remain on `members` (per-studio profile data — a member may use a different phone for Studio A vs Studio B). Email-as-login is `auth.users.email`; per-studio profile email is `members.email`. They may diverge; that is fine.
- The phone-last-4 claim challenge in v0.20.1 was chosen partly because it scales to "first studio claim" vs "fifth studio claim" — same flow, different studio context. M3 doesn't change the claim flow itself; it just means the "find my member row" lookup is now `(studio_id, email)`, not `(email)`.

#### Migration shape

```sql
-- Inside supabase/v0.22.0_migration.sql, in dependency order:

-- 1. Create studios with the demo row.
create table studios (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plan_id text not null default 'starter' check (plan_id in ('starter','pro','studio')),
  member_count_cap int,  -- nullable: 50 / 250 / NULL (unlimited)
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);
insert into studios (slug, name, plan_id, member_count_cap)
values ('demo', 'Demo Studio', 'studio', NULL);

-- 2. Add studio_id to every tenant-scoped table, default to demo studio
--    so the column can be NOT NULL on the same statement.
do $$
declare demo_id uuid := (select id from studios where slug = 'demo');
begin
  alter table members add column studio_id uuid not null
    default demo_id references studios(id);
  alter table members alter column studio_id drop default;
  -- Repeat for: staff, classes, bookings, waitlist,
  -- plans, credit_ledger, purchases, booking_events,
  -- pending_actions (post-Sprint D), action_events (post-Sprint D),
  -- and class_templates (post-Sprint A).
end $$;

-- 3. Drop and replace the unique indexes.
drop index if exists idx_members_user_id;
create unique index idx_members_studio_user
  on members(studio_id, user_id) where user_id is not null;

drop index if exists idx_staff_user_id;
create unique index idx_staff_studio_user
  on staff(studio_id, user_id);
```

Two notes on the index shape:

- `idx_members_studio_user` is a **partial** unique index (`WHERE user_id IS NOT NULL`) because un-claimed members have `user_id = NULL` and we don't want to block multiple un-claimed members per studio.
- `idx_staff_studio_user` is a **full** unique index — staff always have a user_id (no un-claimed staff exists).

#### Out of scope for this ADR

- A `user_profiles` table keyed by `user_id` for global per-user state (display name, avatar URL). Mentioned in `studioflow_multistudio_intent.md` as a *future* possibility. Not in M3; defer until a real cross-studio feature needs it.

---

### Decision 4 — Stripe webhook tenant resolution

**Two distinct Stripe Customer entities. Tenant resolution differs per event type.**

#### Disambiguation first

StudioFlow's Stripe usage has *two* customer-shaped entities, and they live at different layers:

- **SaaS-subscription customer** — the *studio* paying StudioFlow €49/€149/€299/mo. ID lives on `studios.stripe_customer_id` / `studios.stripe_subscription_id`. Created once per studio at signup. Owned by Sprint C (v0.26.0).
- **Class-purchase customer** — the *member* paying their studio for classes / packs / passes. ID lives wherever today's members/purchases code already puts it (likely `members.stripe_customer_id` or `purchases.stripe_customer_id`; confirm at PR draft). Created lazily, per-member-per-studio.

A single auth user could *in theory* be both: an owner of Studio A (SaaS sub customer) and a member of Studio B (class-purchase customer). Today they're never confused because the M3 schema gives them different rows in different tables.

#### Constraints

- Stripe webhook events do not carry application-level tenant identifiers natively.
- The webhook endpoint (`/api/stripe/webhook`) is the one correctly-secured endpoint (signature verification, raw-body handling, 503-on-misconfig); proxy gating is deliberately excluded and stays excluded.
- Today there is no `STRIPE_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` set on prod. Stripe production cutover is Sprint C (v0.26.0). **M3 lands the schema columns and the resolution policy; Sprint C wires the handler logic.**

#### Resolution policy (per event type)

- **Subscription / invoice events** (`customer.subscription.*`, `invoice.*`) — resolve to studio via `studios.stripe_customer_id = event.data.object.customer`. These are SaaS-side events.
- **PaymentIntent / Charge events for class purchases** (`payment_intent.succeeded` etc.) — resolve to studio via the *member's* `studio_id`, looked up from the member's stripe_customer_id. These are tenant-side events.
- **Customer.created / Customer.updated** — disambiguate by reading `metadata.kind`: `saas_subscription` vs `class_purchase`. Set this metadata on every Stripe Customer we create.

#### Cross-check via metadata

Set `metadata.studio_id` on every Stripe Customer at creation, regardless of kind. The webhook handler compares the resolved-studio against the metadata `studio_id`; on mismatch, log + 200 (don't 5xx — Stripe will retry forever) and raise a Sentry alert. Mismatches in normal operation should be zero; the most likely cause is a misconfigured webhook destination (e.g. test endpoint firing against prod), which the metadata cross-check makes obvious within seconds rather than hours.

#### Reject

- Webhook payload pattern-matching by email or amount. Wrong primitive — Stripe events don't carry the right data shape, and emails can collide between studios in the multi-studio future.
- Per-studio webhook endpoint (`/api/stripe/webhook/{studio_slug}`). Adds Stripe-side configuration burden per studio; the metadata path is just as safe and simpler to operate.

---

### Decision 5 — Backfill plan for the demo studio

**Single-shot, single migration file. One `studios` row inserted, every existing tenant-scoped table has `studio_id` set to that row's id via the `default` trick in Decision 3's migration shape.**

#### Constraints

- Prod has exactly one studio's data today.
- Prod migrations are applied manually via the Supabase SQL Editor (not auto-run on Vercel deploy). Per the v0.21.0 fresh-env gotcha (`studioflow_auth_state.md`), the M3 PR's "How to verify" section MUST flag this explicitly.
- The migration runs in a single transaction. If anything fails, nothing is applied.

#### Operational sequence

1. Push v0.22.0 PR. Tag the PR description with: **"Apply `supabase/v0.22.0_migration.sql` against prod Supabase BEFORE merging the PR's Vercel deploy."**
2. Phil opens Supabase SQL Editor, pastes the migration, runs it. Confirms `select count(*) from studios = 1` and `select count(*) from members where studio_id is null = 0`.
3. Merge PR. Vercel deploys the new code. New code expects every query to filter by `studio_id`; the migration's already in place; safe.
4. If anything looks wrong, the rollback is `truncate studios cascade` + drop the migration's columns. Cheap because the only studio is the demo studio.

#### Idempotency

The migration uses `IF NOT EXISTS` / `DROP ... IF EXISTS` / `ON CONFLICT DO NOTHING` throughout, so re-running it is safe. This pattern was proven on the v0.21.0 fresh-env cutover.

---

### Decision 6 — `scopedQuery` refactor as M2.5 *before* M3

**Yes. Land `refactor/scoped-query` as v0.21.0.3 between the hygiene chores and the M3 implementation. ~1–2 days of work, ~30% reduction in M3 diff size.**

#### What it is

A thin helper in `src/lib/db.ts` that wraps the Supabase client and auto-applies `studio_id` filters:

```ts
// src/lib/db.ts (M2.5 addition, before any studio_id columns exist)
type ScopedQueryClient = SupabaseClient; // identical API today

export async function scopedQuery(): Promise<ScopedQueryClient> {
  // M2.5: returns the existing client unchanged.
  // M3: returns a proxied client that auto-applies .eq('studio_id', current_studio_id())
  //     to .from(<tenant_scoped_table>) calls.
  return getSupabaseServerClient();
}
```

In M2.5 it's a pass-through. In M3 it becomes the place we add `.eq('studio_id', ...)`. **Every call site that queries a tenant-scoped table is migrated to call `scopedQuery()` instead of `getSupabaseServerClient()` in M2.5**, so M3's diff is "extend `scopedQuery` to filter," not "add `.eq('studio_id', ...)` in 47 places."

#### Why now, not in M3

- M3 is already the biggest PR of the year — ADR + new tables + every column on every tenant-scoped table + RLS prep. Adding ~47 call-site rewrites to that diff is the kind of thing that hides bugs in the noise.
- M2.5 has zero behaviour change. Easy to review, easy to revert. Lands the call-site mechanical rewrite in a low-risk PR; M3 only changes `scopedQuery`'s body.
- It also gives the M3 RLS migration in M4 a single place to add `set_config('app.current_studio_id', ...)` if we end up needing a session GUC later.

#### Why we shouldn't skip it entirely

- The alternative is a 47-place mechanical edit in M3. Code review fatigue is the bug-hiding mechanism we're most exposed to as a solo dev. Smaller PRs win.

#### Sequence

- v0.21.0.1: `chore/staff-server-action-guard` (~50 LOC, ticket already drafted)
- v0.21.0.2: `chore/observability` (Sentry + structured logging)
- v0.21.0.3: `refactor/scoped-query` (this — pass-through helper + 47 call-site renames)
- v0.22.0: M3 implementation (uses the helper; only adds the filter logic)

---

## Trade-off analysis (cross-cutting)

The single most important trade-off in this ADR is between **isolation strength** and **migration cost**. Option C (database-per-tenant) gives the strongest isolation but breaks pilot economics. Option B (schema-per-tenant) gives strong isolation but breaks solo-dev velocity. Option A (single DB + `studio_id` + RLS) gives the right isolation at the right cost — provided the application code is disciplined about applying `studio_id` filters. The `scopedQuery` helper (Decision 6) is the discipline mechanism, and M4's RLS is the safety net underneath it.

The second-most-important trade-off is **pre-bake vs YAGNI for multi-studio**. We could ship M3 with single-studio assumptions and rebuild for multi-studio when a real customer needs it. We are deliberately not doing that — `UNIQUE(studio_id, user_id)` instead of `UNIQUE(user_id)` is two extra characters in a constraint definition, but skipping it makes the M5+ identity work an order of magnitude harder. Pre-bake the multi-studio shape; the marginal cost is zero, and `studioflow_multistudio_intent.md` documents the intent as a strategic differentiator.

---

## Consequences

**What becomes easier:**
- Adding a second studio is now a `INSERT INTO studios ...` plus a CSV import, not a re-platforming.
- M4 (RLS) becomes a focused PR — each policy is a one-liner against `current_studio_id()`. No schema work, no application work beyond enabling RLS on the tables.
- Pricing enforcement (member-count cap at booking creation) has a clear home: read `studios.member_count_cap` at action time.
- Stripe Sprint C plumbing is simpler — `studios.stripe_*` columns are already there.

**What becomes harder:**
- Every new query against a tenant-scoped table must go through `scopedQuery()`. We will catch missed call sites in code review and (in M4) via RLS rejecting the query.
- Cross-studio admin tooling (a future "switch studios" UI for Phil) needs a session-scoped studio override. Out of scope; design when needed.
- Migrations against tenant-scoped tables need to think about backfill ordering. The first one (M3) is the hardest because it's adding the column on existing data. Subsequent migrations are cheap.

**What we'll need to revisit:**
- At ~10–20 studios, look at noisy-neighbour patterns and consider per-studio resource budgets in Postgres. Not urgent.
- At first cross-studio user (one auth user, two studios) we'll hit the `current_studio_id()` ambiguity. Add the session-override setter at that point. Watch for it; do not pre-build.
- After M4 ships and we've operated RLS for ~2 weeks, decide whether `scopedQuery` is still earning its keep or whether we trust RLS alone. Likely we keep both — defense in depth is cheap.
- Stripe Customer creation flow (Sprint C, v0.26.0) needs the `metadata.studio_id` cross-check from Decision 4 wired up. Add a checklist item to the Sprint C ticket.
- The Vercel cron (`/api/admin/rebase-demo-classes`) currently iterates "all classes." Post-M3 it must iterate per-studio (or be retired in favour of the recurring-templates work in Sprint A, v0.24.0). Add a follow-up note in the M3 ticket.

---

## Action items

1. [x] ~~Phil reviews this draft.~~ Approved 2026-05-09 with all six decisions intact, including Decision 6 (M2.5).
2. [ ] **Commit this ADR to the repo at `docs/adr/0001-multi-tenancy.md`.** Suggested PR: `chore/adr-0001-multi-tenancy` (~v0.21.0.x). Optional — could also be folded into the M3 PR if you'd rather keep ADR + implementation atomic. Recommendation: separate PR, lands ahead of M3 so the ADR is reviewable on its own.
3. [ ] **CI baseline merged before M3 PR opens.** `chore/ci-baseline` (target v0.21.0.x) must be on `main` first — M3 is the largest PR of the year and cannot be the first one running through a brand-new CI workflow. If CI baseline isn't green before M3 work begins, pause M3 until it is.
4. [ ] **M2.5 spec — `refactor/scoped-query`** — drafted at `tickets/M2.5_scoped_query_refactor.md` 2026-05-09. Pass-through `scopedQuery()` helper + mechanical renames at every call site that queries a tenant-scoped table. Target v0.21.0.3.
5. [ ] **M3 implementation spec — v0.22.0.** Cowork to draft a longer ticket from this ADR when M2.5 is in flight (we'll know what `scopedQuery` actually looks like in code by then). Will include: the migration file shape, the `current_studio_id()` function, the filter logic in `scopedQuery`'s body, the manual-prod-Supabase apply step in "How to verify," the cron-job follow-up note, and confirmation of where members' Stripe customer IDs actually live today (per Decision 4's "confirm at PR draft").
6. [ ] **Sprint C checklist update.** Add Decision 4's metadata cross-check + per-event-type resolution policy to the Stripe-prod-cutover ticket once it's drafted.
7. [ ] **`SUPABASE_SETUP.md` update post-M3.** Document the manual migration step shape that v0.21.0 surfaced ("paste migration into SQL editor before merging PR") so it's not folklore.
8. [ ] **`AGENTS.md` / `CLAUDE.md` updates post-M4.** Drop the "no auth, no tenancy" caveat once both have shipped.

---

## Appendix A — Tables that gain `studio_id` in v0.22.0

Per the post-v0.21.0 schema state. Confirm against `supabase/schema.sql` at PR draft time — any table missing here is either (a) pre-existing and needs adding, or (b) M3 doesn't apply to it (e.g. `auth.users` is owned by Supabase Auth, not us).

- `members` — already exists, single-tenant
- `staff` — added in v0.21.0, single-tenant
- `classes` — already exists
- `bookings` — already exists
- `waitlist` (or whatever the audit's "waitlist" surface is named in `db.ts`)
- `plans` — already exists (per-studio plan offerings, not the SaaS pricing tiers — those live on `studios.plan_id`)
- `credit_ledger` — already exists
- `purchases` — already exists
- `booking_events` — already exists (audit log)
- `class_templates` — does NOT exist yet, lands in Sprint A (v0.24.0). Carry the `studio_id` shape forward to that ticket.
- `pending_actions`, `action_events` — do NOT exist yet, land in Sprint D (v0.28.0). Same — carry the shape forward.

`auth.users` and any Supabase-owned schemas are not modified. `studios` itself does not have a `studio_id` column (it *is* the tenancy table).

---

## Appendix B — What this ADR explicitly does *not* decide

- **Subdomain or path-prefix routing** — deferred to post-pilot.
- **Per-studio Stripe Connect / payouts** — deferred. Sprint C uses a single platform Stripe account; per-studio payout splits are a future product.
- **Cross-studio analytics dashboard** for Phil. Easy on this schema, but no UI in M3 or M4.
- **Soft delete / archive of studios.** When a studio churns, the row stays for audit-log integrity (`booking_events`, `purchases`). Set `studios.archived_at` if/when needed; not in M3.
- **Per-studio custom branding / theming.** Out of scope for pilot.
- **Studio-to-studio member transfer.** A member moving from Studio A to Studio B is a brand-new `members` row in B; nothing transfers. If a studio chain wants this in the future, design then.

---

## Appendix C — Why six decisions and not five

The plan (`StudioFlow_Plan_2026-05-08.md` §3) lists five decision points. This ADR adds Decision 6 (`scopedQuery` as M2.5) because the plan says verbatim *"Worth a small refactor PR first (M2.5?) to introduce a `scopedQuery(studioId)` helper so the M3 diff is cleaner. Decide at ADR time."* — i.e. the plan delegated the decision to this ADR. The recommendation is yes. If you reject it, strike Decision 6 and the corresponding action items, and accept that the M3 diff will be ~30% larger.
