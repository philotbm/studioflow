/**
 * v0.25.0 (Sprint B) — Transactional email render + dispatch.
 *
 * Bridges the DB-snapshotted `context` jsonb to React Email templates
 * and Resend's transactional API. Used by the drain cron at
 * /api/cron/drain-email-queue and (in principle) by any future code
 * path that wants to send a templated email directly.
 *
 * Resend client is a module-level singleton — the Resend SDK is
 * stateless beyond the API key, so re-instantiation is wasteful.
 *
 * Sender identity:
 *   from: `<studio_name> via StudioFlow <RESEND_FROM_ADDRESS_LOCAL@RESEND_FROM_DOMAIN>`
 *   where the env vars default to noreply@studioflow.ie (Pro-verified domain).
 *
 * All errors are caught and returned as { success: false } rather than
 * thrown — the cron caller updates queue state from the result and
 * doesn't need to crash on a single bad row.
 */

import { Resend } from "resend";
import { render } from "@react-email/render";

import BookingConfirmationEmail, {
  BOOKING_CONFIRMATION_SUBJECT,
} from "./templates/booking_confirmation";
import Reminder24hEmail, {
  REMINDER_24H_SUBJECT,
} from "./templates/reminder_24h";
import WaitlistPromoteEmail, {
  WAITLIST_PROMOTE_SUBJECT,
} from "./templates/waitlist_promote";
import CancellationReceiptEmail, {
  CANCELLATION_RECEIPT_SUBJECT,
} from "./templates/cancellation_receipt";
import PaymentReceiptEmail, {
  PAYMENT_RECEIPT_SUBJECT,
} from "./templates/payment_receipt";

import type {
  EmailTemplateType,
  BookingConfirmationContext,
  Reminder24hContext,
  WaitlistPromoteContext,
  CancellationReceiptContext,
  PaymentReceiptContext,
} from "./types";

let _resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (_resendClient) return _resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resendClient = new Resend(key);
  return _resendClient;
}

function buildFromAddress(studioName: string): string {
  const domain = process.env.RESEND_FROM_DOMAIN ?? "studioflow.ie";
  const local = process.env.RESEND_FROM_ADDRESS_LOCAL ?? "noreply";
  // Strip characters that would break an email "Name <addr>" header.
  // Conservative — only commas, angle-brackets, and quotes are
  // problematic; replace with spaces.
  const safeStudio = studioName.replace(/[",<>]/g, "").trim();
  return `${safeStudio} via StudioFlow <${local}@${domain}>`;
}

export interface SendResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

export interface SendArgs {
  template_type: EmailTemplateType;
  // jsonb shape from the queue row's `context` column. The function
  // narrows by template_type before passing through to the typed
  // template component.
  context: Record<string, unknown>;
  recipient_email: string;
  recipient_name: string | null;
}

/**
 * Render the named template against the supplied context and dispatch
 * via Resend. Returns a structured result for queue state updates.
 *
 * `context` is the raw jsonb payload from the queue row. We trust the
 * trigger's snapshot to be well-formed — the TypeScript narrowing on
 * the templates' props gives us runtime safety only at render time, so
 * any mismatch surfaces as a render error (caught and returned as
 * { success: false }).
 */
export async function renderAndSend(args: SendArgs): Promise<SendResult> {
  const client = getResendClient();
  if (!client) {
    return {
      success: false,
      error:
        "RESEND_API_KEY not set in server env. Configure Resend in Vercel.",
    };
  }

  let html: string;
  let subject: string;
  let from: string;
  try {
    const studioName = String(args.context.studio_name ?? "Your studio");
    from = buildFromAddress(studioName);
    const rendered = await renderTemplate(args.template_type, args.context);
    html = rendered.html;
    subject = rendered.subject;
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? `render: ${e.message}` : "render failed",
    };
  }

  try {
    const result = await client.emails.send({
      from,
      to: [args.recipient_email],
      subject,
      html,
    });
    if (result.error) {
      return {
        success: false,
        error: `resend: ${result.error.message ?? "unknown"}`,
      };
    }
    return {
      success: true,
      message_id: result.data?.id,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? `resend: ${e.message}` : "resend failed",
    };
  }
}

async function renderTemplate(
  template_type: EmailTemplateType,
  context: Record<string, unknown>,
): Promise<{ html: string; subject: string }> {
  switch (template_type) {
    case "booking_confirmation": {
      const ctx = context as unknown as BookingConfirmationContext;
      return {
        html: await render(BookingConfirmationEmail(ctx)),
        subject: BOOKING_CONFIRMATION_SUBJECT(ctx),
      };
    }
    case "reminder_24h": {
      const ctx = context as unknown as Reminder24hContext;
      return {
        html: await render(Reminder24hEmail(ctx)),
        subject: REMINDER_24H_SUBJECT(ctx),
      };
    }
    case "waitlist_promote": {
      const ctx = context as unknown as WaitlistPromoteContext;
      return {
        html: await render(WaitlistPromoteEmail(ctx)),
        subject: WAITLIST_PROMOTE_SUBJECT(ctx),
      };
    }
    case "cancellation_receipt": {
      const ctx = context as unknown as CancellationReceiptContext;
      return {
        html: await render(CancellationReceiptEmail(ctx)),
        subject: CANCELLATION_RECEIPT_SUBJECT(ctx),
      };
    }
    case "payment_receipt": {
      const ctx = context as unknown as PaymentReceiptContext;
      return {
        html: await render(PaymentReceiptEmail(ctx)),
        subject: PAYMENT_RECEIPT_SUBJECT(ctx),
      };
    }
    default: {
      const exhaustive: never = template_type;
      throw new Error(`Unknown template_type: ${exhaustive as string}`);
    }
  }
}
