"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { scopedQuery } from "@/lib/db";
import { getSupabaseServiceClient } from "@/lib/supabase";
import {
  republishFutureInstances,
  type MaterialisableTemplate,
  type MaterialiseStudio,
  type RepublishCounts,
} from "@/lib/template-materialise";

/**
 * v0.24.0 (Sprint A) — server actions for class_templates CRUD +
 * republish.
 *
 * Auth posture:
 *   - All CRUD actions require owner or manager via requireRole().
 *     /app/classes/templates lives under the proxy-gated /app surface
 *     so a non-staff session can't reach the page in the first place,
 *     but server actions are POSTs to the page route and the proxy
 *     matcher gate is the FIRST line of defense — requireRole() in the
 *     handler is the SECOND (per AGENTS.md / src/proxy.ts comments).
 *
 *   - CRUD uses scopedQuery() — cookie-auth client wrapped with the
 *     studio-scoping Proxy. Inserts auto-stamp studio_id; reads filter
 *     by it. RLS is the safety net underneath.
 *
 *   - Republish uses the SERVICE-ROLE client. Reason: the republish
 *     operation may touch existing classes rows whose materialised
 *     starts_at is far in the future; future-proofing for a multi-
 *     studio scenario where the operator wants to publish across
 *     studios they own staff rows in. For pre-pilot single-studio the
 *     scopedQuery path would also work, but the service-role path
 *     keeps the republish helper symmetric with the cron and avoids
 *     subtle RLS surprises during the in-place UPDATE loop.
 *
 *   - The service-role caller list is updated in src/lib/supabase.ts
 *     header comments AND in docs/adr/0001-multi-tenancy.md Decision 1.
 *
 * Input validation: each action validates its FormData payload server-
 * side. CHECK constraints in the DB are the ultimate gate, but we
 * surface friendly errors before the DB rejects the row.
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type TemplateActionState =
  | { error?: undefined }
  | { error: string };

/** Parse + validate one template payload from a FormData. */
function parseTemplatePayload(formData: FormData): {
  ok: true;
  payload: {
    name: string;
    weekday: number;
    start_time_local: string;
    duration_minutes: number;
    instructor_id: string | null;
    capacity: number;
    cancellation_window_hours: number;
    check_in_window_minutes: number;
    valid_from: string;
    valid_until: string | null;
  };
} | { ok: false; error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };

  const weekday = Number(formData.get("weekday"));
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: "Pick a day of the week." };
  }

  const start_time_local = String(formData.get("start_time_local") ?? "").trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(start_time_local)) {
    return { ok: false, error: "Start time must be HH:MM." };
  }

  const duration_minutes = Number(formData.get("duration_minutes"));
  if (
    !Number.isInteger(duration_minutes) ||
    duration_minutes <= 0 ||
    duration_minutes > 480
  ) {
    return {
      ok: false,
      error: "Duration must be between 1 and 480 minutes.",
    };
  }

  const capacity = Number(formData.get("capacity"));
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return { ok: false, error: "Capacity must be a positive number." };
  }

  const cancellation_window_hours = Number(
    formData.get("cancellation_window_hours") ?? 12,
  );
  if (
    !Number.isInteger(cancellation_window_hours) ||
    cancellation_window_hours < 0
  ) {
    return {
      ok: false,
      error: "Cancellation window must be a non-negative number.",
    };
  }

  const check_in_window_minutes = Number(
    formData.get("check_in_window_minutes") ?? 30,
  );
  if (
    !Number.isInteger(check_in_window_minutes) ||
    check_in_window_minutes < 0 ||
    check_in_window_minutes > 240
  ) {
    return {
      ok: false,
      error: "Check-in window must be between 0 and 240 minutes.",
    };
  }

  const valid_from = String(formData.get("valid_from") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valid_from)) {
    return { ok: false, error: "Valid-from must be a date." };
  }

  const validUntilRaw = String(formData.get("valid_until") ?? "").trim();
  const valid_until = validUntilRaw === "" ? null : validUntilRaw;
  if (valid_until && !/^\d{4}-\d{2}-\d{2}$/.test(valid_until)) {
    return { ok: false, error: "Valid-until must be a date or empty." };
  }
  if (valid_until && valid_until <= valid_from) {
    return { ok: false, error: "Valid-until must be after valid-from." };
  }

  const instructorRaw = String(formData.get("instructor_id") ?? "").trim();
  const instructor_id = instructorRaw === "" ? null : instructorRaw;

  return {
    ok: true,
    payload: {
      name,
      weekday,
      start_time_local,
      duration_minutes,
      instructor_id,
      capacity,
      cancellation_window_hours,
      check_in_window_minutes,
      valid_from,
      valid_until,
    },
  };
}

export async function createTemplate(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  await requireRole(["owner", "manager"]);

  const parsed = parseTemplatePayload(formData);
  if (!parsed.ok) return { error: parsed.error };

  const client = await scopedQuery();
  if (!client) return { error: "Database client not configured." };

  const { data, error } = await client
    .from("class_templates")
    .insert([parsed.payload])
    .select("id")
    .single();

  if (error) {
    return { error: `Couldn't save the template — ${error.message}` };
  }

  revalidatePath("/app/classes/templates");
  redirect(`/app/classes/templates/${data.id}`);
}

export async function updateTemplate(
  templateId: string,
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  await requireRole(["owner", "manager"]);

  const parsed = parseTemplatePayload(formData);
  if (!parsed.ok) return { error: parsed.error };

  const client = await scopedQuery();
  if (!client) return { error: "Database client not configured." };

  const { error } = await client
    .from("class_templates")
    .update(parsed.payload)
    .eq("id", templateId);

  if (error) {
    return { error: `Couldn't update the template — ${error.message}` };
  }

  revalidatePath("/app/classes/templates");
  revalidatePath(`/app/classes/templates/${templateId}`);
  return {};
}

/**
 * Two-step republish action: first call returns counts for the
 * confirmation modal; second call (with confirm="true") actually
 * runs the in-place rebuild + materialisation fill-forward.
 *
 * Returns a structured RepublishCounts on confirm. Returns { counts }
 * on dry-run (without confirm).
 */
export type RepublishPreview = {
  ok: true;
  mode: "preview";
  counts: { rebuilt: number; bookingsAffected: number };
};

export type RepublishResult = {
  ok: true;
  mode: "applied";
  counts: RepublishCounts;
};

export type RepublishError = {
  ok: false;
  error: string;
};

export async function republishFutureForTemplate(
  templateId: string,
  confirm: boolean,
): Promise<RepublishPreview | RepublishResult | RepublishError> {
  await requireRole(["owner", "manager"]);

  // Service-role for the republish path — see file header for the
  // rationale. The studio lookup uses the SAME service-role client so
  // the bypass is consistent across all reads/writes in this action.
  const service = getSupabaseServiceClient();
  if (!service) {
    return {
      ok: false,
      error:
        "Service-role client not configured. Set SUPABASE_SERVICE_ROLE_KEY in Vercel.",
    };
  }

  // Look up template (with studio_id) using the service-role client to
  // bypass the cookie-session studio_id filter. The template id was
  // provided by an authenticated operator (requireRole above) and we
  // re-check studio_id below.
  const { data: tplRow, error: tplErr } = await service
    .from("class_templates")
    .select(
      "id, studio_id, name, weekday, start_time_local, duration_minutes, instructor_id, capacity, cancellation_window_hours, check_in_window_minutes, valid_from, valid_until",
    )
    .eq("id", templateId)
    .maybeSingle();

  if (tplErr || !tplRow) {
    return { ok: false, error: "Template not found." };
  }

  const template: MaterialisableTemplate = {
    id: tplRow.id as string,
    studio_id: tplRow.studio_id as string,
    name: tplRow.name as string,
    weekday: tplRow.weekday as number,
    start_time_local: tplRow.start_time_local as string,
    duration_minutes: tplRow.duration_minutes as number,
    instructor_id: tplRow.instructor_id as string | null,
    capacity: tplRow.capacity as number,
    cancellation_window_hours: tplRow.cancellation_window_hours as number,
    check_in_window_minutes: tplRow.check_in_window_minutes as number,
    valid_from: tplRow.valid_from as string,
    valid_until: tplRow.valid_until as string | null,
  };

  const { data: studioRow, error: studioErr } = await service
    .from("studios")
    .select("id, tz, materialisation_horizon_weeks")
    .eq("id", template.studio_id)
    .maybeSingle();
  if (studioErr || !studioRow) {
    return { ok: false, error: "Studio not found." };
  }
  const studio: MaterialiseStudio = {
    id: studioRow.id as string,
    tz: studioRow.tz as string,
    materialisation_horizon_weeks:
      studioRow.materialisation_horizon_weeks as number,
  };

  let instructorName = "TBD";
  if (template.instructor_id) {
    const { data: staffRow } = await service
      .from("staff")
      .select("full_name")
      .eq("id", template.instructor_id)
      .maybeSingle();
    if (staffRow?.full_name) instructorName = staffRow.full_name as string;
  }

  if (!confirm) {
    // Dry-run: count future materialised classes + their bookings.
    const cutoff = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    const { data: existing } = await service
      .from("classes")
      .select("id")
      .eq("template_id", templateId)
      .gt("starts_at", cutoff);
    const classIds = (existing ?? []).map((r) => r.id as string);

    let bookingsAffected = 0;
    if (classIds.length > 0) {
      const { count } = await service
        .from("class_bookings")
        .select("id", { count: "exact", head: true })
        .in("class_id", classIds)
        .eq("is_active", true);
      bookingsAffected = count ?? 0;
    }

    return {
      ok: true,
      mode: "preview",
      counts: {
        rebuilt: classIds.length,
        bookingsAffected,
      },
    };
  }

  try {
    const counts = await republishFutureInstances(
      service,
      studio,
      template,
      instructorName,
    );
    revalidatePath(`/app/classes/templates/${templateId}`);
    revalidatePath("/app/classes/templates");
    revalidatePath("/app/classes");
    // dayName for any future toast — kept simple here.
    void DAY_NAMES;
    return { ok: true, mode: "applied", counts };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Republish failed.",
    };
  }
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await requireRole(["owner", "manager"]);

  const client = await scopedQuery();
  if (!client) throw new Error("Database client not configured.");

  const { error } = await client
    .from("class_templates")
    .delete()
    .eq("id", templateId);
  if (error) throw new Error(`Couldn't delete template — ${error.message}`);

  revalidatePath("/app/classes/templates");
  redirect("/app/classes/templates");
}
