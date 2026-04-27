"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMember, useStore, usePlans, formatRelative } from "@/lib/store";
import type { LedgerEntry, ManualAdjustReason, PurchaseRecord } from "@/lib/db";
import { MANUAL_ADJUST_REASONS } from "@/lib/db";
import { findPlan, formatPriceEur, type Plan } from "@/lib/plans";
import type {
  Member,
  MemberInsights,
  OpportunitySignal,
} from "../data";
import { decideEligibility, consumptionLabel } from "@/lib/eligibility";
import {
  summariseMembership,
  accessTypeLabel,
  type MembershipTone,
} from "@/lib/memberships";

// --- Helpers ---

// v0.9.4 / v0.9.4.1: tone palette shared by the Membership panel.
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

const ADJUST_REASON_LABELS: Record<ManualAdjustReason, string> = {
  bereavement: "Bereavement",
  medical: "Medical issue",
  studio_error: "Studio error",
  goodwill: "Goodwill",
  admin_correction: "Admin correction",
  service_recovery: "Service recovery",
};

/**
 * v0.9.1 normalised ledger labels — plain business language at render
 * time. The stored reason_code values in credit_transactions are not
 * changed; this is a display-only translation so the operator reads
 * one consistent vocabulary.
 *
 * Manual adjustment reason codes all map to a single "Manual
 * adjustment" primary label; the specific reason (bereavement /
 * medical / etc.) is surfaced in the subtitle line via
 * MANUAL_REASON_SUBTITLES so it stays visible without cluttering the
 * primary label.
 *
 * "late_cancel" is included defensively so any ledger row that ever
 * carries that reason code renders correctly. Today sf_cancel_booking
 * writes no ledger row for a late_cancel (by policy — no credit is
 * returned), so this entry is latent until/unless that changes.
 */
const LEDGER_REASON_LABELS: Record<string, string> = {
  booking: "Class booked",
  cancel_refund: "Cancellation (credit returned)",
  late_cancel: "Late cancellation (no credit returned)",
  auto_promotion: "Auto-promotion",
  manual_promotion: "Manual promotion",
  unpromote_refund: "Unpromote refund",
  bereavement: "Manual adjustment",
  medical: "Manual adjustment",
  studio_error: "Manual adjustment",
  goodwill: "Manual adjustment",
  admin_correction: "Manual adjustment",
  service_recovery: "Manual adjustment",
};

const MANUAL_REASON_SUBTITLES: Record<string, string> = {
  bereavement: "Bereavement",
  medical: "Medical issue",
  studio_error: "Studio error",
  goodwill: "Goodwill",
  admin_correction: "Admin correction",
  service_recovery: "Service recovery",
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

/**
 * v0.9.1 running balance reconstruction. The ledger API returns rows
 * newest-first; this walks them oldest-first, grounds the sequence in
 * the live member.credits value, and emits a per-row running balance
 * that always agrees with the current snapshot.
 *
 * Algorithm:
 *   - sumDelta = sum of deltas in the returned window
 *   - balanceBeforeWindow = liveCredits − sumDelta
 *   - walk oldest→newest, accumulate: balance_after[i] = balance_after[i-1] + delta[i]
 *   - result: balance_after[N-1] === liveCredits (provably)
 *
 * When liveCredits is null (unlimited-plan members) we fall back to
 * the stored balance_after column so the panel still renders coherently.
 */
function computeRunningBalances(
  entriesNewestFirst: LedgerEntry[],
  liveCredits: number | null,
): Map<string, number> {
  const result = new Map<string, number>();
  if (entriesNewestFirst.length === 0) return result;
  const oldestFirst = [...entriesNewestFirst].reverse();
  if (liveCredits === null) {
    for (const e of oldestFirst) result.set(e.id, e.balanceAfter);
    return result;
  }
  const sumDelta = oldestFirst.reduce((acc, e) => acc + e.delta, 0);
  let running = liveCredits - sumDelta;
  for (const e of oldestFirst) {
    running += e.delta;
    result.set(e.id, running);
  }
  return result;
}

function RecentLedgerPanel({
  memberSlug,
  liveCredits,
}: {
  memberSlug: string;
  liveCredits: number | null;
}) {
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
  const runningBalances = computeRunningBalances(entries, liveCredits);
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => {
        const label = LEDGER_REASON_LABELS[e.reasonCode] ?? e.reasonCode;
        const deltaColor = e.delta > 0 ? "text-green-400" : "text-amber-400";
        const runningBalance = runningBalances.get(e.id) ?? e.balanceAfter;
        const manualReason = MANUAL_REASON_SUBTITLES[e.reasonCode];
        // Subtitle composition: source tag, then — when this row is a
        // manual adjustment — the specific reason, then the operator's
        // note if one was entered.
        const subtitleParts: string[] = [
          e.source === "operator" ? "Operator" : "System",
        ];
        if (manualReason) subtitleParts.push(manualReason);
        if (e.note) subtitleParts.push(e.note);
        return (
          <li
            key={e.id}
            className="flex items-center justify-between gap-3 rounded border border-white/10 px-4 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm">{label}</span>
              <span className="text-[11px] text-white/30">
                {subtitleParts.join(" · ")}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className={`text-sm font-semibold ${deltaColor}`}>
                {e.delta > 0 ? `+${e.delta}` : e.delta}
              </span>
              <span className="text-[11px] text-white/30">
                bal {runningBalance} · {formatRelative(new Date(e.createdAt).getTime(), now)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * v0.14.3 operator test-purchase panel.
 *
 * Lets the operator simulate a successful payment for a member by
 * picking an active plan and committing through the same
 * /api/dev/fake-purchase route the member-home Buy button uses. Plan
 * resolution, idempotency, credit-ledger writes and active-plan
 * gating are entirely server-side — this panel is a thin UI on top of
 * applyPurchase. No new credit logic anywhere.
 *
 * Active-plan filtering is purely a UI guardrail; the server still
 * rejects an inactive id (applyPurchase returns code: "inactive_plan")
 * so a stale dropdown can't grant a stranded entitlement.
 *
 * Step 1 (preview) renders a read-only summary the operator can read
 * before committing. Step 2 (confirm) calls the server. Step 3 shows
 * an inline success line and triggers a store refresh so the
 * Membership panel, Credit history, and Purchase history sections
 * pick up the new state.
 */
function TestPurchasePanel({
  memberSlug,
  plans,
}: {
  memberSlug: string;
  plans: Plan[];
}) {
  const { refresh } = useStore();
  const activePlans = plans.filter((p) => p.active);
  const [selectedId, setSelectedId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | null
    | {
        kind: "ok";
        planName: string;
        planType: "class_pack" | "unlimited";
        creditsAdded: number | null;
        creditsRemaining: number | null;
        alreadyProcessed: boolean;
      }
    | { kind: "error"; text: string }
  >(null);

  // v0.14.3.1: refresh on mount so the dropdown reflects the same
  // active-plan truth /app/plans shows. Both surfaces read the
  // `plans` slice from the global store, but the store hydrates
  // once at provider mount — a tab opened before another tab
  // toggled a plan would otherwise hold stale state. Refreshing
  // here guarantees the operator never sees a deactivated plan in
  // this dropdown.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = selectedId
    ? activePlans.find((p) => p.id === selectedId) ?? null
    : null;

  // Reset any stale success/error message when the operator changes
  // their selection — the previous outcome is no longer relevant.
  useEffect(() => {
    setResult(null);
  }, [selectedId]);

  async function handleConfirm() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const resp = await fetch("/api/dev/fake-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberSlug, planId: selected.id }),
      });
      const data = (await resp.json().catch(() => null)) as
        | {
            ok: true;
            mode?: string;
            externalId?: string;
            alreadyProcessed?: boolean;
            planTypeApplied?: "class_pack" | "unlimited";
            creditsRemaining?: number | null;
          }
        | { ok: false; error: string }
        | null;
      if (!data) {
        setResult({ kind: "error", text: `Request failed (${resp.status})` });
        return;
      }
      if (!data.ok) {
        setResult({ kind: "error", text: data.error });
        return;
      }
      setResult({
        kind: "ok",
        planName: selected.name,
        planType: selected.type,
        creditsAdded: selected.type === "unlimited" ? null : selected.credits,
        creditsRemaining: data.creditsRemaining ?? null,
        alreadyProcessed: data.alreadyProcessed ?? false,
      });
      // Re-hydrate so the Membership / Credit history / Purchase history
      // panels show the new row and the new balance.
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (activePlans.length === 0) {
    return (
      <p className="text-xs text-white/40">
        No active plans available. Create one in{" "}
        <Link href="/app/plans" className="underline hover:text-white/70">
          Plans
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/50">Plan</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded border border-white/20 bg-black px-2 py-1.5 text-sm text-white/80 outline-none focus:border-white/40"
        >
          <option value="">Select an active plan…</option>
          {activePlans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatPriceEur(p.priceCents)}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className="rounded border border-white/15 bg-white/[0.02] px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-white/40">
            Preview
          </p>
          <p className="mt-1 text-sm font-medium">{selected.name}</p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
            <div className="flex gap-1.5">
              <dt className="text-white/30">Type</dt>
              <dd>
                {selected.type === "unlimited" ? "Unlimited" : "Class pack"}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-white/30">Price</dt>
              <dd>{formatPriceEur(selected.priceCents)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-white/30">Grants</dt>
              <dd>
                {selected.type === "unlimited"
                  ? "Unlimited access"
                  : selected.credits === 1
                    ? "1 credit"
                    : `${selected.credits} credits`}
              </dd>
            </div>
          </dl>
          <ul className="mt-3 flex flex-col gap-0.5 text-[11px] text-white/40">
            <li>This will create a purchase for this member.</li>
            <li>Credits will be added immediately.</li>
            <li>This simulates a successful payment (no Stripe).</li>
          </ul>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:text-white hover:border-white/40 disabled:opacity-30"
            >
              {submitting ? "Applying…" : "Confirm test purchase"}
            </button>
          </div>
        </div>
      )}

      {result?.kind === "ok" && (
        <div className="rounded border border-green-400/30 bg-green-400/5 px-3 py-2 text-xs text-green-300">
          <p className="font-medium">Purchase applied</p>
          <p className="mt-0.5 text-green-200/80">
            {result.planName} ·{" "}
            {result.planType === "unlimited"
              ? "Unlimited access"
              : result.creditsAdded === 1
                ? "1 credit added"
                : `${result.creditsAdded} credits added`}
            {result.creditsRemaining !== null &&
              result.planType === "class_pack" &&
              ` · balance now ${result.creditsRemaining}`}
          </p>
          {result.alreadyProcessed && (
            <p className="mt-0.5 text-green-200/60">
              Already processed — no duplicate row created.
            </p>
          )}
        </div>
      )}

      {result?.kind === "error" && (
        <div className="rounded border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-300">
          {result.text}
        </div>
      )}
    </div>
  );
}

/**
 * v0.13.1 Purchase history panel.
 *
 * Reads the v0.13.0 `purchases` table via store.getPurchases. Shows
 * the latest N rows for this member, newest first. Plan-id is mapped
 * to display name via findPlan(); unknown ids (stale catalogue) fall
 * back to the raw id string.
 *
 * Read-only. The operator cannot issue refunds or edits from here —
 * that would need a dedicated flow wired to sf_apply_purchase's
 * inverse, which is not in scope for v0.13.1.
 */
function RecentPurchasesPanel({
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
    // Re-fetch on members collection change (a completed purchase
    // triggers a store refresh, which changes `members`, which
    // re-runs this and picks up the new row).
  }, [getPurchases, memberSlug, members]);

  if (!entries) return null;
  if (entries.length === 0) {
    return (
      <p className="text-xs text-white/40">
        No purchases on record for this member.
      </p>
    );
  }
  const now = Date.now();
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => {
        const plan = findPlan(e.planId, plans);
        const planLabel = plan ? plan.name : e.planId;
        const sourceLabel = e.source === "stripe" ? "Stripe" : "Fake (dev)";
        const sourceTone =
          e.source === "stripe" ? "text-green-400/80" : "text-white/40";
        return (
          <li
            key={e.id}
            className="flex items-center justify-between gap-3 rounded border border-white/10 px-4 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm">{planLabel}</span>
              <span className="text-[11px] text-white/30 font-mono truncate">
                {e.externalId}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className={`text-[11px] ${sourceTone}`}>
                {sourceLabel}
              </span>
              <span className="text-[11px] text-white/30">
                {formatRelative(new Date(e.createdAt).getTime(), now)}
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

/**
 * v0.13.3 Active entitlement card — now consumes the shared
 * `summariseMembership` derivation from src/lib/memberships.ts. Prior
 * to v0.13.3 this surface had its own local `deriveActiveEntitlement`
 * helper; after fixing the "10 of 5" bug at the shared layer, that
 * duplicate was no longer adding anything and it was deleted so every
 * commercial surface on the member pages consumes one truth source.
 *
 * Shows plan name, access type, credits ("X of Y" only when the pack
 * size is known AND the live balance fits inside it), and the server's
 * bookability verdict.
 */
function ActiveEntitlementCard({
  member,
  plans,
}: {
  member: Member;
  plans: Plan[];
}) {
  const summary = summariseMembership(member, plans);
  const isActive = member.bookingAccess.canBook;

  const statusPill = (() => {
    if (isActive && summary.planType === "unlimited") {
      return { label: "Active · unlimited", cls: "text-green-400 border-green-400/30" };
    }
    if (isActive) {
      return { label: "Active", cls: "text-green-400 border-green-400/30" };
    }
    // Inactive for entitlement reasons (credits / trial / drop-in).
    return { label: "Needs top-up", cls: "text-amber-400 border-amber-400/30" };
  })();

  const accessType = (() => {
    switch (summary.planType) {
      case "unlimited": return "Unlimited";
      case "class_pack": return "Credit pack";
      case "trial": return "Trial";
      case "drop_in": return "Drop-in";
    }
  })();

  const creditsLabel = (() => {
    if (summary.creditsRemaining === null) return null; // unlimited / drop-in
    if (summary.totalCredits !== null) {
      return `${summary.creditsRemaining} of ${summary.totalCredits}`;
    }
    return `${summary.creditsRemaining}`;
  })();

  return (
    <div
      className={`rounded border px-4 py-3 ${isActive ? "border-white/15" : "border-amber-400/30"}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{summary.planName}</span>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPill.cls}`}>
          {statusPill.label}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-white/40">Access type</dt>
          <dd className="text-sm font-semibold">{accessType}</dd>
        </div>
        {creditsLabel !== null && (
          <div>
            <dt className="text-xs text-white/40">Credits</dt>
            <dd
              className={`text-sm font-semibold ${
                (summary.creditsRemaining ?? 0) <= 1
                  ? "text-amber-400"
                  : ""
              }`}
            >
              {creditsLabel}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-white/40">Bookable</dt>
          <dd
            className={`text-sm font-semibold ${isActive ? "text-green-400" : "text-amber-400"}`}
          >
            {isActive ? "Yes" : "No"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-white/40">
        Live values — reflect the current `members` row. Purchase
        history below is the authoritative record of when this
        entitlement changed.
      </p>
    </div>
  );
}

/**
 * v0.13.4 opportunity-signal filter. Seed JSON signals are advisory
 * text written at seed time; after a purchase or upgrade they can
 * contradict live state. The filter strips or drops any signal whose
 * text is factually wrong against the current live entitlement.
 *
 * v0.13.2 established the baseline (repurchase/drained/upgrade rules).
 * v0.13.4 adds plan-aware hardening for unlimited members: any
 * credit-pack-economics phrase is a contradiction when the plan has no
 * credit concept. If the invalid phrase sits in one clause of a
 * multi-clause detail (e.g. "Late cancel history and low remaining
 * credits"), the truthful clause is preserved and the invalid clause
 * is stripped. If the label itself encodes credit-pack economics or
 * nothing salvageable remains in the detail, the whole signal is
 * dropped.
 */
const CREDIT_PACK_ECONOMICS_PHRASES = [
  "low remaining credits",
  "low credits",
  "remaining credits",
  "out of credits",
  "running low",
  "final class",
  "final class on pack",
  "last class on pack",
  "last credit",
  "final credit",
  "down to 1 credit",
  "down to one credit",
  "down to her last",
  "down to his last",
  "down to their last",
  "repurchase",
  "ready for another pack",
  "another pack",
  "pack renewal",
  "pack expiry",
  "renewal offer",
  "prompt with renewal",
  "drained",
  "fully consumed",
];

function mentionsCreditPackEconomics(lowerText: string): boolean {
  return CREDIT_PACK_ECONOMICS_PHRASES.some((p) => lowerText.includes(p));
}

/**
 * Split a signal detail on light conjunctions (" and ", "; ") and drop
 * any clause that references credit-pack economics. Returns null when
 * nothing truthful remains, in which case the whole signal should be
 * dropped by the caller.
 */
function stripCreditPackClauses(detail: string): string | null {
  const parts = detail.split(/\s+(?:and|;)\s+/i);
  const kept = parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !mentionsCreditPackEconomics(p.toLowerCase()));
  if (kept.length === 0) return null;
  return kept.join(" and ");
}

/**
 * Healthy-credit threshold for the class_pack low-credit-phrase guard.
 * A class_pack member with more than this many credits is "not low",
 * so stale seed signals that say "low remaining credits" must not
 * leak through. Mirrors PACK_LOW_THRESHOLD in src/lib/memberships.ts
 * so the two surfaces agree on what "low" means.
 */
const HEALTHY_CREDIT_MIN = 3;

function filterOpportunitySignals(
  signals: OpportunitySignal[],
  member: Member,
): OpportunitySignal[] {
  const canBook = member.bookingAccess.canBook;
  const isUnlimited = member.planType === "unlimited";
  const isClassPackOrTrial =
    member.planType === "class_pack" || member.planType === "trial";
  const credits = member.credits ?? 0;
  // v0.14.1: class_pack / trial members with healthy credit balances
  // should NOT be shown stale "low remaining credits" copy. This fires
  // alongside the v0.13.4 unlimited rule to close the symmetric case.
  const hasHealthyCredits = isClassPackOrTrial && credits >= HEALTHY_CREDIT_MIN;

  const result: OpportunitySignal[] = [];
  for (const s of signals) {
    const text = `${s.label} ${s.detail}`.toLowerCase();
    const labelLower = s.label.toLowerCase();

    // v0.13.2: "sell them another pack" / "drained" copy is wrong when
    // live state says the member is bookable.
    const mentionsRepurchase =
      text.includes("repurchase") ||
      text.includes("ready for another pack") ||
      text.includes("drained") ||
      text.includes("fully consumed") ||
      text.includes("likely to repurchase");
    if (mentionsRepurchase && canBook) continue;

    // v0.13.2: upgrade-to-unlimited suggestion once the member already
    // is unlimited.
    const suggestsUnlimitedUpgrade =
      text.includes("upgrade candidate") ||
      text.includes("unlimited would suit");
    if (suggestsUnlimitedUpgrade && isUnlimited) continue;

    // v0.13.2: under-using unlimited once the member no longer has
    // unlimited.
    if (text.includes("under-using unlimited") && !isUnlimited) continue;

    // v0.13.4 + v0.14.1: strip credit-pack-economics phrases when they
    // can't be true for the current member — either unlimited (no
    // credit concept at all) or class_pack with a healthy balance (the
    // "low credits" phrase is stale).
    const shouldStripCreditPackPhrases =
      (isUnlimited || hasHealthyCredits) && mentionsCreditPackEconomics(text);
    if (shouldStripCreditPackPhrases) {
      if (mentionsCreditPackEconomics(labelLower)) continue;
      const rewrittenDetail = stripCreditPackClauses(s.detail);
      if (!rewrittenDetail) continue;
      if (rewrittenDetail !== s.detail) {
        result.push({ ...s, detail: rewrittenDetail });
        continue;
      }
    }

    result.push(s);
  }
  return result;
}

export default function MemberDetail({ id }: { id: string }) {
  const member = useMember(id);
  const plans = usePlans();

  if (!member) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading member...</p>
      </main>
    );
  }

  const access = member.bookingAccess; // v0.8.0: server-derived truth
  // v0.9.0: canonical eligibility decision — adds the consumption
  // expectation (0 or 1 credit) that the server payload doesn't carry.
  const eligibilityDecision = decideEligibility(member);
  // v0.14.0: consolidated commercial-truth summary reads the DB plan
  // catalogue (`plans`) for pack-size derivation. Presentation-only —
  // the DB remains authoritative for booking gating (see `access` above).
  const membership = summariseMembership(member, plans);
  const ins = member.insights;
  // v0.13.2: purchase_insights_json is no longer rendered directly on
  // this page — the Active entitlement card derives from live DB state
  // (plan_type / plan_name / credits_remaining + plan catalogue) and
  // the Purchase history panel reads the purchases table. Seed JSON
  // activePlan / previousPurchases / buyerPattern are kept on the
  // member row for archive but not shown here to prevent drift.
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
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{member.name}</h1>
        {/* v0.11.0: internal launcher for the member-facing home page
            (/my/{slug}). Operator-only convenience — /my has no public
            entry point, so operators need a way to reach any member's
            home while testing. Not a member-visible control. */}
        <Link
          href={`/my/${member.id}`}
          className="text-xs text-white/50 hover:text-white"
          title="Open this member's home page"
        >
          View member home &rarr;
        </Link>
      </div>

      {/* v0.9.4 Membership panel — consolidated commercial truth. The
          server-derived Booking Access panel below is still the
          authoritative gate; this panel exists so an operator can answer
          "what kind of member is this?" in one glance. */}
      <div
        className={`mt-4 rounded border px-4 py-3 ${toneBorder[membership.tone]}`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-white/40">
            Membership
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
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
          <div className="flex gap-1.5">
            <dt className="text-white/30">Plan</dt>
            <dd>{membership.planName}</dd>
          </div>
          {membership.creditsRemaining !== null && (
            <div className="flex gap-1.5">
              <dt className="text-white/30">Credits</dt>
              <dd>
                {membership.totalCredits
                  ? `${membership.creditsRemaining} of ${membership.totalCredits}`
                  : membership.creditsRemaining}
              </dd>
            </div>
          )}
          {membership.startDate && (
            <div className="flex gap-1.5">
              <dt className="text-white/30">
                {membership.planType === "unlimited" ? "Started" : "Purchased"}
              </dt>
              <dd>{membership.startDate}</dd>
            </div>
          )}
          {/* v0.9.4.1: Account row removed. Account status is not yet a
              StudioFlow product concept; nothing displays it here. */}
        </dl>
        {membership.restrictionNote && (
          <p
            className={`mt-2 text-xs ${toneText[membership.tone]} opacity-90`}
          >
            {membership.restrictionNote}
          </p>
        )}
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

      {/* Credit history — v0.9.1: every credit change is recorded here */}
      <div className="mt-6">
        <h2 className="text-sm font-medium text-white/70">Credit history</h2>
        <p className="mt-1 text-xs text-white/40">
          Every credit change is recorded here.
        </p>
        <div className="mt-3">
          <RecentLedgerPanel
            memberSlug={member.id}
            liveCredits={member.credits}
          />
        </div>
      </div>

      {/* v0.14.3 Operator test-purchase panel — placed above Purchase
          history so the operator's read flow is "preview, commit,
          confirm in history". Calls the same /api/dev/fake-purchase
          route the member-home Buy button uses; the active-plan
          guardrail is enforced in the dropdown filter and again
          server-side by applyPurchase. */}
      <div className="mt-6">
        <h2 className="text-sm font-medium text-white/70">Purchase a plan</h2>
        <p className="mt-1 text-xs text-white/40">
          Operator-only. Simulates a successful payment for this
          member — no Stripe call, no money moves. Reuses the same
          server-side fulfilment as a real purchase.
        </p>
        <div className="mt-3">
          <TestPurchasePanel memberSlug={member.id} plans={plans} />
        </div>
      </div>

      {/* v0.13.1 Purchase history — reads the purchases table populated
          by the shared sf_apply_purchase RPC. Visible to operators
          only; this surface is /app/members/[id], not the member's
          own home. */}
      <div className="mt-6">
        <h2 className="text-sm font-medium text-white/70">Purchase history</h2>
        <p className="mt-1 text-xs text-white/40">
          Every completed purchase (Stripe or dev fake) is logged here.
          Newest first.
        </p>
        <div className="mt-3">
          <RecentPurchasesPanel memberSlug={member.id} plans={plans} />
        </div>
      </div>

      {/* Opportunity signals — v0.13.2 filter: seed signals that are
          contradicted by live entitlement state are dropped. See
          filterOpportunitySignals above. */}
      {(() => {
        const visibleSignals = filterOpportunitySignals(
          member.opportunitySignals ?? [],
          member,
        );
        if (visibleSignals.length === 0) return null;
        return (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-white/70">Opportunity signals</h2>
          <div className="mt-3 flex flex-col gap-2">
            {visibleSignals.map((s, i) => (
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
        );
      })()}

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

      {/* v0.13.2 Active entitlement — replaces the old "Purchase
          insights" section. Derived from the live members row + the
          central plan catalogue (src/lib/plans.ts). The seed
          purchase_insights_json (activePlan / previousPurchases /
          buyerPattern) is no longer rendered here because it drifted
          out of date the moment a purchase changed the live entitlement
          — the authoritative record of historical purchases lives
          above in Purchase history (v0.13.1). */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Active entitlement</h2>
        <p className="mt-1 text-xs text-white/40">
          Live truth for this member&apos;s current plan and credit
          balance. Updates on every purchase, adjustment, or booking.
        </p>
        <div className="mt-3">
          <ActiveEntitlementCard member={member} plans={plans} />
        </div>
      </div>

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
