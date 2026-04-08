import type { Member } from "../members/data";

// Waitlist-row operator signals.
//
// Two small rules, grounded entirely in existing member data — no new
// scoring, no invented metrics:
//
//   1. Plan signal (always shown when a member record exists).
//      Derived from `member.plan` and `member.credits`:
//        - `credits === null`              → "Unlimited"
//        - plan name contains "trial"      → "Trial"
//        - credits === 0                   → "0 credits left"   (attention)
//        - credits === 1                   → "1 credit left"    (attention)
//        - credits >= 2                    → "N credits left"   (neutral)
//
//   2. Secondary signal (shown only when there is something to say).
//      Priority:
//        - `insights.behaviourLabel === "Needs attention"` → "Reliability risk"
//        - else: the most urgent entry from `member.opportunitySignals`,
//          by tone (attention > positive > neutral).
//      If neither rule fires, no secondary signal is emitted so the row
//      stays clean.
//
// Rows whose waitlist entry has no mapped member record receive zero
// signals and render exactly as they did in v0.4.3.

export type SignalTone = "positive" | "neutral" | "attention";

export type WaitlistSignal = {
  label: string;
  tone: SignalTone;
};

function planSignal(member: Member): WaitlistSignal {
  if (member.credits === null) {
    return { label: "Unlimited", tone: "neutral" };
  }
  if (/trial/i.test(member.plan)) {
    return { label: "Trial", tone: "neutral" };
  }
  if (member.credits <= 0) {
    return { label: "0 credits left", tone: "attention" };
  }
  if (member.credits === 1) {
    return { label: "1 credit left", tone: "attention" };
  }
  return { label: `${member.credits} credits left`, tone: "neutral" };
}

function topOpportunity(member: Member): WaitlistSignal | null {
  const byTone = (tone: SignalTone) =>
    member.opportunitySignals.find((s) => s.tone === tone);
  const pick = byTone("attention") ?? byTone("positive") ?? byTone("neutral");
  return pick ? { label: pick.label, tone: pick.tone } : null;
}

function secondarySignal(member: Member): WaitlistSignal | null {
  if (member.insights.behaviourLabel === "Needs attention") {
    return { label: "Reliability risk", tone: "attention" };
  }
  return topOpportunity(member);
}

export function waitlistSignalsFor(
  member: Member | undefined,
): WaitlistSignal[] {
  if (!member) return [];
  const signals: WaitlistSignal[] = [planSignal(member)];
  const secondary = secondarySignal(member);
  if (secondary) signals.push(secondary);
  return signals;
}
