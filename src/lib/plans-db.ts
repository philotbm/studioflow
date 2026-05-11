import { scopedQuery } from "@/lib/db";
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

async function requireClient() {
  const client = await scopedQuery();
  if (!client) {
    throw new Error("Supabase client not initialised (NEXT_PUBLIC_SUPABASE_* env vars missing)");
  }
  return client;
}

const PLAN_COLUMNS = "id, name, type, price_cents, credits, active, created_at";

/** Read all plans, newest first. Includes inactive rows. */
export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await (await requireClient())
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
  const { data, error } = await (await requireClient())
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
  const client = await requireClient();
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
  const { data, error } = await (await requireClient())
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

export type UpdatePlanFieldsInput = {
  name: string;
  /** Type cannot change in v0.14.2 — see updatePlanFields. */
  type: "class_pack" | "unlimited";
  priceCents: number;
  credits: number | null;
};

/**
 * v0.14.2: edit existing plan commercial fields.
 *
 * Only `name`, `price_cents`, and `credits` can be modified. The id
 * stays fixed so historical purchases keep resolving to the right
 * row, and the type stays fixed because changing class_pack ↔
 * unlimited would invalidate the plans_type_credits_coherent CHECK
 * and confuse purchase history (where plan_type is snapshotted at
 * purchase time). The caller passes `type` so the server can refuse
 * a request that tries to change it instead of silently dropping the
 * field.
 *
 * Validation of the input shape (hard rules) is the caller's job —
 * this function just enforces the type-immutability invariant and
 * persists.
 */
export async function updatePlanFields(
  id: string,
  input: UpdatePlanFieldsInput,
): Promise<CreatePlanResult> {
  const client = await requireClient();

  const { data: existing, error: existingErr } = await client
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (existingErr) {
    return { ok: false, error: existingErr.message };
  }
  if (!existing) {
    return { ok: false, error: `Plan not found: ${id}` };
  }
  const current = mapRow(existing as PlanRow);

  if (current.type !== input.type) {
    return {
      ok: false,
      error:
        "Plan type can't be changed on an existing plan. Create a new plan and deactivate this one instead.",
    };
  }

  // Belt-and-braces consistency check — the DB CHECK enforces this
  // too, but a clearer error message is friendlier than 23514.
  if (input.type === "class_pack" && (input.credits === null || input.credits <= 0)) {
    return {
      ok: false,
      error: "Class pack plans need a whole-number credit count above 0.",
    };
  }
  if (input.type === "unlimited" && input.credits !== null) {
    return {
      ok: false,
      error: "Unlimited plans don't carry a credit count.",
    };
  }

  const { data, error } = await client
    .from("plans")
    .update({
      name: input.name,
      price_cents: input.priceCents,
      credits: input.type === "class_pack" ? input.credits : null,
    })
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
