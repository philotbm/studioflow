import { getSupabaseClient } from "@/lib/supabase";
import type { Plan, PlanType } from "@/lib/plans";

/**
 * v0.14.0 server-side plan catalogue helpers.
 *
 * Used by routes that run on the server and have to resolve a plan
 * from DB truth, not from a client-cached slice: applyPurchase,
 * create-checkout-session, /app/plans server component, and
 * /api/admin/plans POST.
 *
 * Shape note: DB rows come back snake_case; the returned `Plan` type
 * is camelCase to match the rest of the app.
 */

type PlanRow = {
  id: string;
  name: string;
  type: PlanType;
  price_cents: number;
  credits: number | null;
  created_at: string;
};

function mapRow(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    priceCents: row.price_cents,
    credits: row.credits,
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

/** Read all plans, newest first. */
export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await requireClient()
    .from("plans")
    .select("id, name, type, price_cents, credits, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[listPlans] query failed:", error.message);
    return [];
  }
  return (data as PlanRow[]).map(mapRow);
}

/** Fetch a single plan by id. Returns null when missing. */
export async function fetchPlanById(id: string): Promise<Plan | null> {
  const { data, error } = await requireClient()
    .from("plans")
    .select("id, name, type, price_cents, credits, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[fetchPlanById] query failed:", error.message);
    return null;
  }
  return data ? mapRow(data as PlanRow) : null;
}

export type CreatePlanInput = {
  id: string;
  name: string;
  type: PlanType;
  priceCents: number;
  credits: number | null;
};

export type CreatePlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; error: string };

/**
 * Insert a new plan row. The caller is expected to have validated
 * shape already (e.g. in the /api/admin/plans route). Relies on the DB
 * CHECKs for the class_pack ↔ credits coherence and for non-negative
 * price — so an invalid payload will surface as a 23514 check_violation
 * and we return it as a clean error string.
 */
export async function insertPlan(input: CreatePlanInput): Promise<CreatePlanResult> {
  const { data, error } = await requireClient()
    .from("plans")
    .insert({
      id: input.id,
      name: input.name,
      type: input.type,
      price_cents: input.priceCents,
      credits: input.credits,
    })
    .select("id, name, type, price_cents, credits, created_at")
    .single();
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, plan: mapRow(data as PlanRow) };
}
