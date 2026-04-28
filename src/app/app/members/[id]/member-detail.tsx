"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  // v0.16.0: purchase refund — written by sf_refund_purchase. Negative
  // delta equal to the refunded purchase's credits_granted.
  purchase_refund: "Purchase refunded",
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
  // v0.15.1 double-submit guard. setSubmitting is async — between two
  // rapid clicks both calls of handleConfirm can pass `if (submitting)`
  // before either has seen the other's setSubmitting(true). The ref
  // mutates synchronously and closes that window. The button's
  // `disabled={submitting}` is still the primary visual gate; this is
  // the integrity backstop so a double-click can never produce two
  // operator-test purchases for the same operator action.
  const inFlightRef = useRef<boolean>(false);
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
    if (!selected) return;
    // v0.15.1: synchronous double-submit guard. See inFlightRef.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setResult(null);
    try {
      const resp = await fetch("/api/dev/fake-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // v0.15.0: tag this as an operator-initiated test so the
        // purchase history can label it explicitly, separate from
        // member-home self-serve dev fakes.
        body: JSON.stringify({
          memberSlug,
          planId: selected.id,
          source: "operator_manual",
        }),
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
      inFlightRef.current = false;
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
 * v0.13.1 + v0.15.0 Purchase history panel.
 *
 * Reads the v0.13.0 `purchases` table via store.getPurchases. Shows
 * the latest N rows for this member, newest first. Plan-id is mapped
 * to display name via findPlan(); unknown ids (stale catalogue) fall
 * back to the raw id string.
 *
 * v0.15.0 lifecycle fields rendered inline:
 *   - status pill (only 'completed' is written today; the layout is
 *     ready for failed/refunded/cancelled if a future flow needs them).
 *   - source label distinguishes Stripe / dev fake / operator manual /
 *     legacy fake.
 *   - price + credits frozen at apply time, so a plan-price edit later
 *     does not rewrite history. Pre-v0.15.0 rows have NULL economics
 *     and render as "—" rather than fabricating a number.
 *
 * Read-only. The operator cannot issue refunds or edits from here —
 * that would need a dedicated flow wired to sf_apply_purchase's
 * inverse, which is deliberately out of scope.
 */

const PURCHASE_SOURCE_LABELS: Record<string, string> = {
  stripe: "Stripe",
  dev_fake: "Test purchase (no Stripe)",
  operator_manual: "Operator test purchase",
  // Legacy v0.13.0 / v0.14.x rows.
  fake: "Test purchase (legacy)",
};

const PURCHASE_SOURCE_TONES: Record<string, string> = {
  stripe: "border-green-400/30 text-green-400",
  dev_fake: "border-white/20 text-white/50",
  operator_manual: "border-amber-400/30 text-amber-300",
  fake: "border-white/20 text-white/40",
};

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

const PURCHASE_STATUS_TONES: Record<string, string> = {
  completed: "border-green-400/30 text-green-400",
  failed: "border-red-400/30 text-red-400",
  refunded: "border-amber-400/30 text-amber-300",
  cancelled: "border-white/20 text-white/40",
};

/**
 * v0.16.1: per-row refund state. The UI is advisory only — the RPC
 * (sf_refund_purchase) re-enforces every condition server-side, so a
 * row that the UI shows as refundable but the server rejects (e.g.
 * a race where the member just spent a credit) flows through the
 * normal error path. This type lets the row render exactly one
 * canonical message instead of computing a hidden boolean and
 * leaving the operator guessing why the button is missing.
 */
type RefundState =
  | { kind: "available"; creditsToRefund: number }
  | { kind: "already_refunded" }
  | { kind: "unlimited" }
  | { kind: "legacy_no_credits" }
  | {
      kind: "insufficient_credits";
      creditsRemaining: number;
      creditsToRefund: number;
    }
  | { kind: "plan_unknown" }
  | { kind: "non_refundable_status"; status: string };

function deriveRefundState(
  purchase: PurchaseRecord,
  plan: Plan | null,
  memberCreditsRemaining: number | null,
): RefundState {
  if (purchase.status === "refunded") return { kind: "already_refunded" };
  if (purchase.status !== "completed") {
    return { kind: "non_refundable_status", status: purchase.status };
  }
  if (!plan) return { kind: "plan_unknown" };
  if (plan.type === "unlimited") return { kind: "unlimited" };
  if (purchase.creditsGranted == null) return { kind: "legacy_no_credits" };
  // class_pack with credits_granted recorded. For an unlimited member
  // (credits === null) the class-pack credit column is effectively 0,
  // so refund refused via insufficient_credits — same outcome the
  // server would return.
  const remaining = memberCreditsRemaining ?? 0;
  if (remaining < purchase.creditsGranted) {
    return {
      kind: "insufficient_credits",
      creditsRemaining: remaining,
      creditsToRefund: purchase.creditsGranted,
    };
  }
  return { kind: "available", creditsToRefund: purchase.creditsGranted };
}

function refundStateCopy(state: RefundState): string {
  switch (state.kind) {
    case "available":
      return `Can refund: removes ${state.creditsToRefund} credit${
        state.creditsToRefund === 1 ? "" : "s"
      }`;
    case "already_refunded":
      return "Already refunded";
    case "unlimited":
      return "Unlimited refunds need separate handling";
    case "legacy_no_credits":
      return "Refund unavailable: legacy purchase has no recorded credits";
    case "insufficient_credits":
      return `Refund unavailable: member has only ${state.creditsRemaining} credit${
        state.creditsRemaining === 1 ? "" : "s"
      }`;
    case "plan_unknown":
      return "Refund unavailable: plan could not be resolved";
    case "non_refundable_status":
      return `Refund unavailable: status is "${state.status}"`;
  }
}

/**
 * v0.16.1: plain-English mapping for sf_refund_purchase / refund
 * route error codes. Anything not in this map falls back to the raw
 * error string so a future code addition is still informative.
 */
const REFUND_ERROR_LABELS: Record<string, string> = {
  insufficient_credits_to_refund:
    "Refund refused: member has used some of these credits already.",
  unsupported_plan_type:
    "Refund refused: unlimited plan refunds aren't supported yet.",
  no_credits_granted_recorded:
    "Refund refused: this legacy purchase has no recorded credits, so the refund amount is unknown.",
  plan_not_found:
    "Refund refused: this purchase's plan could not be resolved.",
  rpc_missing:
    "Refund refused: the v0.16.0 database migration isn't applied on this environment.",
  not_found: "Refund refused: purchase not found.",
};

function RecentPurchasesPanel({
  memberSlug,
  plans,
  memberCreditsRemaining,
}: {
  memberSlug: string;
  plans: Plan[];
  memberCreditsRemaining: number | null;
}) {
  const { getPurchases, members, refresh } = useStore();
  const [entries, setEntries] = useState<PurchaseRecord[] | null>(null);
  // v0.16.0: per-row UI state. confirmingId is the purchase row
  // currently in "Confirm refund?" mode; refundingRef.current is the
  // purchase id whose refund POST is in flight (synchronous guard
  // matching the v0.15.1 double-submit pattern). feedbackById carries
  // the most recent ok/error message per row so a refund result is
  // visible without dismissing the confirm UI.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [feedbackById, setFeedbackById] = useState<
    Record<string, { kind: "ok"; text: string } | { kind: "error"; text: string }>
  >({});
  const refundingRef = useRef<string | null>(null);

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

  async function handleRefund(purchase: PurchaseRecord) {
    // v0.16.0: synchronous double-submit guard. State updates are
    // async — between two rapid clicks both invocations could pass a
    // React-state check before either has seen the other's set. The
    // ref mutates synchronously and closes that window so a refund
    // POST is never fired twice for one row.
    if (refundingRef.current !== null) return;
    refundingRef.current = purchase.id;
    setFeedbackById((f) => {
      const next = { ...f };
      delete next[purchase.id];
      return next;
    });
    try {
      const resp = await fetch("/api/admin/refund-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId: purchase.id }),
      });
      const data = (await resp.json().catch(() => null)) as
        | {
            ok: true;
            alreadyRefunded?: boolean;
            refundedCredits?: number;
            newBalance?: number;
          }
        | { ok: false; code?: string; error?: string }
        | null;
      if (!data) {
        setFeedbackById((f) => ({
          ...f,
          [purchase.id]: { kind: "error", text: `Refund failed (${resp.status})` },
        }));
        return;
      }
      if (!data.ok) {
        const code = data.code ?? "";
        const labelled = code ? REFUND_ERROR_LABELS[code] : undefined;
        setFeedbackById((f) => ({
          ...f,
          [purchase.id]: {
            kind: "error",
            text: labelled ?? data.error ?? "Refund failed",
          },
        }));
        return;
      }
      // v0.16.1 success copy. Brief specifies:
      //   success      → "Refunded X credits; balance now Y"
      //   already      → "Purchase was already refunded"
      const text = data.alreadyRefunded
        ? "Purchase was already refunded"
        : `Refunded ${data.refundedCredits ?? 0} credit${
            data.refundedCredits === 1 ? "" : "s"
          }; balance now ${data.newBalance ?? "?"}`;
      setFeedbackById((f) => ({
        ...f,
        [purchase.id]: { kind: "ok", text },
      }));
      setConfirmingId(null);
      // Re-hydrate so the Membership / Credit history / Purchase
      // history panels pick up the new state.
      await refresh();
    } finally {
      refundingRef.current = null;
    }
  }

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
        const sourceLabel =
          PURCHASE_SOURCE_LABELS[e.source] ?? e.source;
        const sourceTone =
          PURCHASE_SOURCE_TONES[e.source] ?? "border-white/20 text-white/40";
        const statusLabel =
          PURCHASE_STATUS_LABELS[e.status] ?? e.status;
        const statusTone =
          PURCHASE_STATUS_TONES[e.status] ?? "border-white/20 text-white/40";
        // Resolve type from the live plan if it's still in the
        // catalogue; otherwise fall back to inspecting credits_granted.
        const isUnlimited =
          plan?.type === "unlimited" ||
          (plan === undefined && e.creditsGranted === null);
        const creditsLabel = isUnlimited
          ? "Unlimited access"
          : e.creditsGranted === null
            ? "—"
            : e.creditsGranted === 1
              ? "1 credit added"
              : `${e.creditsGranted} credits added`;
        const priceLabel =
          e.priceCentsPaid === null
            ? "—"
            : formatPriceEur(e.priceCentsPaid);
        // v0.16.1: derive a single explicit refund-state per row and
        // render its canonical helper copy. Replaces the prior
        // boolean (which silently hid the button on every
        // unsupported case and left the operator guessing why).
        // Server (sf_refund_purchase) re-enforces every condition;
        // this is advisory only.
        const refundState = deriveRefundState(e, plan ?? null, memberCreditsRemaining);
        const refundCopy = refundStateCopy(refundState);
        const refundable = refundState.kind === "available";
        const isConfirming = confirmingId === e.id;
        const feedback = feedbackById[e.id];
        const isRefunding = refundingRef.current === e.id;
        return (
          <li
            key={e.id}
            className="rounded border border-white/10 px-4 py-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{planLabel}</span>
                <span className="text-[11px] text-white/40">
                  {priceLabel} · {creditsLabel}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusTone}`}
                >
                  {statusLabel}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${sourceTone}`}
                >
                  {sourceLabel}
                </span>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px]">
              <span className="font-mono text-white/30 truncate">
                {e.externalId}
              </span>
              <span className="shrink-0 text-white/40">
                {formatRelative(new Date(e.createdAt).getTime(), now)}
              </span>
            </div>
            {!isConfirming && (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[11px] text-white/40">
                  {refundCopy}
                </span>
                {refundable && (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(e.id)}
                    className="shrink-0 rounded border border-white/20 px-2 py-1 text-[11px] text-white/60 hover:text-white hover:border-white/40"
                  >
                    Refund
                  </button>
                )}
              </div>
            )}
            {isConfirming && (
              <div
                className="mt-2 flex flex-col gap-2 rounded border border-amber-400/40 bg-amber-400/5 px-3 py-2"
                role="alertdialog"
                aria-label="Confirm purchase refund"
              >
                <p className="text-xs text-amber-200/90">
                  Refund this purchase and remove{" "}
                  <strong className="font-semibold">
                    {e.creditsGranted} credit
                    {e.creditsGranted === 1 ? "" : "s"}
                  </strong>{" "}
                  from this member?
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRefund(e)}
                    disabled={isRefunding}
                    className="rounded border border-amber-400/50 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-400/10 disabled:opacity-30"
                  >
                    {isRefunding ? "Refunding…" : "Confirm refund"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    disabled={isRefunding}
                    className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40 disabled:opacity-30"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {feedback && (
              <p
                className={`mt-2 text-[11px] ${
                  feedback.kind === "error"
                    ? "text-red-400/90"
                    : "text-green-400/80"
                }`}
              >
                {feedback.text}
              </p>
            )}
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
  // v0.19.0: classes feed the next-action "no upcoming bookings" check.
  const { classes } = useStore();

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

  // v0.19.0 next-action signal. Two pragmatic recovery prompts derived
  // from existing data — no new fetch, no schema change.
  //
  // - "Encourage booking" fires when the member has spendable credits
  //   AND no upcoming bookings on the live classes list. Unlimited
  //   members (credits===null) never have a credit count to spend, so
  //   they're excluded — they're handled by the existing booking flow.
  // - "At risk of drop-off" fires when the most recent entry in the
  //   member's seeded history is a late_cancel/cancelled event. The
  //   history JSON is the only per-member event stream available
  //   client-side; this is intentionally lightweight, not an
  //   exhaustive event check.
  const nextActionMessage = (() => {
    const credits = member.credits;
    const hasSpendableCredits = credits !== null && credits > 0;
    const upcomingBookings = classes.filter(
      (cls) =>
        cls.lifecycle === "upcoming" &&
        (cls.attendees.some(
          (a) =>
            a.memberId === member.id &&
            (a.status === "booked" || a.status === "checked_in"),
        ) ||
          (cls.waitlist ?? []).some((w) => w.memberId === member.id)),
    ).length;
    if (hasSpendableCredits && upcomingBookings === 0) {
      return "Encourage booking";
    }
    // The seeded HistoryEvent.type taxonomy is upcoming / attended /
    // late_cancel / no_show / purchase / started — there is no
    // separate 'cancelled' value, so late_cancel is the only
    // cancellation signal we can derive from member.history alone.
    // The brief mentions both; we honour late_cancel here and would
    // need a real booking_events fetch to surface plain cancellations,
    // which is out of scope for v0.19.0 (no new endpoints).
    if (member.history?.[0]?.type === "late_cancel") {
      return "At risk of drop-off";
    }
    return null;
  })();

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

      {/* v0.19.0 next-action signal — small text-only block, no
          styling overhaul. Only renders when one of the recovery
          rules fires; otherwise hidden so the page stays uncluttered
          for healthy members. */}
      {nextActionMessage && (
        <p className="mt-2 text-xs text-white/50">
          <span className="uppercase tracking-wide text-white/30">
            Next action ·{" "}
          </span>
          {nextActionMessage}
        </p>
      )}

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
          <RecentPurchasesPanel
            memberSlug={member.id}
            plans={plans}
            memberCreditsRemaining={member.credits}
          />
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
