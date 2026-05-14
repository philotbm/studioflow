"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { scopedQuery } from "@/lib/db";

/**
 * v0.25.0 (Sprint B) — Email-settings server actions.
 *
 * Owner/manager only. Updates studios.transactional_emails_enabled
 * via scopedQuery (cookie-auth, RLS-scoped to the operator's studio).
 * RLS guarantees the operator can only flip their own studio's row.
 */
export type EmailSettingsState =
  | { error?: undefined; ok?: true }
  | { error: string };

export async function setTransactionalEmailsEnabled(
  enabled: boolean,
): Promise<EmailSettingsState> {
  await requireRole(["owner", "manager"]);

  const client = await scopedQuery();
  if (!client) return { error: "Database client not configured." };

  // scopedQuery's UPDATE auto-filters by studio_id, so this update
  // only ever touches the operator's own studios row. The .neq()
  // ensures Supabase doesn't return zero rows for "studio not found"
  // when the operator legitimately has one studio — we use a fixed
  // sentinel comparison so the UPDATE always matches exactly the
  // operator's row.
  const { error } = await client
    .from("studios")
    .update({ transactional_emails_enabled: enabled })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    return { error: `Couldn't update — ${error.message}` };
  }

  revalidatePath("/app/settings/email");
  return { ok: true };
}
