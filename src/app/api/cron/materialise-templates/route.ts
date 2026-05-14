// v0.24.0 (Sprint A) — Daily Vercel cron that materialises class
// templates into the classes table.
//
// Auth: Vercel cron jobs send `Authorization: Bearer ${CRON_SECRET}`.
// This route checks that header BEFORE any DB work; missing or wrong
// secret returns 401 without touching the DB. /api/cron/* is NOT in
// src/proxy.ts's matcher allow-list, so the request reaches this
// handler without going through the staff-auth gate (which would 401
// any unauthenticated request, breaking the cron).
//
// Service role: this route iterates every studio's templates and
// inserts classes rows scoped to each studio. RLS would block any
// cookie-auth session from reading across studios, so the cron uses
// the service-role client. studio_id discipline is enforced in the
// materialiseTemplate helper (every insert carries the studio's id).
// See ADR-0001 Decision 1 — this is the fifth documented exception
// to the "no service-role outside the four named callers" rule.
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase";
import {
  materialiseTemplate,
  type MaterialisableTemplate,
  type MaterialiseStudio,
  type MaterialiseSummary,
} from "@/lib/template-materialise";
import { logger } from "@/lib/logger";
import { withSentryCapture } from "@/lib/with-sentry";

/**
 * Bearer-token check against CRON_SECRET. Set this in Vercel Production
 * + Preview scope (NOT Development) before this route deploys.
 */
function isAuthorisedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (!header) return false;
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorisedCronRequest(req)) {
    logger.warn({ event: "cron_materialise_unauthorised" });
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const client = getSupabaseServiceClient();
  if (!client) {
    logger.error({ event: "cron_materialise_no_service_client" });
    return NextResponse.json(
      {
        ok: false,
        error: "Service-role client not configured",
        hint:
          "SUPABASE_SERVICE_ROLE_KEY missing from server env. Set in Vercel Production scope.",
      },
      { status: 503 },
    );
  }

  const startedAt = new Date().toISOString();

  // 1. Iterate every studio. Service-role bypasses RLS.
  const { data: studios, error: studiosErr } = await client
    .from("studios")
    .select("id, tz, materialisation_horizon_weeks");
  if (studiosErr) {
    logger.error({
      event: "cron_materialise_studios_query_failed",
      error: studiosErr.message,
    });
    return NextResponse.json(
      { ok: false, stage: "studios_query", error: studiosErr.message },
      { status: 500 },
    );
  }

  const summaries: MaterialiseSummary[] = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  const errors: Array<{ studioId: string; templateId: string; error: string }> = [];

  for (const studioRow of studios ?? []) {
    const studio: MaterialiseStudio = {
      id: studioRow.id as string,
      tz: studioRow.tz as string,
      materialisation_horizon_weeks:
        studioRow.materialisation_horizon_weeks as number,
    };

    // 2. Templates for this studio currently in their valid window.
    const today = new Date().toISOString().slice(0, 10);
    const { data: templates, error: tplErr } = await client
      .from("class_templates")
      .select(
        "id, studio_id, name, weekday, start_time_local, duration_minutes, instructor_id, capacity, cancellation_window_hours, check_in_window_minutes, valid_from, valid_until",
      )
      .eq("studio_id", studio.id)
      .lte("valid_from", today);

    if (tplErr) {
      logger.error({
        event: "cron_materialise_templates_query_failed",
        studio_id: studio.id,
        error: tplErr.message,
      });
      errors.push({
        studioId: studio.id,
        templateId: "*",
        error: tplErr.message,
      });
      continue;
    }

    const activeTemplates = (templates ?? []).filter((t) => {
      const validUntil = t.valid_until as string | null;
      return !validUntil || validUntil > today;
    });

    if (activeTemplates.length === 0) continue;

    // 3. Pre-fetch staff names for the studio's instructor_ids in one
    //    round-trip so we don't query per-template inside the loop.
    const instructorIds = activeTemplates
      .map((t) => t.instructor_id as string | null)
      .filter((v): v is string => Boolean(v));
    const staffNames = new Map<string, string>();
    if (instructorIds.length > 0) {
      const { data: staffRows, error: staffErr } = await client
        .from("staff")
        .select("id, full_name")
        .in("id", instructorIds);
      if (staffErr) {
        logger.warn({
          event: "cron_materialise_staff_lookup_failed",
          studio_id: studio.id,
          error: staffErr.message,
        });
      } else {
        for (const s of staffRows ?? []) {
          staffNames.set(s.id as string, s.full_name as string);
        }
      }
    }

    // 4. Materialise each template.
    for (const tplRow of activeTemplates) {
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
      const instructorName = template.instructor_id
        ? (staffNames.get(template.instructor_id) ?? "TBD")
        : "TBD";

      try {
        const summary = await materialiseTemplate(
          client,
          studio,
          template,
          instructorName,
        );
        summaries.push(summary);
        totalInserted += summary.inserted;
        totalSkipped += summary.skipped;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error({
          event: "cron_materialise_template_failed",
          studio_id: studio.id,
          template_id: template.id,
          error: message,
        });
        errors.push({
          studioId: studio.id,
          templateId: template.id,
          error: message,
        });
      }
    }
  }

  const finishedAt = new Date().toISOString();
  logger.info({
    event: "cron_materialise_complete",
    started_at: startedAt,
    finished_at: finishedAt,
    studios: studios?.length ?? 0,
    total_inserted: totalInserted,
    total_skipped: totalSkipped,
    errors: errors.length,
  });

  return NextResponse.json({
    ok: errors.length === 0,
    startedAt,
    finishedAt,
    studios: studios?.length ?? 0,
    totalInserted,
    totalSkipped,
    summaries,
    errors,
  });
}

export const GET = withSentryCapture(
  async function GET(req: NextRequest) {
    return handle(req);
  },
  { method: "GET", parameterizedRoute: "/api/cron/materialise-templates" },
);

export const POST = withSentryCapture(
  async function POST(req: NextRequest) {
    return handle(req);
  },
  { method: "POST", parameterizedRoute: "/api/cron/materialise-templates" },
);
