"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatPriceEur, type Plan, type PlanType } from "@/lib/plans";

/**
 * v0.14.1 plan-catalogue admin page.
 *
 * Operator-shaped: the form asks for commercial fields only (plan
 * name, type, price, credits). Ids are generated server-side from
 * the name. Common plan shapes are one-click presets.
 *
 * Guardrails applied inline:
 *   - Missing / invalid fields → hard-blocked with plain-English copy.
 *   - Suspicious price (too low, too high, wild per-credit ratio) → soft
 *     warning; operator can "Create anyway".
 *   - Duplicate active plan name → soft warning.
 *   - Duplicate meaning (same type + credits, class_pack) → soft warning.
 *
 * Plans have an active/inactive toggle. Inactive plans stay in the
 * catalogue (so purchase history keeps resolving them) but disappear
 * from member-facing purchase surfaces.
 */

type FormState = {
  name: string;
  type: PlanType;
  priceEur: string;
  credits: string;
};

const BLANK_FORM: FormState = {
  name: "",
  type: "class_pack",
  priceEur: "",
  credits: "",
};

const PRESETS: Array<{ label: string; form: FormState }> = [
  { label: "5-Class Pass",      form: { name: "5-Class Pass",      type: "class_pack", priceEur: "50",  credits: "5"  } },
  { label: "10-Class Pass",     form: { name: "10-Class Pass",     type: "class_pack", priceEur: "90",  credits: "10" } },
  { label: "20-Class Pass",     form: { name: "20-Class Pass",     type: "class_pack", priceEur: "160", credits: "20" } },
  { label: "Unlimited Monthly", form: { name: "Unlimited Monthly", type: "unlimited",  priceEur: "120", credits: ""   } },
];

// Suspicious-price heuristics — intentionally loose. The point is to
// catch "€2000 for a 5-class pack" style mistakes, not to police
// legitimate high-end studios.
const PRICE_SUSPICIOUS_LOW_CENTS  = 500;    // < €5 total is almost certainly a mistake
const PRICE_SUSPICIOUS_HIGH_CENTS = 50000;  // > €500 total is worth a second look
const PER_CREDIT_LOW_CENTS        = 500;    // < €5/credit
const PER_CREDIT_HIGH_CENTS       = 10000;  // > €100/credit
const CREDITS_SUSPICIOUS_HIGH     = 50;     // > 50 credits per pack is unusual

function PlanRow({
  plan,
  onToggle,
  busy,
}: {
  plan: Plan;
  onToggle: (plan: Plan) => void;
  busy: boolean;
}) {
  const accessLabel =
    plan.type === "unlimited" ? "Unlimited" : "Credit pack";
  const creditsLabel =
    plan.type === "unlimited"
      ? "—"
      : plan.credits === 1
        ? "1 credit"
        : `${plan.credits} credits`;
  const rowCls = plan.active
    ? "border-white/10"
    : "border-white/5 opacity-50";
  return (
    <li
      className={`flex items-center justify-between gap-4 rounded border px-4 py-2 ${rowCls}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{plan.name}</span>
        <span className="text-[11px] text-white/30">
          {accessLabel} · {creditsLabel} · {formatPriceEur(plan.priceCents)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
            plan.active
              ? "border-green-400/30 text-green-400"
              : "border-white/20 text-white/40"
          }`}
        >
          {plan.active ? "Active" : "Inactive"}
        </span>
        <button
          onClick={() => onToggle(plan)}
          disabled={busy}
          className="rounded border border-white/20 px-2 py-1 text-[11px] text-white/60 hover:text-white hover:border-white/40 disabled:opacity-30"
        >
          {plan.active ? "Deactivate" : "Reactivate"}
        </button>
      </div>
    </li>
  );
}

export default function PlansAdminPage() {
  const { plans, loading, error, refresh } = useStore();
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [ackWarnings, setAckWarnings] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    | null
    | { kind: "ok"; text: string }
    | { kind: "error"; text: string }
  >(null);

  // When switching to Unlimited, the credits field becomes meaningless.
  // Clear it so the posted payload passes the unlimited-has-no-credits
  // DB check, and so the warning logic below doesn't fire on stale input.
  useEffect(() => {
    if (form.type === "unlimited" && form.credits !== "") {
      setForm((f) => ({ ...f, credits: "" }));
    }
  }, [form.type, form.credits]);

  // Reset warning-acknowledged whenever the form content changes — so
  // the operator has to re-confirm if they changed their mind.
  useEffect(() => {
    setAckWarnings(false);
  }, [form.name, form.type, form.priceEur, form.credits]);

  const priceCentsParsed = useMemo(() => {
    const trimmed = form.priceEur.trim();
    if (!trimmed) return null;
    const euros = Number(trimmed);
    if (!Number.isFinite(euros) || euros < 0) return null;
    return Math.round(euros * 100);
  }, [form.priceEur]);

  const creditsParsed = useMemo(() => {
    if (form.type === "unlimited") return null;
    const trimmed = form.credits.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
  }, [form.credits, form.type]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    const nameTrimmed = form.name.trim();
    if (!nameTrimmed) return out;

    // Duplicate-name (active plans only — an inactive lookalike is fine).
    const nameLower = nameTrimmed.toLowerCase();
    const nameClash = plans.find(
      (p) => p.active && p.name.toLowerCase() === nameLower,
    );
    if (nameClash) {
      out.push(`An active plan named "${nameClash.name}" already exists.`);
    }

    // Duplicate meaning — same type + credits for class_pack, or another
    // active unlimited plan when creating unlimited.
    if (form.type === "class_pack" && creditsParsed !== null) {
      const meaningClash = plans.find(
        (p) =>
          p.active &&
          p.type === "class_pack" &&
          p.credits === creditsParsed,
      );
      if (meaningClash && meaningClash.name.toLowerCase() !== nameLower) {
        out.push(
          `Another ${creditsParsed}-credit pack already exists: "${meaningClash.name}".`,
        );
      }
    }
    if (form.type === "unlimited") {
      const unlimitedClash = plans.find(
        (p) =>
          p.active &&
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
    if (priceCentsParsed !== null) {
      if (priceCentsParsed < PRICE_SUSPICIOUS_LOW_CENTS) {
        out.push(
          `${formatPriceEur(priceCentsParsed)} looks very low — did you mean a higher price?`,
        );
      } else if (priceCentsParsed > PRICE_SUSPICIOUS_HIGH_CENTS) {
        out.push(
          `${formatPriceEur(priceCentsParsed)} looks very high — double-check the price.`,
        );
      }
      if (form.type === "class_pack" && creditsParsed !== null) {
        const perCredit = priceCentsParsed / creditsParsed;
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
      form.type === "class_pack" &&
      creditsParsed !== null &&
      creditsParsed > CREDITS_SUSPICIOUS_HIGH
    ) {
      out.push(
        `${creditsParsed} credits in one pack is unusual — confirm this is intentional.`,
      );
    }

    return out;
  }, [form, plans, priceCentsParsed, creditsParsed]);

  const hardInvalid =
    submitting ||
    form.name.trim().length === 0 ||
    priceCentsParsed === null ||
    (form.type === "class_pack" && creditsParsed === null);

  const canSubmit = !hardInvalid && (warnings.length === 0 || ackWarnings);

  function applyPreset(preset: FormState) {
    setForm(preset);
    setFeedback(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const resp = await fetch("/api/admin/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          priceCents: priceCentsParsed,
          credits: form.type === "unlimited" ? null : creditsParsed,
        }),
      });
      const data = (await resp.json().catch(() => null)) as
        | { ok: true; plan: Plan }
        | { ok: false; error: string }
        | null;
      if (!data) {
        setFeedback({ kind: "error", text: `Create failed (${resp.status})` });
        return;
      }
      if (!data.ok) {
        setFeedback({ kind: "error", text: data.error });
        return;
      }
      setFeedback({ kind: "ok", text: `Created "${data.plan.name}"` });
      setForm(BLANK_FORM);
      setAckWarnings(false);
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(plan: Plan) {
    setTogglingId(plan.id);
    setFeedback(null);
    try {
      const resp = await fetch("/api/admin/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: plan.id, active: !plan.active }),
      });
      const data = (await resp.json().catch(() => null)) as
        | { ok: true; plan: Plan }
        | { ok: false; error: string }
        | null;
      if (!data) {
        setFeedback({
          kind: "error",
          text: `Toggle failed (${resp.status})`,
        });
        return;
      }
      if (!data.ok) {
        setFeedback({ kind: "error", text: data.error });
        return;
      }
      setFeedback({
        kind: "ok",
        text: `"${data.plan.name}" is now ${data.plan.active ? "active" : "inactive"}`,
      });
      await refresh();
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading plans…</p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-red-400 text-sm">Failed to load data.</p>
        <p className="text-white/30 text-xs mt-2">{error}</p>
      </main>
    );
  }

  const activePlans = plans.filter((p) => p.active);
  const inactivePlans = plans.filter((p) => !p.active);

  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
      <p className="mt-2 text-xs text-white/40">
        The things the studio sells. Active plans are what members can
        buy today. Inactive plans stay here so old purchases keep
        showing the right name.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-white/70">Active</h2>
        {activePlans.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">No active plans.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {activePlans.map((p) => (
              <PlanRow
                key={p.id}
                plan={p}
                onToggle={handleToggle}
                busy={togglingId === p.id}
              />
            ))}
          </ul>
        )}
      </section>

      {inactivePlans.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-white/70">Inactive</h2>
          <p className="mt-1 text-xs text-white/40">
            Hidden from the member purchase surface. Old purchases still
            show these names.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {inactivePlans.map((p) => (
              <PlanRow
                key={p.id}
                plan={p}
                onToggle={handleToggle}
                busy={togglingId === p.id}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 rounded border border-white/10 px-4 py-4">
        <h2 className="text-sm font-medium text-white/70">Add a plan</h2>
        <p className="mt-1 text-xs text-white/40">
          Start from a common option or fill in your own.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset.form)}
              className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-white/50">Plan name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. 20-Class Pass"
              autoComplete="off"
              className="rounded border border-white/20 bg-black px-2 py-1.5 text-sm text-white/80 outline-none focus:border-white/40"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-white/50">Type</span>
            <select
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as PlanType })
              }
              className="rounded border border-white/20 bg-black px-2 py-1.5 text-sm text-white/80 outline-none focus:border-white/40"
            >
              <option value="class_pack">Class pack</option>
              <option value="unlimited">Unlimited</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-white/50">Price (€)</span>
            <input
              value={form.priceEur}
              onChange={(e) => setForm({ ...form, priceEur: e.target.value })}
              placeholder="e.g. 160"
              inputMode="decimal"
              className="rounded border border-white/20 bg-black px-2 py-1.5 text-sm text-white/80 outline-none focus:border-white/40"
            />
          </label>

          {form.type === "class_pack" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-white/50">Credits</span>
              <input
                value={form.credits}
                onChange={(e) =>
                  setForm({ ...form, credits: e.target.value })
                }
                placeholder="e.g. 20"
                inputMode="numeric"
                className="rounded border border-white/20 bg-black px-2 py-1.5 text-sm text-white/80 outline-none focus:border-white/40"
              />
              <span className="text-[11px] text-white/30">
                Number of classes the pack includes.
              </span>
            </label>
          )}

          {warnings.length > 0 && (
            <div className="rounded border border-amber-400/30 bg-amber-400/5 px-3 py-2">
              <p className="text-xs font-medium text-amber-300">
                Before you save:
              </p>
              <ul className="mt-1.5 flex flex-col gap-1 text-xs text-amber-200/80">
                {warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
              <label className="mt-2 flex items-center gap-2 text-xs text-amber-200/80">
                <input
                  type="checkbox"
                  checked={ackWarnings}
                  onChange={(e) => setAckWarnings(e.target.checked)}
                />
                I&apos;ve checked these — create anyway.
              </label>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:text-white hover:border-white/40 disabled:opacity-30"
            >
              {submitting
                ? "Creating…"
                : warnings.length > 0
                  ? "Create anyway"
                  : "Create plan"}
            </button>
            {feedback && (
              <span
                className={`text-xs ${
                  feedback.kind === "error"
                    ? "text-red-400/90"
                    : "text-green-400/80"
                }`}
              >
                {feedback.text}
              </span>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
