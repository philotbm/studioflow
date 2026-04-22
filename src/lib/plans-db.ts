import { getSupabaseClient } from "@/lib/supabase";
import { generatePlanId, type Plan, type PlanType } from "@/lib/plans";

/**
 * v0.14.0/14.1 server-side plan catalogue helpers.
 *
 * Consumed by routes that run on the server and need DB-truth plan
 * resolution: applyPurchase, create-checkout-session, /app/plans
 * surface, and the /api/admin/plans admin route.
 */

type PlanRow = {
  id: string;
  name: string;
  type: PlanType;
  price_cents: number;
  credits: number | null;
  active: boolean;
  created_at: string;
};

function mapRow(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    priceCents: row.price_cents,
    credits: row.credits,
    active: row.active,
    createdAt: row.created_at,
  };
}

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase client not initialised (NEXT_PUBLIC_SUPABASE_* env vars missing)");
  }
  return client;
}

const PLAN_COLUMNS = "id, name, type, price_cents, credits, active, created_at";

/** Read all plans, newest first. Includes inactive rows. */
export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await requireClient()
    .from("plans")
    .select(PLAN_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[listPlans] query failed:", error.message);
    return [];
  }
  return (data as PlanRow[]).map(mapRow);
}

/**
 * Fetch a single plan by id — includes inactive rows. Historical
 * purchase resolution (member Purchase history) relies on this: a
 * member who bought a plan that has since been deactivated should
 * still see the plan name on their receipt, not a raw id.
 */
export async function fetchPlanById(id: string): Promise<Plan | null> {
  const { data, error } = await requireClient()
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[fetchPlanById] query failed:", error.message);
    return null;
  }
  return data ? mapRow(data as PlanRow) : null;
}

export type CreatePlanInput = {
  name: string;
  type: PlanType;
  priceCents: number;
  credits: number | null;
};

export type CreatePlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; error: string };

/**
 * v0.14.1: insert with auto-generated id.
 *
 * The id is derived deterministically from the plan name (see
 * generatePlanId). If the base candidate collides with an existing
 * row, we append `_2`, `_3`, ... up to a sanity bound. Retrying on
 * 23505 (unique_violation) closes the TOCTOU race between the
 * existence check and the insert — two concurrent creators with the
 * same name will both succeed, one landing on the base id and the
 * other on `_2`.
 */
export async function insertPlan(input: CreatePlanInput): Promise<CreatePlanResult> {
  const client = requireClient();
  const base = generatePlanId(input.name);
  const MAX_ATTEMPTS = 50;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}_${attempt + 1}`;
    const { data, error } = await client
      .from("plans")
      .insert({
        id: candidate,
        name: input.name,
        type: input.type,
        price_cents: input.priceCents,
        credits: input.credits,
      })
      .select(PLAN_COLUMNS)
      .single();

    if (!error) {
      return { ok: true, plan: mapRow(data as PlanRow) };
    }
    // unique_violation: try next suffix. Any other error is terminal.
    if (error.code !== "23505") {
      return { ok: false, error: error.message };
    }
  }
  return {
    ok: false,
    error: `Could not find a free id for "${input.name}" after ${MAX_ATTEMPTS} attempts`,
  };
}

/** v0.14.1: toggle `plans.active`. Used by the admin toggle control. */
export async function updatePlanActive(
  id: string,
  active: boolean,
): Promise<CreatePlanResult> {
  const { data, error } = await requireClient()
    .from("plans")
    .update({ active })
    .eq("id", id)
    .select(PLAN_COLUMNS)
    .maybeSingle();
  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: `Plan not found: ${id}` };
  }
  return { ok: true, plan: mapRow(data as PlanRow) };
}
