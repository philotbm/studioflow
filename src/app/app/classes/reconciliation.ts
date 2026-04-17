import type { StudioClass } from "./data";

/**
 * v0.8.5 attendance reconciliation.
 *
 * Pure derivations from the StudioClass + attendees shape the rest of
 * the app already uses. No new data source, no AI, no guessing — every
 * field below can be pointed at a specific row state.
 *
 * The functions here are deliberately dumb on purpose: one pass over
 * attendees, bucket counts, a handful of ratios, a small rule table
 * that picks a tone and produces a one-sentence human interpretation.
 * Anything fancier belongs in a later release that actually has the
 * context to justify it (member-behaviour scoring, instructor KPIs,
 * payment reconciliation, etc.).
 */

export type ReconciliationTone = "good" | "neutral" | "watch" | "alert";

export type ReconciliationSignal = {
  label: string;
  tone: ReconciliationTone;
};

export type ReconciliationSummary = {
  // Raw counts
  checkedInCount: number;
  noShowCount: number;
  lateCancelCount: number;
  pendingCount: number; // status='booked' rows still awaiting check-in / finalise
  waitlistCount: number;
  capacity: number;

  // Derived counts
  // rosterCount   — every booked-or-checked-in seat at time of class
  //                 (excludes late cancellations)
  // plannedCount  — everyone who held a seat into the class, including
  //                 late cancellers, so late-cancel impact can be shown
  rosterCount: number;
  plannedCount: number;

  // Ratios in 0..1, null when the denominator is 0 (no meaningful value)
  fillRate: number | null;
  attendanceRate: number | null;
  noShowRate: number | null;
  lateCancelShare: number | null;

  // Operator-facing signals and the dominant tone (worst-case wins)
  signals: ReconciliationSignal[];
  tone: ReconciliationTone;

  // Headline + one-sentence plain-English interpretation
  headline: string;
  interpretation: string;
};

/** Lowest-priority tone first so `pickTone` can just take the max. */
const TONE_RANK: Record<ReconciliationTone, number> = {
  good: 0,
  neutral: 1,
  watch: 2,
  alert: 3,
};

function pickTone(signals: ReconciliationSignal[]): ReconciliationTone {
  if (signals.length === 0) return "neutral";
  return signals.reduce<ReconciliationTone>(
    (worst, s) => (TONE_RANK[s.tone] > TONE_RANK[worst] ? s.tone : worst),
    "good",
  );
}

function countAttendees(cls: StudioClass) {
  let checkedIn = 0;
  let noShow = 0;
  let lateCancel = 0;
  let pending = 0;
  for (const a of cls.attendees) {
    switch (a.status) {
      case "checked_in":
        checkedIn++;
        break;
      case "no_show":
        noShow++;
        break;
      case "late_cancel":
        lateCancel++;
        break;
      case "booked":
        pending++;
        break;
    }
  }
  return { checkedIn, noShow, lateCancel, pending };
}

function roundPct(x: number): number {
  return Math.round(x * 100);
}

function formatPct(x: number | null): string {
  return x === null ? "—" : `${roundPct(x)}%`;
}

/**
 * Completed-class reconciliation. The class is over; checked_in /
 * no_show / late_cancel are the finalised outcomes.
 */
function reconcileCompleted(cls: StudioClass): ReconciliationSummary {
  const { checkedIn, noShow, lateCancel, pending } = countAttendees(cls);
  const rosterCount = checkedIn + noShow; // seats held into class
  const plannedCount = rosterCount + lateCancel; // plus drop-offs
  const waitlistCount = cls.waitlistCount;
  const capacity = cls.capacity;

  const attendanceRate = rosterCount > 0 ? checkedIn / rosterCount : null;
  const noShowRate = rosterCount > 0 ? noShow / rosterCount : null;
  const lateCancelShare =
    plannedCount > 0 ? lateCancel / plannedCount : null;
  const fillRate = capacity > 0 ? plannedCount / capacity : null;

  const signals: ReconciliationSignal[] = [];

  if (rosterCount === 0 && lateCancel === 0) {
    // Nothing to reconcile against — class had no confirmed roster.
    signals.push({ label: "No attendance recorded", tone: "watch" });
    return buildSummary({
      cls,
      checkedIn,
      noShow,
      lateCancel,
      pending,
      rosterCount,
      plannedCount,
      waitlistCount,
      capacity,
      attendanceRate,
      noShowRate,
      lateCancelShare,
      fillRate,
      signals,
      headline: "No attendance recorded",
      interpretation:
        "This class ended with no confirmed roster — nothing to reconcile.",
    });
  }

  // Attendance-rate bucket. Only emitted when there were actual seats
  // to reconcile against.
  if (attendanceRate !== null) {
    if (attendanceRate >= 0.9) {
      signals.push({ label: "Strong turnout", tone: "good" });
    } else if (attendanceRate >= 0.75) {
      signals.push({ label: "Healthy turnout", tone: "good" });
    } else if (attendanceRate >= 0.5) {
      signals.push({ label: "Moderate drop-off", tone: "watch" });
    } else {
      signals.push({ label: "Weak turnout", tone: "alert" });
    }
  }

  // Independent severity signals — surfaced alongside the main bucket.
  if (
    noShowRate !== null &&
    rosterCount >= 3 &&
    noShowRate >= 0.3
  ) {
    signals.push({ label: "High no-show rate", tone: "alert" });
  }
  if (
    lateCancelShare !== null &&
    lateCancel > 0 &&
    lateCancelShare >= 0.2
  ) {
    signals.push({
      label: "Late cancellations reduced turnout",
      tone: "watch",
    });
  }
  if (
    fillRate !== null &&
    fillRate >= 0.9 &&
    attendanceRate !== null &&
    attendanceRate < 0.75
  ) {
    signals.push({ label: "Filled but attendance lagged", tone: "watch" });
  }

  // Headline + interpretation. Deterministic rules over the bucket
  // fields, not string templating from free-form data.
  let headline: string;
  let interpretation: string;

  if (attendanceRate === null) {
    // Happens only when rosterCount was 0 but lateCancel was >0 — all
    // seats late-cancelled before the class.
    headline = "All bookings dropped late";
    interpretation = `${lateCancel} booked ${lateCancel === 1 ? "member" : "members"} late-cancelled — the class ran with no confirmed attendance.`;
  } else if (attendanceRate >= 0.9) {
    headline = "Strong turnout";
    interpretation =
      noShow === 0
        ? `${checkedIn} of ${rosterCount} checked in — no drop-off.`
        : `${checkedIn} of ${rosterCount} checked in — minimal drop-off.`;
  } else if (attendanceRate >= 0.75) {
    headline = "Healthy turnout";
    interpretation = `${checkedIn} of ${rosterCount} checked in; ${noShow} no-show${noShow === 1 ? "" : "s"}.`;
  } else if (attendanceRate >= 0.5) {
    headline = "Moderate drop-off";
    if (lateCancelShare !== null && lateCancelShare >= 0.2) {
      interpretation = `${checkedIn} of ${rosterCount} checked in. Late cancellations (${lateCancel} of ${plannedCount} planned) also reduced turnout.`;
    } else if (fillRate !== null && fillRate >= 0.9) {
      interpretation = `Class filled but attendance lagged — ${checkedIn} checked in out of ${rosterCount} on the roster.`;
    } else {
      interpretation = `${checkedIn} of ${rosterCount} checked in; ${noShow} no-show${noShow === 1 ? "" : "s"}.`;
    }
  } else {
    headline = "Weak turnout";
    interpretation = `Only ${checkedIn} of ${rosterCount} checked in — ${noShow} no-show${noShow === 1 ? "" : "s"}${lateCancel > 0 ? ` and ${lateCancel} late cancellation${lateCancel === 1 ? "" : "s"}` : ""}.`;
  }

  return buildSummary({
    cls,
    checkedIn,
    noShow,
    lateCancel,
    pending,
    rosterCount,
    plannedCount,
    waitlistCount,
    capacity,
    attendanceRate,
    noShowRate,
    lateCancelShare,
    fillRate,
    signals,
    headline,
    interpretation,
  });
}

/**
 * Live-class reconciliation. Class is running right now — pending
 * rows still have time to check in, so attendance rates are computed
 * against the portion of the roster that has already resolved to
 * checked_in or no_show.
 */
function reconcileLive(cls: StudioClass): ReconciliationSummary {
  const { checkedIn, noShow, lateCancel, pending } = countAttendees(cls);
  const rosterCount = checkedIn + noShow + pending;
  const plannedCount = rosterCount + lateCancel;
  const waitlistCount = cls.waitlistCount;
  const capacity = cls.capacity;

  const attendanceRate =
    rosterCount > 0 ? checkedIn / rosterCount : null;
  const noShowRate = rosterCount > 0 ? noShow / rosterCount : null;
  const lateCancelShare =
    plannedCount > 0 ? lateCancel / plannedCount : null;
  const fillRate = capacity > 0 ? plannedCount / capacity : null;

  const signals: ReconciliationSignal[] = [];

  if (rosterCount === 0) {
    signals.push({ label: "No roster", tone: "watch" });
    return buildSummary({
      cls,
      checkedIn,
      noShow,
      lateCancel,
      pending,
      rosterCount,
      plannedCount,
      waitlistCount,
      capacity,
      attendanceRate,
      noShowRate,
      lateCancelShare,
      fillRate,
      signals,
      headline: "No roster",
      interpretation: "No booked members arrived for this live class.",
    });
  }

  const liveAttendedRate = rosterCount > 0 ? checkedIn / rosterCount : 0;
  if (checkedIn > 0) {
    signals.push({
      label: `${checkedIn} checked in`,
      tone: liveAttendedRate >= 0.75 ? "good" : "neutral",
    });
  }
  if (pending > 0) {
    signals.push({ label: `${pending} pending`, tone: "neutral" });
  }

  return buildSummary({
    cls,
    checkedIn,
    noShow,
    lateCancel,
    pending,
    rosterCount,
    plannedCount,
    waitlistCount,
    capacity,
    attendanceRate,
    noShowRate,
    lateCancelShare,
    fillRate,
    signals,
    headline: "In progress",
    interpretation:
      pending === 0
        ? `All ${rosterCount} members on the roster have checked in or been marked.`
        : `${checkedIn} checked in so far; ${pending} still to arrive.`,
  });
}

/**
 * Upcoming-class reconciliation. Attendance hasn't happened yet, so
 * the useful signals are about demand and fill.
 */
function reconcileUpcoming(cls: StudioClass): ReconciliationSummary {
  const { checkedIn, noShow, lateCancel, pending } = countAttendees(cls);
  // Upcoming seats held = pending (status='booked'). late_cancel isn't
  // in the effective roster; checked_in / no_show shouldn't occur yet
  // but are counted defensively.
  const rosterCount = pending + checkedIn + noShow;
  const plannedCount = rosterCount + lateCancel;
  const waitlistCount = cls.waitlistCount;
  const capacity = cls.capacity;

  const fillRate = capacity > 0 ? rosterCount / capacity : null;
  const lateCancelShare =
    plannedCount > 0 ? lateCancel / plannedCount : null;

  const signals: ReconciliationSignal[] = [];
  let headline: string;
  let interpretation: string;

  if (fillRate === null) {
    headline = "Capacity missing";
    interpretation = "No capacity set — cannot assess demand.";
    signals.push({ label: "Capacity missing", tone: "watch" });
  } else if (rosterCount >= capacity) {
    headline = "Fully booked";
    interpretation =
      waitlistCount > 0
        ? `${rosterCount}/${capacity} booked, ${waitlistCount} on waitlist.`
        : `${rosterCount}/${capacity} booked.`;
    signals.push({ label: "Fully booked", tone: "good" });
    if (waitlistCount > 0) {
      signals.push({ label: `${waitlistCount} waitlisted`, tone: "neutral" });
    }
  } else if (fillRate >= 0.85) {
    headline = "Nearly full";
    interpretation = `${rosterCount}/${capacity} booked — close to capacity.`;
    signals.push({ label: "Nearly full", tone: "good" });
  } else if (fillRate >= 0.5) {
    headline = "Healthy bookings";
    interpretation = `${rosterCount}/${capacity} booked.`;
    signals.push({ label: "Healthy bookings", tone: "neutral" });
  } else if (fillRate >= 0.25) {
    headline = "Open seats";
    interpretation = `${rosterCount}/${capacity} booked — open seats remaining.`;
    signals.push({ label: "Open seats", tone: "neutral" });
  } else {
    headline = "Low bookings";
    interpretation = `Only ${rosterCount}/${capacity} booked so far.`;
    signals.push({ label: "Low bookings", tone: "watch" });
  }

  if (lateCancel > 0) {
    signals.push({
      label: `${lateCancel} late cancel${lateCancel === 1 ? "" : "s"}`,
      tone: "neutral",
    });
  }

  return buildSummary({
    cls,
    checkedIn,
    noShow,
    lateCancel,
    pending,
    rosterCount,
    plannedCount,
    waitlistCount,
    capacity,
    attendanceRate: null,
    noShowRate: null,
    lateCancelShare,
    fillRate,
    signals,
    headline,
    interpretation,
  });
}

type SummaryArgs = {
  cls: StudioClass;
  checkedIn: number;
  noShow: number;
  lateCancel: number;
  pending: number;
  rosterCount: number;
  plannedCount: number;
  waitlistCount: number;
  capacity: number;
  attendanceRate: number | null;
  noShowRate: number | null;
  lateCancelShare: number | null;
  fillRate: number | null;
  signals: ReconciliationSignal[];
  headline: string;
  interpretation: string;
};

function buildSummary(a: SummaryArgs): ReconciliationSummary {
  return {
    checkedInCount: a.checkedIn,
    noShowCount: a.noShow,
    lateCancelCount: a.lateCancel,
    pendingCount: a.pending,
    waitlistCount: a.waitlistCount,
    capacity: a.capacity,
    rosterCount: a.rosterCount,
    plannedCount: a.plannedCount,
    fillRate: a.fillRate,
    attendanceRate: a.attendanceRate,
    noShowRate: a.noShowRate,
    lateCancelShare: a.lateCancelShare,
    signals: a.signals,
    tone: pickTone(a.signals),
    headline: a.headline,
    interpretation: a.interpretation,
  };
}

/** Top-level entry point — dispatch by lifecycle. */
export function reconcileClass(cls: StudioClass): ReconciliationSummary {
  switch (cls.lifecycle) {
    case "completed":
      return reconcileCompleted(cls);
    case "live":
      return reconcileLive(cls);
    case "upcoming":
      return reconcileUpcoming(cls);
  }
}

export { formatPct };
