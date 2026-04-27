import { formatPriceEur, type Plan, type PlanType } from "@/lib/plans";

/**
 * v0.14.2 shared plan validation.
 *
 * The create-plan flow and the edit-existing-plan flow share the same
 * commercial-shape rules (a plan must have a sane name, a non-negative
 * price, and a credit count appropriate to its type) and the same soft
 * warnings (suspicious prices, weird per-credit ratios, overlong
 * names, duplicate active names / credit counts). v0.14.1 inlined all
 * of this in /app/plans/page.tsx; v0.14.2 lifts it here so the edit
 * surface and the server route can reuse the exact same checks
 * without drifting from the create form.
 *
 * The functions here are pure — no DB, no React. The UI passes the
 * current `plans` slice in for duplicate detection; the server passes
 * its own DB-truth list. Both call sites get identical answers.
 */

// Suspicious-price heuristics — intentionally loose. The point is to
// catch "€2000 for a 5-class pack" style mistakes, not to police
// legitimate high-end studios.
export const PRICE_SUSPICIOUS_LOW_CENTS  = 500;    // < €5 total
export const PRICE_SUSPICIOUS_HIGH_CENTS = 50000;  // > €500 total
export const PER_CREDIT_LOW_CENTS        = 500;    // < €5/credit
export const PER_CREDIT_HIGH_CENTS       = 10000;  // > €100/credit
export const CREDITS_SUSPICIOUS_HIGH     = 50;     // > 50 credits/pack

/**
 * Commercial shape an operator can submit. The id is NOT in here —
 * create derives it server-side, edit holds it constant.
 */
export type PlanShape = {
  name: string;
  type: PlanType;
  priceCents: number | null;
  credits: number | null;
};

export type HardError = { field: "name" | "type" | "priceCents" | "credits"; message: string };

/**
 * Hard validation — these errors block submission both in the UI and
 * on the server. Returns an empty array when the shape is acceptable.
 */
export function validatePlanHard(input: PlanShape): HardError[] {
  const errors: HardError[] = [];
  if (!input.name || input.name.trim().length === 0) {
    errors.push({ field: "name", message: "Please enter a plan name." });
  }
  if (input.type !== "class_pack" && input.type !== "unlimited") {
    errors.push({ field: "type", message: "Plan type must be Class pack or Unlimited." });
  }
  if (input.priceCents === null || !Number.isInteger(input.priceCents) || input.priceCents < 0) {
    errors.push({ field: "priceCents", message: "Please enter a valid price." });
  }
  if (input.type === "class_pack") {
    if (input.credits === null || !Number.isInteger(input.credits) || input.credits <= 0) {
      errors.push({
        field: "credits",
        message: "Class pack plans need a whole-number credit count above 0.",
      });
    }
  } else if (input.type === "unlimited") {
    if (input.credits !== null) {
      errors.push({
        field: "credits",
        message: "Unlimited plans don't carry a credit count.",
      });
    }
  }
  return errors;
}

/**
 * Soft warnings — these surface as amber callouts and require an
 * explicit "create/save anyway" override before the form will submit.
 *
 * `excludeId` lets the edit flow skip the plan being edited when
 * checking for duplicate-name / duplicate-meaning collisions; without
 * it, an in-place edit would always warn about itself.
 */
export function planSoftWarnings(
  input: PlanShape,
  plans: ReadonlyArray<Plan>,
  options: { excludeId?: string } = {},
): string[] {
  const out: string[] = [];
  const nameTrimmed = input.name.trim();
  if (!nameTrimmed) return out;

  const nameLower = nameTrimmed.toLowerCase();
  const excludeId = options.excludeId;

  // Duplicate active name — inactive lookalikes are fine.
  const nameClash = plans.find(
    (p) => p.active && p.id !== excludeId && p.name.toLowerCase() === nameLower,
  );
  if (nameClash) {
    out.push(`An active plan named "${nameClash.name}" already exists.`);
  }

  // Duplicate meaning.
  if (input.type === "class_pack" && input.credits !== null) {
    const meaningClash = plans.find(
      (p) =>
        p.active &&
        p.id !== excludeId &&
        p.type === "class_pack" &&
        p.credits === input.credits &&
        p.name.toLowerCase() !== nameLower,
    );
    if (meaningClash) {
      out.push(
        `Another ${input.credits}-credit pack already exists: "${meaningClash.name}".`,
      );
    }
  }
  if (input.type === "unlimited") {
    const unlimitedClash = plans.find(
      (p) =>
        p.active &&
        p.id !== excludeId &&
        p.type === "unlimited" &&
        p.name.toLowerCase() !== nameLower,
    );
    if (unlimitedClash) {
      out.push(
        `Another active unlimited plan already exists: "${unlimitedClash.name}".`,
      );
    }
  }

  // Suspicious price.
  if (input.priceCents !== null) {
    if (input.priceCents < PRICE_SUSPICIOUS_LOW_CENTS) {
      out.push(
        `${formatPriceEur(input.priceCents)} looks very low — did you mean a higher price?`,
      );
    } else if (input.priceCents > PRICE_SUSPICIOUS_HIGH_CENTS) {
      out.push(
        `${formatPriceEur(input.priceCents)} looks very high — double-check the price.`,
      );
    }
    if (input.type === "class_pack" && input.credits !== null && input.credits > 0) {
      const perCredit = input.priceCents / input.credits;
      if (perCredit < PER_CREDIT_LOW_CENTS) {
        out.push(
          `That works out to ${formatPriceEur(Math.round(perCredit))} per class — is that right?`,
        );
      } else if (perCredit > PER_CREDIT_HIGH_CENTS) {
        out.push(
          `That works out to ${formatPriceEur(Math.round(perCredit))} per class — double-check.`,
        );
      }
    }
  }

  // Large pack.
  if (
    input.type === "class_pack" &&
    input.credits !== null &&
    input.credits > CREDITS_SUSPICIOUS_HIGH
  ) {
    out.push(
      `${input.credits} credits in one pack is unusual — confirm this is intentional.`,
    );
  }

  return out;
}
