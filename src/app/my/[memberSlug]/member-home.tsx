"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMember, useStore, usePlans, formatRelative } from "@/lib/store";
import type { StudioClass } from "@/app/app/classes/data";
import type { PurchaseRecord } from "@/lib/db";
import {
  decideEligibility,
  consumedLabel,
  consumptionLabel,
  restorationForCancel,
} from "@/lib/eligibility";
import {
  summariseMembership,
  accessTypeLabel,
  type MembershipTone,
} from "@/lib/memberships";
import { PlansSection } from "./plans-section";
import { findPlan, formatPriceEur, type Plan } from "@/lib/plans";

/**
 * v0.11.0 Member Home Foundation.
 *
 * A member's landing page. Structured as sections so it can grow into
 * a proper member app over subsequent releases without re-architecting
 * the route. For v0.11.0 the sections are:
 *
 *   Greeting       — first name + today's date.
 *   Membership     — plan, access type, credits / pack size, summary.
 *   Your classes   — upcoming bookings + waitlist entries. Cancel
 *                    action on upcoming rows, routed through
 *                    sf_cancel_booking. Late-cancel warning up front.
 *   Browse classes — other upcoming classes with Book / Join waitlist /
 *                    Unavailable actions, routed through sf_book_member.
 *   Outcome card   — persistent, dismissable result of the most recent
 *                    action.
 *
 * No new booking logic. Every mutation goes through the shared store
 * which calls the exact same sf_* server functions the operator view
 * uses.
 */

// ── Outcome state ───────────────────────────────────────────────────
type Outcome =
  | {
      kind: "booked";
      className: string;
      when: string;
      consumption: string;
    }
  | {
      kind: "waitlisted";
      className: string;
      when: string;
      position: number;
    }
  | {
      kind: "already-in";
      className: string;
      when: string;
    }
  | {
      kind: "cancelled";
      className: string;
      when: string;
      creditRestored: boolean;
    }
  | {
      kind: "late-cancel";
      className: string;
      when: string;
    }
  | {
      kind: "blocked";
      className: string;
      reason: string;
      hint: string;
    }
  | {
      /** v0.13.0 real purchase completed via Stripe Checkout. */
      kind: "purchase_success";
      planName: string;
      creditsRemaining: number | null;
    }
  | {
      /** v0.13.0 fake-mode purchase completed because Stripe isn't configured. */
      kind: "purchase_fake";
      planName: string;
      creditsRemaining: number | null;
    }
  | {
      /** v0.13.0 Stripe Checkout was cancelled by the user. */
      kind: "purchase_cancelled";
    }
  | {
      kind: "error";
      text: string;
    };

// ── Tone palette (matches the operator Membership panel) ───────────
const toneText: Record<MembershipTone, string> = {
  positive: "text-green-400",
  neutral: "text-white/60",
  attention: "text-amber-400",
  blocked: "text-red-400",
};
const toneBorder: Record<MembershipTone, string> = {
  positive: "border-green-400/25",
  neutral: "border-white/15",
  attention: "border-amber-400/30",
  blocked: "border-red-400/30",
};

// ── Status pill for Your classes row ───────────────────────────────
function myStatusLabel(
  attendeeStatus: string | undefined,
  waitlistPosition: number | undefined,
): string {
  if (attendeeStatus === "checked_in") return "Checked in";
  if (attendeeStatus === "booked") return "Booked";
  if (attendeeStatus === "no_show") return "No-show";
  if (attendeeStatus === "late_cancel") return "Late cancel";
  if (waitlistPosition !== undefined) return `Waitlist #${waitlistPosition}`;
  return "Booked";
}

// ── Outcome card ────────────────────────────────────────────────────
function OutcomeCard({
  outcome,
  onDismiss,
}: {
  outcome: Outcome;
  onDismiss: () => void;
}) {
  const palette = (() => {
    switch (outcome.kind) {
      case "booked":
      case "cancelled":
      case "purchase_success":
        return { border: "border-green-400/30", text: "text-green-400" };
      case "waitlisted":
      case "already-in":
      case "purchase_fake":
        return { border: "border-white/25", text: "text-white/80" };
      case "late-cancel":
      case "blocked":
      case "purchase_cancelled":
        return { border: "border-amber-400/40", text: "text-amber-400" };
      case "error":
        return { border: "border-red-400/40", text: "text-red-400" };
    }
  })();

  const title = (() => {
    switch (outcome.kind) {
      case "booked":
        return `Booked — ${outcome.className}`;
      case "waitlisted":
        return `Added to waitlist — ${outcome.className}`;
      case "already-in":
        return `You're already in ${outcome.className}`;
      case "cancelled":
        return `Cancelled — ${outcome.className}`;
      case "late-cancel":
        return `Late cancel — ${outcome.className}`;
      case "blocked":
        return `Can't book ${outcome.className}`;
      case "purchase_success":
        return `Purchase complete — ${outcome.planName}`;
      case "purchase_fake":
        return `Test purchase complete — ${outcome.planName}`;
      case "purchase_cancelled":
        return "Checkout cancelled";
      case "error":
        return "Something went wrong";
    }
  })();

  const detail = (() => {
    switch (outcome.kind) {
      case "booked":
        return `${outcome.when} · ${outcome.consumption}`;
      case "waitlisted":
        return `${outcome.when} · Position #${outcome.position} (first come, first served)`;
      case "already-in":
        return outcome.when;
      case "cancelled":
        return outcome.creditRestored
          ? `${outcome.when} · 1 credit restored`
          : outcome.when;
      case "late-cancel":
        return `${outcome.when} · No credit returned (cancelled after the window)`;
      case "blocked":
        return `${outcome.reason}. ${outcome.hint}`;
      case "purchase_success":
        return outcome.creditsRemaining !== null
          ? `Your plan is now active — ${outcome.creditsRemaining} credits available.`
          : "Your plan is now active — unlimited access.";
      case "purchase_fake":
        return outcome.creditsRemaining !== null
          ? `Stripe not configured — fake entitlement granted. ${outcome.creditsRemaining} credits now available.`
          : "Stripe not configured — fake unlimited entitlement granted.";
      case "purchase_cancelled":
        return "You closed Stripe Checkout before completing payment. No charge was made and your plan is unchanged.";
      case "error":
        return outcome.text;
    }
  })();

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-4 flex items-start justify-between gap-3 rounded border px-4 py-3 ${palette.border}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-sm font-medium ${palette.text}`}>{title}</span>
        {detail && <span className="text-xs text-white/60">{detail}</span>}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-white/30 hover:text-white/70"
      >
        ×
      </button>
    </div>
  );
}

// ── My upcoming classes row ────────────────────────────────────────
function MyClassRow({
  cls,
  attendeeStatus,
  waitlistPosition,
  onCancel,
  busy,
}: {
  cls: StudioClass;
  attendeeStatus: string | undefined;
  waitlistPosition: number | undefined;
  onCancel: () => void;
  busy: boolean;
}) {
  const statusText = myStatusLabel(attendeeStatus, waitlistPosition);
  const canCancel =
    cls.lifecycle === "upcoming" &&
    (attendeeStatus === "booked" || waitlistPosition !== undefined);
  const cutoffClosed = cls.cancellationWindowClosed === true;

  const statusColor = (() => {
    if (attendeeStatus === "checked_in") return "text-green-400";
    if (attendeeStatus === "no_show" || attendeeStatus === "late_cancel")
      return "text-red-400";
    if (waitlistPosition !== undefined) return "text-amber-400";
    return "text-white/70";
  })();

  return (
    <li className="flex flex-col gap-2 rounded border border-white/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{cls.name}</span>
        <span className="text-xs text-white/50">
          {cls.time} · {cls.instructor}
          {cls.lifecycle === "live" && (
            <span className="ml-2 rounded-full border border-green-400/30 px-1.5 py-0.5 text-[10px] uppercase text-green-400">
              Live
            </span>
          )}
        </span>
        {canCancel && cutoffClosed && (
          <span className="text-[11px] text-amber-400/80">
            Cancellation window closed — cancelling now is a late cancel
            (no credit returned).
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-xs ${statusColor}`}>{statusText}</span>
        {canCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/70 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? "…" : waitlistPosition !== undefined ? "Leave waitlist" : "Cancel"}
          </button>
        )}
      </div>
    </li>
  );
}

// ── Browse row ─────────────────────────────────────────────────────
function BrowseClassRow({
  cls,
  canBook,
  needsPurchase,
  blockedReason,
  blockedHint,
  onAction,
  busy,
}: {
  cls: StudioClass;
  canBook: boolean;
  /**
   * v0.12.0: when the server says !canBook *and* the reason is credits /
   * trial / entitlement (not "not_found"), the right member-facing CTA
   * is "see plans" — not a disabled "Unavailable". Parent derives this
   * from member.bookingAccess.statusCode.
   */
  needsPurchase: boolean;
  blockedReason: string | null;
  blockedHint: string | null;
  onAction: () => void;
  busy: boolean;
}) {
  const nonAuto = cls.attendees.filter((a) => a.promotionType !== "auto").length;
  const spotsLeft = Math.max(0, cls.capacity - nonAuto);
  const isFull = spotsLeft <= 0;

  const capacityLabel = (() => {
    if (isFull) {
      const wl = cls.waitlist?.length ?? 0;
      return `Class full · waitlist position #${wl + 1} available`;
    }
    if (spotsLeft === 1) return "1 spot left";
    return `${spotsLeft} spots available`;
  })();

  const capacityTone = isFull
    ? "text-amber-400/80"
    : spotsLeft === 1
      ? "text-white/70"
      : "text-white/50";

  const actionLabel = canBook
    ? (isFull ? "Join waitlist" : "Book")
    : (needsPurchase ? "See plans" : "Unavailable");

  return (
    <li className="flex flex-col gap-2 rounded border border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{cls.name}</span>
        <span className="text-xs text-white/50">
          {cls.time} · {cls.instructor}
        </span>
        <span className={`text-[11px] ${capacityTone}`}>{capacityLabel}</span>
        {!canBook && blockedReason && (
          <span className="text-[11px] text-amber-400/80">
            {blockedReason}
            {blockedHint && (
              <span className="ml-1 text-white/40">— {blockedHint}</span>
            )}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {/* v0.12.0: when the member is blocked for purchase reasons,
            the CTA is a link to the Plans section instead of a
            disabled Unavailable button. Same server-truth rule — the
            member still cannot book until they have credits. */}
        {canBook ? (
          <button
            onClick={onAction}
            disabled={busy}
            className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/70 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? "…" : actionLabel}
          </button>
        ) : needsPurchase ? (
          <a
            href="#plans"
            className="rounded border border-amber-400/40 px-2.5 py-1 text-xs text-amber-400/90 hover:text-amber-400 hover:border-amber-400/60"
          >
            {actionLabel}
          </a>
        ) : (
          <button
            disabled
            title={blockedReason ?? undefined}
            className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/70 opacity-30 cursor-not-allowed"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </li>
  );
}

// ── Greeting helpers ───────────────────────────────────────────────
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Today in "Monday 21 April" form. Computed once per render on the
 * client so it reflects the viewer's local weekday. The store already
 * rerenders on any mutation, so this refreshes naturally without
 * needing a live clock.
 */
function todayLabel(now: Date): string {
  return `${WEEKDAY_NAMES[now.getDay()]} ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}`;
}

// ── Member purchase history (v0.18.0) ─────────────────────────────────
//
// Customer-safe view of the same `purchases` rows the operator sees on
// /app/members/[id]. Internal vocabulary (source values like dev_fake /
// operator_manual / fake, external_id, ledger, RPC) is deliberately not
// rendered — the member just sees plan name, status, what they paid,
// what they got, and when. Legacy pre-v0.15.0 rows with NULL economics
// render as "Older purchase record" instead of broken "—" placeholders
// so the member never sees a row that looks malformed.
//
// Reads from the same store action (getPurchases) the operator surface
// uses, so the two views are wired to identical server truth. No new
// schema, no new endpoint.

const MEMBER_STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  refunded: "Refunded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const MEMBER_STATUS_TONES: Record<string, string> = {
  completed: "border-green-400/30 text-green-400",
  refunded: "border-amber-400/30 text-amber-300",
  failed: "border-red-400/30 text-red-400",
  cancelled: "border-white/20 text-white/50",
};

function memberDateLabel(iso: string, now: number): string {
  // Reuse the relative formatter ("just now", "2 days ago", etc.) so
  // the page reads consistently with the existing class outcome cards
  // and the operator credit-history list.
  return formatRelative(new Date(iso).getTime(), now);
}

function MemberPurchaseHistorySection({
  memberSlug,
  plans,
}: {
  memberSlug: string;
  plans: Plan[];
}) {
  const { getPurchases, members } = useStore();
  const [entries, setEntries] = useState<PurchaseRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPurchases(memberSlug, 10).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch when the members collection updates (a refund or a new
    // purchase via member-home Buy fires a store refresh, which
    // changes `members`, which triggers this effect).
  }, [getPurchases, memberSlug, members]);

  if (!entries) return null;

  const now = Date.now();
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-white/70">Purchase history</h2>
      <p className="mt-1 text-xs text-white/40">
        Your most recent purchases. Refunds show up here too.
      </p>
      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-white/40">
          No purchases yet. When you buy a class pack or membership it
          will show up here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((e) => {
            const plan = findPlan(e.planId, plans);
            // Member-safe plan name. Falls back to a generic word
            // rather than the raw plan_id ("pack_5") if the
            // catalogue can't resolve it — the operator surface
            // shows the raw id, but the member shouldn't.
            const planLabel = plan?.name ?? "Plan";
            const statusKey = e.status;
            const statusLabel =
              MEMBER_STATUS_LABELS[statusKey] ?? "Completed";
            const statusTone =
              MEMBER_STATUS_TONES[statusKey] ??
              "border-white/20 text-white/50";

            // A row is "legacy" when it predates v0.15.0 and has no
            // recorded price or credits. The plan_id is still
            // present so the member sees what plan it was — just
            // not the receipt details.
            const isLegacy =
              e.priceCentsPaid === null || e.creditsGranted === null;

            // Whether the plan is unlimited drives the entitlement
            // copy. We use the resolved plan for this — if the
            // plan can't be resolved, fall back to credits_granted
            // (NULL on the row implies unlimited for non-legacy
            // post-v0.15.0 rows; for legacy rows we render the
            // "older purchase" copy anyway, so this branch only
            // matters for unresolved-but-modern purchases).
            const isUnlimited =
              plan?.type === "unlimited" ||
              (plan === undefined &&
                !isLegacy &&
                e.creditsGranted === null);

            const priceText = e.priceCentsPaid === null
              ? null
              : formatPriceEur(e.priceCentsPaid);
            const entitlementText = isUnlimited
              ? "Unlimited access"
              : e.creditsGranted === null
                ? null
                : e.creditsGranted === 1
                  ? "1 credit added"
                  : `${e.creditsGranted} credits added`;

            return (
              <li key={e.id}>
                {/* v0.18.1: each row is a link to the receipt detail
                    page. Whole-row clickable so phone tap targets are
                    forgiving. */}
                <Link
                  href={`/my/${memberSlug}/purchases/${e.id}`}
                  className="block rounded border border-white/10 px-4 py-2.5 hover:border-white/30 hover:bg-white/[0.02] focus-visible:border-white/40 focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium">{planLabel}</span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusTone}`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  {isLegacy ? (
                    <div className="mt-1 flex flex-col gap-0.5">
                      <span className="text-[11px] text-white/50">
                        Older purchase record
                      </span>
                      <span className="text-[11px] text-white/30">
                        Full receipt details unavailable
                      </span>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-white/40">
                      {priceText && entitlementText
                        ? `${priceText} · ${entitlementText}`
                        : priceText ?? entitlementText ?? ""}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-white/30">
                    {memberDateLabel(e.createdAt, now)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────
export default function MemberHome({ memberSlug }: { memberSlug: string }) {
  const member = useMember(memberSlug);
  const plans = usePlans();
  const { classes, bookMember, cancelBooking, refresh, hydrated } = useStore();
  const [busyClassSlug, setBusyClassSlug] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // v0.15.1 double-submit guard. The React `busyPlanId` state is what
  // disables the buttons in the rendered DOM, but state updates are
  // async — between two rapid clicks (e.g. a double-tap before paint)
  // both invocations of handleBuy can pass `if (busyPlanId)` because
  // neither has seen the setBusyPlanId from the other yet. The ref
  // closes that window: it mutates synchronously, so the second call
  // sees the in-flight plan id immediately and bails. The button is
  // still disabled visually via `busyPlanId`; the ref is the integrity
  // backstop.
  const buyInFlightRef = useRef<string | null>(null);

  // Today's date, computed once per client mount. Memoized so it
  // doesn't retrigger on every outcome/busy change.
  const today = useMemo(() => todayLabel(new Date()), []);

  // v0.13.0: Stripe Checkout redirects back with ?purchase=success or
  // ?purchase=cancel. Detect on mount, show the appropriate outcome
  // card, force a store refresh so the new credits/plan render, and
  // clean the URL so a page refresh doesn't re-fire the outcome.
  const purchaseEffectFiredRef = useRef(false);
  useEffect(() => {
    if (purchaseEffectFiredRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const purchase = params.get("purchase");
    if (!purchase) return;

    purchaseEffectFiredRef.current = true;

    if (purchase === "success") {
      const planId = params.get("plan") ?? "";
      const plan = findPlan(planId, plans);
      if (plan) {
        // Live credits come in via refresh() — seed the card with
        // null and update once the store rehydrates. Keeping it
        // optimistic would risk lying if the webhook hasn't landed.
        setOutcome({
          kind: "purchase_success",
          planName: plan.name,
          creditsRemaining: null,
        });
      }
      void refresh();
    } else if (purchase === "cancel") {
      setOutcome({ kind: "purchase_cancelled" });
    }

    // Strip purchase query params from the URL so reloading doesn't
    // re-trigger the outcome.
    const url = new URL(window.location.href);
    url.searchParams.delete("purchase");
    url.searchParams.delete("plan");
    window.history.replaceState({}, "", url.toString());
  }, [refresh, plans]);

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading…</p>
      </main>
    );
  }

  if (!member) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/60 text-sm">We couldn&apos;t find that member.</p>
        <Link
          href="/"
          className="mt-4 inline-block text-xs text-white/40 hover:text-white/70"
        >
          ← Back home
        </Link>
      </main>
    );
  }

  const membership = summariseMembership(member, plans);
  const eligibility = decideEligibility(member);
  const firstName = member.name.split(" ")[0];

  // v0.12.0: "no credits" and "member is blocked from the product" are
  // different things. The server-truth `canBook` stays the authority
  // for booking; `needsPurchase` is the separate UI concept that drives
  // the member-facing CTA toward the plans section instead of a
  // disabled-looking "Unavailable" state. The `not_found` status
  // deliberately falls through to generic Unavailable — buying
  // doesn't help if the record isn't there.
  const needsPurchase =
    !member.bookingAccess.canBook &&
    (member.bookingAccess.statusCode === "no_credits" ||
      member.bookingAccess.statusCode === "trial_used" ||
      member.bookingAccess.statusCode === "no_entitlement");

  // v0.13.3 temporal-sanity partition. Every class the member has a
  // row against is sorted into exactly one of three buckets:
  //
  //   Your upcoming classes — genuinely future or in-progress, still
  //     actionable from the member's point of view.
  //   Recent class activity — the class is over for the member
  //     (completed lifecycle OR terminal attendee status like
  //     no_show / late_cancel / cancelled). Read-only.
  //   Browse classes       — upcoming classes the member is NOT in.
  //
  // The prior rule only checked `lifecycle !== "completed"` and never
  // looked at attendee.status, which let late_cancel / no_show rows
  // leak into Your upcoming classes during live classes.
  type MyClassEntry = {
    cls: StudioClass;
    attendeeStatus: string | undefined;
    waitlistPosition: number | undefined;
  };
  const TERMINAL_ATTENDEE_STATUSES: ReadonlyArray<string> = [
    "no_show",
    "late_cancel",
    "cancelled",
  ];
  function isTerminalStatus(s: string | undefined): boolean {
    return s !== undefined && TERMINAL_ATTENDEE_STATUSES.includes(s);
  }

  const myClasses: MyClassEntry[] = [];
  const recentActivity: MyClassEntry[] = [];
  const browseClasses: StudioClass[] = [];
  for (const cls of classes) {
    const attendee = cls.attendees.find((a) => a.memberId === member.id);
    const waitlistEntry = cls.waitlist?.find((w) => w.memberId === member.id);
    const memberHasRow = attendee !== undefined || waitlistEntry !== undefined;

    // Recent activity: member has a row AND (class is completed OR
    // attendee status is terminal). Terminal status in a live/upcoming
    // class means the outcome is already settled — late cancel on a
    // still-upcoming class is the common case.
    if (
      memberHasRow &&
      (cls.lifecycle === "completed" || isTerminalStatus(attendee?.status))
    ) {
      recentActivity.push({
        cls,
        attendeeStatus: attendee?.status,
        waitlistPosition: waitlistEntry?.position,
      });
      continue;
    }

    // Your upcoming classes: member has a row, class is not completed,
    // attendee status (if any) is still open (booked / checked_in).
    if (memberHasRow && cls.lifecycle !== "completed") {
      myClasses.push({
        cls,
        attendeeStatus: attendee?.status,
        waitlistPosition: waitlistEntry?.position,
      });
      continue;
    }

    // Browse: upcoming class the member is NOT in.
    if (!memberHasRow && cls.lifecycle === "upcoming") {
      browseClasses.push(cls);
    }
  }
  // Recent activity newest-first, capped at 5.
  recentActivity.sort((a, b) => {
    const atA = a.cls.checkInOpensAt;
    const atB = b.cls.checkInOpensAt;
    return atB.localeCompare(atA);
  });
  const recentActivityCapped = recentActivity.slice(0, 5);

  async function handleBook(cls: StudioClass) {
    if (busyClassSlug || !member) return;
    setBusyClassSlug(cls.id);
    setOutcome(null);
    const when = `${cls.time} · ${cls.instructor}`;
    try {
      const result = await bookMember(cls.id, member.id);
      if (result.status === "blocked") {
        setOutcome({
          kind: "blocked",
          className: cls.name,
          reason: result.access.reason,
          hint: result.access.actionHint,
        });
      } else if (result.alreadyExists) {
        setOutcome({
          kind: "already-in",
          className: cls.name,
          when,
        });
      } else if (result.status === "booked") {
        setOutcome({
          kind: "booked",
          className: cls.name,
          when,
          consumption: consumedLabel(eligibility),
        });
      } else {
        const waitlistBefore = cls.waitlist?.length ?? 0;
        setOutcome({
          kind: "waitlisted",
          className: cls.name,
          when,
          position: waitlistBefore + 1,
        });
      }
    } catch (e) {
      setOutcome({
        kind: "error",
        text: e instanceof Error ? e.message : "Booking failed",
      });
    } finally {
      setBusyClassSlug(null);
    }
  }

  async function handleCancel(entry: MyClassEntry) {
    if (busyClassSlug || !member) return;
    const cls = entry.cls;
    setBusyClassSlug(cls.id);
    setOutcome(null);
    const when = `${cls.time} · ${cls.instructor}`;
    const isWaitlistLeave = entry.waitlistPosition !== undefined;
    // Predict restoration locally for the success copy. Server remains
    // authoritative; we only use this to shape the sentence.
    const predicted = restorationForCancel(membership.accessType, false);
    try {
      const result = await cancelBooking(cls.id, member.id);
      if (result.result === "late_cancel") {
        setOutcome({ kind: "late-cancel", className: cls.name, when });
      } else {
        setOutcome({
          kind: "cancelled",
          className: cls.name,
          when,
          creditRestored: !isWaitlistLeave && predicted.restoresCredits === 1,
        });
      }
    } catch (e) {
      setOutcome({
        kind: "error",
        text: e instanceof Error ? e.message : "Cancellation failed",
      });
    } finally {
      setBusyClassSlug(null);
    }
  }

  // v0.13.0 real purchase handler.
  //
  //   1. POST /api/stripe/create-checkout-session with { memberSlug,
  //      planId }. The server returns either { mode: "stripe", url }
  //      (real Stripe test-mode checkout) or { mode: "fake" } (no
  //      Stripe env configured).
  //   2. Stripe mode  → redirect the browser to `url`. Stripe sends
  //      the user back to /my/{slug}?purchase=success&plan={id} once
  //      payment completes; the effect above renders the outcome.
  //   3. Fake  mode  → POST /api/dev/fake-purchase with the same
  //      payload. The endpoint calls the SAME applyPurchase function
  //      the Stripe webhook uses, grants the entitlement immediately,
  //      and returns the new credits_remaining. Show the
  //      purchase_fake outcome card and refresh the store.
  async function handleBuy(plan: Plan) {
    if (!member) return;
    // v0.15.1: synchronous double-submit guard. See buyInFlightRef.
    if (buyInFlightRef.current !== null) return;
    buyInFlightRef.current = plan.id;
    setBusyPlanId(plan.id);
    setOutcome(null);
    try {
      const sessionResp = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberSlug: member.id, planId: plan.id }),
      });
      const sessionData = (await sessionResp.json()) as {
        ok?: boolean;
        mode?: "stripe" | "fake";
        url?: string;
        error?: string;
      };

      if (!sessionResp.ok || !sessionData.ok) {
        setOutcome({
          kind: "error",
          text: sessionData.error ?? `Checkout create failed (${sessionResp.status})`,
        });
        setBusyPlanId(null);
        return;
      }

      if (sessionData.mode === "stripe" && sessionData.url) {
        // Leaving the SPA for Stripe-hosted Checkout. On return, the
        // ?purchase=success query param effect at the top of this
        // component will fire.
        window.location.href = sessionData.url;
        return;
      }

      // Fake fallback.
      const fakeResp = await fetch("/api/dev/fake-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // v0.15.0: tag this as a dev-fake (member-initiated, no Stripe
        // configured) so purchase history can distinguish it from
        // operator-initiated test purchases on /app/members/[id].
        body: JSON.stringify({
          memberSlug: member.id,
          planId: plan.id,
          source: "dev_fake",
        }),
      });
      const fakeData = (await fakeResp.json()) as {
        ok?: boolean;
        error?: string;
        creditsRemaining?: number | null;
      };

      if (!fakeResp.ok || !fakeData.ok) {
        setOutcome({
          kind: "error",
          text: fakeData.error ?? `Fake purchase failed (${fakeResp.status})`,
        });
        setBusyPlanId(null);
        return;
      }

      setOutcome({
        kind: "purchase_fake",
        planName: plan.name,
        creditsRemaining: fakeData.creditsRemaining ?? null,
      });
      await refresh();
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      setOutcome({
        kind: "error",
        text: e instanceof Error ? e.message : "Checkout failed",
      });
    } finally {
      buyInFlightRef.current = null;
      setBusyPlanId(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl">
      {/* Greeting */}
      <div>
        <p className="text-xs uppercase tracking-wide text-white/40">{today}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Hi {firstName}
        </h1>
        <p className="mt-1 text-sm text-white/60">
          Here&apos;s your membership, your upcoming classes, and what&apos;s
          available to book today.
        </p>
      </div>

      {/* Membership card */}
      <section
        className={`mt-6 rounded border px-4 py-3 ${toneBorder[membership.tone]}`}
        aria-label="Your membership"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-white/40">
            Your membership
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${toneBorder[membership.tone]} ${toneText[membership.tone]}`}
          >
            {accessTypeLabel(membership)}
          </span>
        </div>
        <p className={`mt-2 text-sm font-medium ${toneText[membership.tone]}`}>
          {membership.summaryLine}
        </p>
        <p className="mt-1 text-xs text-white/50">
          {consumptionLabel(eligibility)}
        </p>
      </section>

      {/* Outcome card (transient) */}
      {outcome && (
        <OutcomeCard outcome={outcome} onDismiss={() => setOutcome(null)} />
      )}

      {/* v0.12.0 unentitled hero — only visible when the server says
          the member can't book for credit / trial / entitlement reasons.
          Not an account block. The member is still welcome in the
          product — they just need to buy credits or a plan before they
          can book. Anchors down to #plans. */}
      {needsPurchase && (
        <section
          className="mt-6 rounded border border-amber-400/40 bg-amber-400/5 px-4 py-3"
          aria-label="Action needed"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-wide text-amber-400/80">
              Get booking again
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-amber-400">
            You can still browse and plan your week — booking resumes once
            you top up.
          </p>
          <p className="mt-1 text-xs text-white/60">
            {member.bookingAccess.reason}. {member.bookingAccess.actionHint}
          </p>
          <a
            href="#plans"
            className="mt-3 inline-block rounded border border-amber-400/50 px-2.5 py-1 text-xs text-amber-400 hover:text-amber-300 hover:border-amber-400/80"
          >
            See plans &darr;
          </a>
        </section>
      )}

      {/* Your classes */}
      <section className="mt-8" aria-label="Your upcoming classes">
        <h2 className="text-sm font-medium text-white/70">
          Your upcoming classes
          <span className="ml-2 text-white/40">{myClasses.length}</span>
        </h2>
        {myClasses.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">
            You don&apos;t have any upcoming classes yet. Browse what&apos;s
            available below to book.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {myClasses.map((entry) => (
              <MyClassRow
                key={entry.cls.id}
                cls={entry.cls}
                attendeeStatus={entry.attendeeStatus}
                waitlistPosition={entry.waitlistPosition}
                onCancel={() => handleCancel(entry)}
                busy={busyClassSlug === entry.cls.id}
              />
            ))}
          </ul>
        )}
      </section>

      {/* v0.13.3 Recent class activity — read-only. Shows the 5 most
          recent classes that are already in a settled outcome from the
          member's perspective (class completed, or attendee status is
          terminal like late_cancel / no_show). Prevents past outcomes
          from leaking into Your upcoming classes. Section is hidden
          entirely when there's nothing to show. */}
      {recentActivityCapped.length > 0 && (
        <section className="mt-8" aria-label="Recent class activity">
          <h2 className="text-sm font-medium text-white/70">
            Recent class activity
            <span className="ml-2 text-white/40">
              {recentActivityCapped.length}
            </span>
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {recentActivityCapped.map((entry) => {
              const s = entry.attendeeStatus;
              const label = (() => {
                if (s === "checked_in") return "Checked in";
                if (s === "no_show") return "No-show";
                if (s === "late_cancel") return "Late cancel";
                if (s === "cancelled") return "Cancelled";
                if (s === "booked") return "Missed check-in";
                return "Attended";
              })();
              const color = (() => {
                if (s === "checked_in") return "text-green-400";
                if (s === "no_show" || s === "late_cancel" || s === "cancelled")
                  return "text-red-400";
                return "text-white/60";
              })();
              return (
                <li
                  key={entry.cls.id}
                  className="flex items-center justify-between rounded border border-white/10 px-4 py-2"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm">{entry.cls.name}</span>
                    <span className="text-xs text-white/40">
                      {entry.cls.time} · {entry.cls.instructor}
                    </span>
                  </div>
                  <span className={`shrink-0 text-xs ${color}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Browse classes */}
      <section className="mt-8" aria-label="Browse classes">
        <h2 className="text-sm font-medium text-white/70">
          Browse classes
          <span className="ml-2 text-white/40">{browseClasses.length}</span>
        </h2>
        {browseClasses.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">
            No upcoming classes available right now.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {browseClasses.map((cls) => (
              <BrowseClassRow
                key={cls.id}
                cls={cls}
                canBook={member.bookingAccess.canBook}
                needsPurchase={needsPurchase}
                blockedReason={
                  member.bookingAccess.canBook ? null : member.bookingAccess.reason
                }
                blockedHint={
                  member.bookingAccess.canBook ? null : member.bookingAccess.actionHint
                }
                onAction={() => handleBook(cls)}
                busy={busyClassSlug === cls.id}
              />
            ))}
          </ul>
        )}
      </section>

      {/* v0.12.0 Plans & credit packs — always visible. For unentitled
          members this is the onward path from the hero above. For
          entitled members it sits at the bottom as a quiet reactivation
          surface when they eventually run out. v0.13.0 wires the Buy
          button to real Stripe Checkout (test mode) or the fake
          fallback. */}
      <PlansSection
        plans={plans.filter((p) => p.active)}
        onBuy={handleBuy}
        busyPlanId={busyPlanId}
      />

      {/* v0.18.0 Member purchase history — what the member has bought,
          what was refunded. Sits after PlansSection so the order reads
          "what's available" then "what you've done". Customer-safe
          copy only; internal source/external_id never rendered. */}
      <MemberPurchaseHistorySection
        memberSlug={member.id}
        plans={plans}
      />
    </main>
  );
}
