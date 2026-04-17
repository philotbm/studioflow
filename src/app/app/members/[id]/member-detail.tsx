"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMember, useStore, formatRelative } from "@/lib/store";
import type { LedgerEntry, ManualAdjustReason } from "@/lib/db";
import { MANUAL_ADJUST_REASONS } from "@/lib/db";
import type {
  Member,
  MemberInsights,
  PurchaseEntry,
  CreditPackPurchase,
} from "../data";
import { decideEligibility, consumptionLabel } from "@/lib/eligibility";

// --- Helpers ---

/**
 * Small display-only helper. v0.8.0 separates three dimensions cleanly:
 *   - account lifecycle (`member.accountStatus`)
 *   - credit balance (`member.credits`)
 *   - booking access (`member.bookingAccess`, server-derived)
 *
 * This helper only dresses up the raw account lifecycle string; it does
 * NOT encode any booking rules — that's the DB's job via
 * v_members_with_access.
 */
function accountLine(member: Member): { label: string; style: string } {
  switch (member.accountStatus) {
    case "active":
      return { label: "Active", style: "text-green-400" };
    case "paused":
      return { label: "Paused", style: "text-amber-400" };
    case "inactive":
      return { label: "Inactive", style: "text-red-400" };
  }
}

const ADJUST_REASON_LABELS: Record<ManualAdjustReason, string> = {
  bereavement: "Bereavement",
  medical: "Medical issue",
  studio_error: "Studio error",
  goodwill: "Goodwill",
  admin_correction: "Admin correction",
  service_recovery: "Service recovery",
};

const LEDGER_REASON_LABELS: Record<string, string> = {
  booking: "Booking",
  cancel_refund: "Cancellation refund",
  auto_promotion: "Auto-promotion",
  manual_promotion: "Manual promotion",
  unpromote_refund: "Unpromote refund",
  bereavement: "Adj · Bereavement",
  medical: "Adj · Medical",
  studio_error: "Adj · Studio error",
  goodwill: "Adj · Goodwill",
  admin_correction: "Adj · Admin correction",
  service_recovery: "Adj · Service recovery",
};

/**
 * Strict integer parser for the delta input. Rejects:
 *   - empty / whitespace-only strings
 *   - anything that isn't a signed integer (e.g. "1e1", "1.5", "0x10", "abc")
 *   - zero (no-op adjustments are disallowed by the DB anyway)
 * Returns null on invalid input — callers must not submit.
 *
 * v0.8.1: replaces the prior `Number(delta)` coercion. `Number("1e1")` was
 * 10, `Number(" 10 ")` was 10 — both valid JS, both surprising on a
 * financial surface. The confirmation step below also echoes this parsed
 * value back verbatim, so the operator sees exactly what will be sent.
 */
function parseDelta(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isInteger(n) || n === 0) return null;
  return n;
}

function ManualAdjustControl({
  memberSlug,
  memberName,
  canAdjust,
}: {
  memberSlug: string;
  memberName: string;
  canAdjust: boolean;
}) {
  const { adjustCredit } = useStore();
  // v0.8.1: start empty. The prior "1" default + post-submit reset to "1"
  // was the root cause of the observed mismatch — the reset made the
  // displayed value disagree with the success feedback.
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<ManualAdjustReason>("goodwill");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Two-phase submit: null = composing, object = pending confirmation.
  // The pending object freezes the exact values that will be sent so the
  // confirmation echo can never drift from the actual submitted payload.
  const [pending, setPending] = useState<
    | null
    | {
        delta: number;
        reason: ManualAdjustReason;
        note: string | null;
      }
  >(null);
  const [feedback, setFeedback] = useState<
    | { kind: "ok"; text: string }
    | { kind: "error"; text: string }
    | null
  >(null);

  if (!canAdjust) {
    return (
      <p className="text-xs text-white/40">
        Credit adjustments are only available for class pack and trial members.
      </p>
    );
  }

  const parsed = parseDelta(delta);
  const canReview = parsed !== null && !busy && !pending;

  function handleReview() {
    if (parsed === null) {
      setFeedback({
        kind: "error",
        text: "Enter a non-zero whole number (e.g. 1 or -2)",
      });
      return;
    }
    // Freeze the payload NOW so subsequent edits to the inputs don't
    // affect what's submitted. This is the single most important safety
    // property of the flow: confirmation text === submitted payload.
    setPending({
      delta: parsed,
      reason,
      note: note.trim() || null,
    });
    setFeedback(null);
  }

  function handleCancel() {
    setPending(null);
  }

  async function handleConfirm() {
    if (!pending) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await adjustCredit(
        memberSlug,
        pending.delta,
        pending.reason,
        pending.note,
      );
      setFeedback({
        kind: "ok",
        text: `Applied ${pending.delta > 0 ? "+" : ""}${pending.delta} · balance now ${res.balanceAfter}`,
      });
      // Clear to empty (NOT "1") so the next adjust requires an
      // explicit typed value. The success feedback is the record of
      // what just happened.
      setDelta("");
      setNote("");
      setPending(null);
    } catch (e) {
      setFeedback({
        kind: "error",
        text: e instanceof Error ? e.message : "Adjustment failed",
      });
      // Leave the pending state in place so the operator can retry
      // without re-typing, unless they cancel.
    } finally {
      setBusy(false);
    }
  }

  const fbColor =
    feedback?.kind === "error" ? "text-red-400/90" : "text-green-400/80";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          pattern="[+-]?\d+"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="e.g. 1 or -2"
          disabled={pending !== null || busy}
          className="w-28 rounded border border-white/20 bg-black px-2 py-1.5 text-xs text-white/80 outline-none focus:border-white/40 disabled:opacity-50"
          aria-label="Delta"
        />
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as ManualAdjustReason)}
          disabled={pending !== null || busy}
          className="rounded border border-white/20 bg-black px-2 py-1.5 text-xs text-white/80 outline-none focus:border-white/40 disabled:opacity-50"
          aria-label="Reason code"
        >
          {MANUAL_ADJUST_REASONS.map((r) => (
            <option key={r} value={r}>
              {ADJUST_REASON_LABELS[r]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note"
          disabled={pending !== null || busy}
          className="min-w-[10rem] flex-1 rounded border border-white/20 bg-black px-2 py-1.5 text-xs text-white/80 outline-none focus:border-white/40 disabled:opacity-50"
          aria-label="Note"
        />
        <button
          onClick={handleReview}
          disabled={!canReview}
          className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40 disabled:opacity-30"
        >
          Review
        </button>
      </div>

      {/* Two-phase confirmation — echoes the EXACT payload that will be sent. */}
      {pending && (
        <div
          className="mt-1 flex flex-col gap-2 rounded border border-amber-400/40 bg-amber-400/5 px-3 py-2"
          role="alertdialog"
          aria-label="Confirm credit adjustment"
        >
          <p className="text-xs text-amber-200/90">
            Apply{" "}
            <strong className="font-semibold">
              {pending.delta > 0 ? `+${pending.delta}` : pending.delta}{" "}
              credit{Math.abs(pending.delta) === 1 ? "" : "s"}
            </strong>{" "}
            to <strong className="font-semibold">{memberName}</strong> for{" "}
            <strong className="font-semibold">
              {ADJUST_REASON_LABELS[pending.reason]}
            </strong>
            {pending.note ? (
              <>
                {" "}— <em className="not-italic text-white/70">{pending.note}</em>
              </>
            ) : null}
            ?
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirm}
              disabled={busy}
              className="rounded border border-amber-400/50 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-400/10 disabled:opacity-30"
            >
              {busy ? "Applying..." : "Confirm"}
            </button>
            <button
              onClick={handleCancel}
              disabled={busy}
              className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40 disabled:opacity-30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {feedback && <span className={`text-xs ${fbColor}`}>{feedback.text}</span>}
      <p className="text-[11px] text-white/30">
        Reason code is required. Positive delta adds credits, negative
        removes. Review and confirm before every adjustment — the
        confirmation shows the exact value that will be written to the
        ledger.
      </p>
    </div>
  );
}

function RecentLedgerPanel({ memberSlug }: { memberSlug: string }) {
  const { getLedger, members } = useStore();
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLedger(memberSlug, 8).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever the members collection updates (i.e. after a
    // book/cancel/adjust) so the ledger reflects fresh state.
  }, [getLedger, memberSlug, members]);

  if (!entries) return null;
  if (entries.length === 0) {
    return <p className="text-xs text-white/40">No credit ledger activity yet.</p>;
  }
  const now = Date.now();
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => {
        const label = LEDGER_REASON_LABELS[e.reasonCode] ?? e.reasonCode;
        const deltaColor = e.delta > 0 ? "text-green-400" : "text-amber-400";
        return (
          <li
            key={e.id}
            className="flex items-center justify-between gap-3 rounded border border-white/10 px-4 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm">{label}</span>
              <span className="text-[11px] text-white/30">
                {e.source === "operator" ? "Operator · " : "System · "}
                {e.note ?? "—"}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className={`text-sm font-semibold ${deltaColor}`}>
                {e.delta > 0 ? `+${e.delta}` : e.delta}
              </span>
              <span className="text-[11px] text-white/30">
                bal {e.balanceAfter} · {formatRelative(new Date(e.createdAt).getTime(), now)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function behaviourColor(label: string): string {
  if (label === "Strong") return "text-green-400";
  if (label === "Mixed") return "text-amber-400";
  return "text-red-400";
}

function reliabilityReasons(ins: MemberInsights): string[] {
  const reasons: string[] = [];
  if (ins.noShows > 0) reasons.push("Misses booked classes");
  if (ins.postCutoffCancels > 0) reasons.push("Cancels close to cutoff");
  if (ins.avgHoldBeforeCancel !== "N/A") {
    const hours = parseFloat(ins.avgHoldBeforeCancel);
    if (!isNaN(hours) && hours >= 5) reasons.push("Holds spots for long periods");
  }
  if (ins.preCutoffCancels > 0 && reasons.length === 0)
    reasons.push("Cancels before cutoff (low impact)");
  return reasons;
}

function revenueImpact(ins: MemberInsights): {
  spotHolding: string;
  spotHoldingColor: string;
  cancellationTiming: string;
  overallImpact: string;
  overallColor: string;
} {
  let spotHolding = "Low";
  let spotHoldingColor = "text-green-400";
  if (ins.avgHoldBeforeCancel !== "N/A") {
    const hours = parseFloat(ins.avgHoldBeforeCancel);
    if (!isNaN(hours)) {
      if (hours >= 5) {
        spotHolding = "High";
        spotHoldingColor = "text-red-400";
      } else if (hours >= 3) {
        spotHolding = "Medium";
        spotHoldingColor = "text-amber-400";
      }
    }
  }

  let cancellationTiming = "N/A";
  const totalCancels = ins.preCutoffCancels + ins.postCutoffCancels;
  if (totalCancels > 0) {
    if (ins.preCutoffCancels > 0 && ins.postCutoffCancels === 0) {
      cancellationTiming = "Early";
    } else if (ins.postCutoffCancels > 0 && ins.preCutoffCancels === 0) {
      cancellationTiming = "Late";
    } else {
      cancellationTiming = "Mixed";
    }
  }

  let overallImpact = "Positive";
  let overallColor = "text-green-400";
  if (ins.noShows > 0) {
    overallImpact = "Negative";
    overallColor = "text-red-400";
  } else if (ins.postCutoffCancels > 0 || ins.behaviourScore < 70) {
    overallImpact = "Neutral";
    overallColor = "text-amber-400";
  }

  return { spotHolding, spotHoldingColor, cancellationTiming, overallImpact, overallColor };
}

function usagePattern(usageLog: { className: string }[]): { label: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const u of usageLog) {
    counts[u.className] = (counts[u.className] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => ({ label, count }));
}

function usageVelocity(entry: CreditPackPurchase): { label: string; color: string } {
  if (entry.creditsUsed === 0) return { label: "Not started", color: "text-white/40" };
  const usedRatio = entry.creditsUsed / entry.totalCredits;
  if (usedRatio >= 0.6) return { label: "Fast", color: "text-green-400" };
  if (usedRatio >= 0.3) return { label: "On track", color: "text-white/60" };
  return { label: "Slow", color: "text-amber-400" };
}

const eventColor: Record<string, string> = {
  upcoming: "text-white/60",
  attended: "text-green-400",
  late_cancel: "text-amber-400",
  no_show: "text-red-400",
  purchase: "text-blue-400",
  started: "text-blue-400",
};

const eventLabel: Record<string, string> = {
  upcoming: "Upcoming",
  attended: "Attended",
  late_cancel: "Late cancel",
  no_show: "No show",
  purchase: "Purchase",
  started: "Started",
};

function statusBadgeStyle(status: string): string {
  switch (status) {
    case "Active": return "text-green-400 border-green-400/30";
    case "Consumed": return "text-white/40 border-white/10";
    case "Expired": return "text-red-400/60 border-red-400/20";
    default: return "text-white/30 border-white/10";
  }
}

function PurchaseCard({ entry }: { entry: PurchaseEntry }) {
  const status = entry.purchaseStatus;
  const isActive = status === "Active";
  const isMuted = !isActive;

  if (entry.type === "credit_pack") {
    const pct = Math.round((entry.creditsUsed / entry.totalCredits) * 100);
    const pattern = usagePattern(entry.usageLog);
    const velocity = usageVelocity(entry);
    return (
      <div className={`rounded border px-4 py-3 ${isMuted ? "border-white/5" : "border-white/10"}`}>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${isMuted ? "text-white/50" : ""}`}>{entry.product}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${statusBadgeStyle(status)}`}>
            {status}
          </span>
        </div>
        <span className="text-xs text-white/30">Purchased {entry.purchaseDate}</span>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <span className="text-xs text-white/40">Used</span>
            <p className="text-sm font-semibold">{entry.creditsUsed}/{entry.totalCredits}</p>
          </div>
          <div>
            <span className="text-xs text-white/40">Remaining</span>
            <p className={`text-sm font-semibold ${entry.creditsRemaining === 0 ? "text-white/30" : entry.creditsRemaining <= 1 ? "text-amber-400" : ""}`}>
              {entry.creditsRemaining}
            </p>
          </div>
          <div>
            <span className="text-xs text-white/40">Last used</span>
            <p className="text-sm font-semibold">{entry.lastUsedDate ?? "\u2014"}</p>
          </div>
          <div>
            <span className="text-xs text-white/40">Velocity</span>
            <p className={`text-sm font-semibold ${velocity.color}`}>{velocity.label}</p>
          </div>
        </div>

        <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
          <div
            className="h-1.5 rounded-full bg-white/30"
            style={{ width: `${pct}%` }}
          />
        </div>

        {pattern.length > 0 && (
          <div className="mt-3">
            <span className="text-xs text-white/30">Usage pattern</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {pattern.map((p) => (
                <span
                  key={p.label}
                  className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/50"
                >
                  {p.label} ({p.count})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (entry.type === "unlimited") {
    return (
      <div className={`rounded border px-4 py-3 ${isMuted ? "border-white/5" : "border-white/10"}`}>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${isMuted ? "text-white/50" : ""}`}>{entry.product}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${statusBadgeStyle(status)}`}>
            {status}
          </span>
        </div>
        <span className="text-xs text-white/30">Started {entry.startDate}</span>
        <div className="mt-3">
          <span className="text-xs text-white/40">Classes since start</span>
          <p className="text-sm font-semibold">{entry.classesAttendedSinceStart}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded border px-4 py-3 ${isMuted ? "border-white/5" : "border-white/10"}`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${isMuted ? "text-white/50" : ""}`}>{entry.product}</span>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${statusBadgeStyle(status)}`}>
          {status}
        </span>
      </div>
      <span className="text-xs text-white/30">Purchased {entry.purchaseDate}</span>
    </div>
  );
}

export default function MemberDetail({ id }: { id: string }) {
  const member = useMember(id);

  if (!member) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading member...</p>
      </main>
    );
  }

  const account = accountLine(member);
  const access = member.bookingAccess; // v0.8.0: server-derived truth
  // v0.9.0: canonical eligibility decision — adds the consumption
  // expectation (0 or 1 credit) that the server payload doesn't carry.
  const eligibilityDecision = decideEligibility(member);
  const ins = member.insights;
  const pi = member.purchaseInsights;
  const reasons = reliabilityReasons(ins);
  const impact = revenueImpact(ins);
  const canAdjust = member.planType === "class_pack" || member.planType === "trial";

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/members"
        className="text-xs text-white/40 hover:text-white/70"
      >
        &larr; Back to members
      </Link>

      {/* Current snapshot */}
      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight">{member.name}</h1>
        <dl className="mt-3 flex flex-col gap-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="text-white/40">Active plan</dt>
            <dd className="text-white/80">{member.plan}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-white/40">Account</dt>
            <dd className={account.style}>{account.label}</dd>
          </div>
          {member.credits !== null && (
            <div className="flex gap-2">
              <dt className="text-white/40">Credits</dt>
              <dd className="text-white/80">{member.credits}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Booking access — server-derived via v_members_with_access */}
      <div
        className={`mt-6 rounded border px-4 py-3 ${
          access.canBook ? "border-green-400/20" : "border-amber-400/30"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-white/40">
            Booking access
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              access.canBook
                ? "border-green-400/30 text-green-400"
                : "border-amber-400/30 text-amber-400"
            }`}
          >
            {access.canBook ? "Can book" : "Blocked"}
          </span>
        </div>
        <p
          className={`mt-2 text-sm font-medium ${
            access.canBook ? "text-white/90" : "text-amber-400/90"
          }`}
        >
          {access.reason}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
          <span>
            <span className="text-white/30">Entitlement:</span>{" "}
            {access.entitlementLabel}
          </span>
          {access.creditsRemaining !== null && (
            <span>
              <span className="text-white/30">Credits left:</span>{" "}
              {access.creditsRemaining}
            </span>
          )}
          {/* v0.9.0 consumption preview — tells the operator at a glance
              whether a booking for this member will burn a credit. Derived
              from the canonical src/lib/eligibility.ts module. */}
          <span>
            <span className="text-white/30">Next booking:</span>{" "}
            {consumptionLabel(eligibilityDecision)}
          </span>
        </div>
        <p className="mt-2 text-xs text-white/40">{access.actionHint}</p>
        {/*
          v0.8.1: the raw machine status code is kept as a low-priority
          diagnostic (title tooltip) so operators still have it for
          support conversations, but it's not part of the primary
          operator-facing messaging anymore.
        */}
        <p
          className="mt-1 text-[10px] uppercase tracking-wide text-white/20"
          title={`Server status code: ${access.statusCode}`}
        >
          status · {access.statusCode}
        </p>
      </div>

      {/* Manual credit adjustment — v0.8.0 */}
      <div className="mt-6 rounded border border-white/10 px-4 py-3">
        <span className="text-xs uppercase tracking-wide text-white/40">
          Manual credit adjustment
        </span>
        <div className="mt-3">
          <ManualAdjustControl
            memberSlug={member.id}
            memberName={member.name}
            canAdjust={canAdjust}
          />
        </div>
      </div>

      {/* Recent credit ledger — v0.8.0 */}
      <div className="mt-6">
        <h2 className="text-sm font-medium text-white/70">Recent credit ledger</h2>
        <div className="mt-3">
          <RecentLedgerPanel memberSlug={member.id} />
        </div>
      </div>

      {/* Opportunity signals */}
      {(member.opportunitySignals ?? []).length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-white/70">Opportunity signals</h2>
          <div className="mt-3 flex flex-col gap-2">
            {member.opportunitySignals.map((s, i) => (
              <div
                key={i}
                className={`rounded border px-4 py-2.5 ${
                  s.tone === "positive"
                    ? "border-green-400/20"
                    : s.tone === "attention"
                      ? "border-amber-400/20"
                      : "border-white/10"
                }`}
              >
                <span
                  className={`text-sm font-medium ${
                    s.tone === "positive"
                      ? "text-green-400"
                      : s.tone === "attention"
                        ? "text-amber-400"
                        : "text-white/60"
                  }`}
                >
                  {s.label}
                </span>
                <p className="mt-0.5 text-xs text-white/40">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Insights</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Attended</span>
            <p className="text-lg font-semibold">{ins.totalAttended}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">No-shows</span>
            <p className={`text-lg font-semibold ${ins.noShows > 0 ? "text-red-400" : ""}`}>
              {ins.noShows}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Cancel rate</span>
            <p className="text-lg font-semibold">{ins.cancellationRate}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Pre-cutoff cancels</span>
            <p className={`text-lg font-semibold ${ins.preCutoffCancels > 0 ? "text-amber-400" : ""}`}>
              {ins.preCutoffCancels}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Post-cutoff cancels</span>
            <p className={`text-lg font-semibold ${ins.postCutoffCancels > 0 ? "text-amber-400" : ""}`}>
              {ins.postCutoffCancels}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Avg hold before cancel</span>
            <p className="text-lg font-semibold">{ins.avgHoldBeforeCancel}</p>
          </div>
        </div>

        {/* Revenue Impact */}
        <div className="mt-4 rounded border border-white/10 px-4 py-3">
          <span className="text-xs text-white/40">Revenue impact</span>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div>
              <span className="text-xs text-white/30">Spot holding</span>
              <p className={`text-sm font-semibold ${impact.spotHoldingColor}`}>{impact.spotHolding}</p>
            </div>
            <div>
              <span className="text-xs text-white/30">Cancel timing</span>
              <p className="text-sm font-semibold text-white/60">{impact.cancellationTiming}</p>
            </div>
            <div>
              <span className="text-xs text-white/30">Overall</span>
              <p className={`text-sm font-semibold ${impact.overallColor}`}>{impact.overallImpact}</p>
            </div>
          </div>
        </div>

        {/* Reliability */}
        <div className="mt-4 rounded border border-white/10 px-4 py-3">
          <span className="text-xs text-white/40">Reliability</span>
          <p className={`text-lg font-semibold ${behaviourColor(ins.behaviourLabel)}`}>
            {ins.behaviourLabel}
            <span className="ml-2 text-xs font-normal text-white/20">
              {ins.behaviourScore}/100
            </span>
          </p>
          {reasons.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {reasons.map((r, i) => (
                <li key={i} className="text-xs text-white/40">
                  &bull; {r}
                </li>
              ))}
            </ul>
          )}
        </div>

        {(ins.classMix ?? []).length > 0 && (
          <div className="mt-4">
            <span className="text-xs text-white/40">Class mix</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(ins.classMix ?? []).map((c) => (
                <span
                  key={c.label}
                  className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-white/60"
                >
                  {c.label} <span className="text-white/30">&times;{c.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Purchase Insights — v0.9.0 defensive: QA fixture members
          (and any member with minimal purchase_insights_json) have no
          activePlan / previousPurchases. Skip the whole section in
          that case so the page still renders. */}
      {pi.activePlan && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-white/70">Purchase insights</h2>
          {pi.buyerPattern && (
            <div className="mt-2 mb-3 text-xs text-white/40">
              Buyer pattern: <span className="text-white/60">{pi.buyerPattern}</span>
            </div>
          )}

          <div className="flex flex-col gap-4">
            <PurchaseCard entry={pi.activePlan} />
            {(pi.previousPurchases ?? []).map((p, i) => (
              <PurchaseCard key={i} entry={p} />
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {(member.history ?? []).length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-white/70">History</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {member.history.map((h, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-4 rounded border border-white/10 px-4 py-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm text-white/80 truncate">{h.event}</span>
                  <span className="text-xs text-white/30">{h.date}</span>
                </div>
                <span className={`shrink-0 text-xs ${eventColor[h.type]}`}>
                  {eventLabel[h.type]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
