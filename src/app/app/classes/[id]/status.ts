import type { Attendee, Lifecycle } from "../data";

export type DisplayTone =
  | "neutral"
  | "positive"
  | "warning"
  | "negative"
  | "muted";

export type AttendeeDisplayStatus = {
  label: string;
  tone: DisplayTone;
};

/**
 * Derive a temporally sensible attendee status from the raw seed status
 * and the class lifecycle. Pre-class attendees should look like booking
 * states; post-class attendees should look like outcome states.
 *
 * This is a display-only layer — the underlying data is untouched so
 * existing seeds and routes keep working.
 */
export function getAttendeeDisplayStatus(
  attendee: Attendee,
  lifecycle: Lifecycle
): AttendeeDisplayStatus {
  const raw = attendee.status;

  if (lifecycle === "upcoming") {
    // Pre-class: only booking-style states make sense.
    // A cancellation after the window closes is locked in before
    // the class starts — we call it out as "Cancelled (late)" so
    // the label reads as a booking event, not an attendance outcome.
    if (raw === "late_cancel") {
      return { label: "Cancelled (late)", tone: "warning" };
    }
    return { label: "Booked", tone: "neutral" };
  }

  if (lifecycle === "live") {
    // In progress: check-in tracking is the meaningful state.
    if (raw === "checked_in" || raw === "attended") {
      return { label: "Checked in", tone: "positive" };
    }
    if (raw === "late_cancel") {
      return { label: "Late cancel", tone: "warning" };
    }
    return { label: "Not checked in", tone: "muted" };
  }

  // Completed: outcomes only.
  if (raw === "attended" || raw === "checked_in") {
    return { label: "Attended", tone: "positive" };
  }
  if (raw === "late_cancel") {
    return { label: "Late cancel", tone: "warning" };
  }
  if (raw === "no_show" || raw === "not_checked_in" || raw === "booked") {
    return { label: "No show", tone: "negative" };
  }
  return { label: raw, tone: "muted" };
}

export const toneBadgeClasses: Record<DisplayTone, string> = {
  neutral: "border-white/15 bg-white/5 text-white/70",
  positive: "border-green-400/25 bg-green-400/10 text-green-300",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  negative: "border-red-400/25 bg-red-400/10 text-red-300",
  muted: "border-white/10 bg-white/[0.03] text-white/40",
};
