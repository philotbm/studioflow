/**
 * v0.25.0 (Sprint B) — Transactional email type definitions.
 *
 * Each template's props shape mirrors the `context` jsonb shape that
 * the DB triggers (sf_queue_booking_email, sf_queue_purchase_email)
 * snapshot at queue time. The send path NEVER re-queries source rows —
 * snapshotting at trigger time is what makes the receipts deterministic
 * even if the source class / member / purchase mutates later.
 *
 * If you change one of these shapes you MUST also update the
 * `jsonb_build_object(...)` call in the corresponding trigger function
 * in supabase/migrations/v0.25.0_transactional_email.sql. There is no
 * cross-language schema enforcement.
 */

export type EmailTemplateType =
  | "booking_confirmation"
  | "reminder_24h"
  | "waitlist_promote"
  | "cancellation_receipt"
  | "payment_receipt";

/** Shared base — every email knows the studio + member it's addressed to. */
interface BaseContext {
  studio_name: string;
  member_name: string | null;
}

/** Shared class fields snapshotted into context for class-related emails. */
interface ClassContext {
  class_title: string;
  class_starts_at: string; // ISO timestamp
  class_ends_at?: string;
  class_instructor: string;
  class_location: string | null;
  cancellation_window_hours?: number;
}

export interface BookingConfirmationContext extends BaseContext, ClassContext {}

export interface Reminder24hContext extends BaseContext, ClassContext {}

export interface WaitlistPromoteContext extends BaseContext, ClassContext {}

export interface CancellationReceiptContext extends BaseContext {
  class_title: string;
  class_starts_at: string;
  class_instructor: string;
  class_location: string | null;
  refundable: boolean;
  cancellation_kind: "cancelled" | "late_cancel";
}

export interface PaymentReceiptContext extends BaseContext {
  plan_id: string;
  plan_name: string;
  price_cents_paid: number | null;
  credits_granted: number | null;
  source: string;
  external_id: string;
  created_at: string;
}

export type EmailContextByType = {
  booking_confirmation: BookingConfirmationContext;
  reminder_24h: Reminder24hContext;
  waitlist_promote: WaitlistPromoteContext;
  cancellation_receipt: CancellationReceiptContext;
  payment_receipt: PaymentReceiptContext;
};
