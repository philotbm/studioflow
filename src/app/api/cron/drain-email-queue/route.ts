// v0.25.0 (Sprint B) — Drain transactional email queue.
//
// Cron at */5 * * * * (Vercel cron, vercel.json). Bearer-auth via the
// same CRON_SECRET as /api/cron/materialise-templates.
//
// Service-role client iterates pending rows where scheduled_for <= now()
// and sends them sequentially via the renderAndSend helper. Sequential
// because Resend has per-account rate limits and pre-pilot volumes
// don't justify concurrent send fan-out.
//
// Locking: the brief calls for FOR UPDATE SKIP LOCKED, but the Supabase
// JS client doesn't expose that flag directly. We emulate with
// optimistic locking: SELECT pending rows, then UPDATE status='sending'
// WHERE id = row.id AND status = 'pending'. If a parallel cron
// invocation grabbed the row first, our UPDATE matches 0 rows and we
// skip. Same safety property; no race condition at pre-pilot volumes.
//
// Retry schedule (per SF-005 Decision 9): exponential backoff after
// each failure. attempts=1 → +5min; =2 → +30min; =3 → +2h; =4 → +8h.
// If attempts >= 4 after the failure-increment, mark dead_letter and
// capture an escalated severity exception to Sentry. Otherwise update
// status back to 'pending' with the new scheduled_for.

import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase";
import { renderAndSend } from "@/lib/email/send";
import type { EmailTemplateType } from "@/lib/email/types";
import { logger } from "@/lib/logger";
import { withSentryCapture } from "@/lib/with-sentry";

const BATCH_LIMIT = 50;

/** attempts (post-increment) → minutes-to-next-attempt. */
const BACKOFF_MINUTES_BY_ATTEMPT: Record<number, number> = {
  1: 5,
  2: 30,
  3: 120,
  4: 480,
};

const MAX_ATTEMPTS = 4;

function isAuthorisedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (!header) return false;
  return header === `Bearer ${secret}`;
}

interface QueueRow {
  id: string;
  studio_id: string;
  template_type: EmailTemplateType;
  recipient_email: string;
  recipient_name: string | null;
  context: Record<string, unknown>;
  attempts: number;
  booking_event_id: string | null;
  purchase_id: string | null;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorisedCronRequest(req)) {
    logger.warn({ event: "cron_drain_email_unauthorised" });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const client = getSupabaseServiceClient();
  if (!client) {
    logger.error({ event: "cron_drain_email_no_service_client" });
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

  // 1. Read up to BATCH_LIMIT pending rows whose scheduled_for has
  //    elapsed. Order by scheduled_for ASC so the oldest pending email
  //    drains first.
  const nowIso = new Date().toISOString();
  const { data: candidates, error: selectErr } = await client
    .from("email_queue")
    .select(
      "id, studio_id, template_type, recipient_email, recipient_name, context, attempts, booking_event_id, purchase_id",
    )
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_LIMIT);

  if (selectErr) {
    logger.error({
      event: "cron_drain_email_select_failed",
      error: selectErr.message,
    });
    return NextResponse.json(
      { ok: false, stage: "select", error: selectErr.message },
      { status: 500 },
    );
  }

  const rows = (candidates ?? []) as QueueRow[];
  let sent = 0;
  let failed = 0;
  let deadLettered = 0;
  let skipped = 0;

  for (const row of rows) {
    // Optimistic lock: UPDATE status='sending' WHERE id=row.id AND
    // status='pending'. If another invocation already grabbed it, we
    // get 0 rows back and skip without firing a send.
    const newAttempts = row.attempts + 1;
    const { data: claimed, error: claimErr } = await client
      .from("email_queue")
      .update({
        status: "sending",
        attempts: newAttempts,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");

    if (claimErr) {
      logger.warn({
        event: "cron_drain_email_claim_failed",
        row_id: row.id,
        error: claimErr.message,
      });
      skipped++;
      continue;
    }
    if (!claimed || claimed.length === 0) {
      // Lost the race — another invocation has this row.
      skipped++;
      continue;
    }

    // 2. Render + send. renderAndSend handles render errors AND Resend
    //    errors internally; we just inspect the result.
    const result = await renderAndSend({
      template_type: row.template_type,
      context: row.context,
      recipient_email: row.recipient_email,
      recipient_name: row.recipient_name,
    });

    if (result.success) {
      const { error: markErr } = await client
        .from("email_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          resend_message_id: result.message_id ?? null,
          last_error: null,
        })
        .eq("id", row.id);
      if (markErr) {
        logger.warn({
          event: "cron_drain_email_mark_sent_failed",
          row_id: row.id,
          error: markErr.message,
        });
      }
      sent++;
      continue;
    }

    // Failed. Decide: retry or dead-letter.
    const errMsg = result.error ?? "unknown error";
    if (newAttempts >= MAX_ATTEMPTS) {
      const { error: dlErr } = await client
        .from("email_queue")
        .update({
          status: "dead_letter",
          last_error: errMsg,
        })
        .eq("id", row.id);
      if (dlErr) {
        logger.warn({
          event: "cron_drain_email_mark_deadletter_failed",
          row_id: row.id,
          error: dlErr.message,
        });
      }
      deadLettered++;
      logger.error({
        event: "cron_drain_email_dead_letter",
        row_id: row.id,
        studio_id: row.studio_id,
        template_type: row.template_type,
        attempts: newAttempts,
        error: errMsg,
      });
      Sentry.captureException(
        new Error(
          `Email dead-lettered after ${newAttempts} attempts: ${row.template_type} → ${row.recipient_email}: ${errMsg}`,
        ),
        { level: "error", tags: { surface: "email_dead_letter" } },
      );
      continue;
    }

    const backoffMinutes = BACKOFF_MINUTES_BY_ATTEMPT[newAttempts] ?? 60;
    const nextScheduledFor = new Date(
      Date.now() + backoffMinutes * 60_000,
    ).toISOString();
    const { error: retryErr } = await client
      .from("email_queue")
      .update({
        status: "pending",
        scheduled_for: nextScheduledFor,
        last_error: errMsg,
      })
      .eq("id", row.id);
    if (retryErr) {
      logger.warn({
        event: "cron_drain_email_reschedule_failed",
        row_id: row.id,
        error: retryErr.message,
      });
    }
    failed++;
    logger.warn({
      event: "cron_drain_email_send_failed",
      row_id: row.id,
      studio_id: row.studio_id,
      template_type: row.template_type,
      attempts: newAttempts,
      next_scheduled_for: nextScheduledFor,
      error: errMsg,
    });
    Sentry.captureException(
      new Error(
        `Email send failed (attempt ${newAttempts}/${MAX_ATTEMPTS}): ${row.template_type} → ${row.recipient_email}: ${errMsg}`,
      ),
      { level: "warning", tags: { surface: "email_send_failed" } },
    );
  }

  const finishedAt = new Date().toISOString();
  logger.info({
    event: "cron_drain_email_complete",
    started_at: startedAt,
    finished_at: finishedAt,
    candidates: rows.length,
    sent,
    failed,
    dead_lettered: deadLettered,
    skipped,
  });

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt,
    candidates: rows.length,
    sent,
    failed,
    deadLettered,
    skipped,
  });
}

export const GET = withSentryCapture(
  async function GET(req: NextRequest) {
    return handle(req);
  },
  { method: "GET", parameterizedRoute: "/api/cron/drain-email-queue" },
);

export const POST = withSentryCapture(
  async function POST(req: NextRequest) {
    return handle(req);
  },
  { method: "POST", parameterizedRoute: "/api/cron/drain-email-queue" },
);
