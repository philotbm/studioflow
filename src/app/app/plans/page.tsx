"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatPriceEur, type Plan, type PlanType } from "@/lib/plans";

/**
 * v0.14.0 plan-catalogue admin page.
 *
 * Lists plans from the client store (hydrated from the `plans` DB
 * table) and offers a minimal create form. No editing or deletion yet
 * — deliberately scoped to the foundation per the v0.14.0 brief.
 *
 * After a successful create, the page refreshes the whole store so
 * the new row shows up here AND in the member-home PlansSection
 * immediately, without the operator needing to reload the tab.
 */

type FormState = {
  id: string;
  name: string;
  type: PlanType;
  priceEur: string; // typed as string so partial input doesn't coerce to 0
  credits: string;
};

const BLANK_FORM: FormState = {
  id: "",
  name: "",
  type: "class_pack",
  priceEur: "",
  credits: "",
};

function PlanRow({ plan }: { plan: Plan }) {
  const accessLabel =
    plan.type === "unlimited" ? "Unlimited" : "Credit pack";
  const creditsLabel =
    plan.type === "unlimited"
      ? "—"
      : plan.credits === 1
        ? "1 credit"
        : `${plan.credits} credits`;
  return (
    <li className="flex items-center justify-between gap-4 rounded border border-white/10 px-4 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{plan.name}</span>
        <span className="text-[11px] text-white/30 font-mono truncate">
          {plan.id}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <span className="uppercase tracking-wide text-white/40">
          {accessLabel}
        </span>
        <span className="text-white/50">{creditsLabel}</span>
        <span className="text-white/70">{formatPriceEur(plan.priceCents)}</span>
      </div>
    </li>
  );
}

export default function PlansAdminPage() {
  const { plans, loading, error, refresh } = useStore();
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    | null
    | { kind: "ok"; text: string }
    | { kind: "error"; text: string }
  >(null);

  // Clear the credits field when switching to unlimited — keeps the
  // posted payload valid against the DB CHECK constraint.
  useEffect(() => {
    if (form.type === "unlimited" && form.credits !== "") {
      setForm((f) => ({ ...f, credits: "" }));
    }
  }, [form.type, form.credits]);

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

  const canSubmit =
    !submitting &&
    form.id.trim().length > 0 &&
    /^[a-z0-9_]+$/.test(form.id.trim()) &&
    form.name.trim().length > 0 &&
    priceCentsParsed !== null &&
    (form.type === "unlimited" || creditsParsed !== null);

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
          id: form.id.trim(),
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
      setFeedback({ kind: "ok", text: `Created ${data.plan.id}` });
      setForm(BLANK_FORM);
      await refresh();
    } finally {
      setSubmitting(false);
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

  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
      <p className="mt-2 text-xs text-white/40">
        Plans the studio sells. A purchase of any plan here grants its
        entitlement via the shared fulfillment RPC — this table is the
        single source of truth for what can be bought.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-white/70">Catalogue</h2>
        {plans.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">No plans yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {plans.map((p) => (
              <PlanRow key={p.id} plan={p} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded border border-white/10 px-4 py-4">
        <h2 className="text-sm font-medium text-white/70">Create a plan</h2>
        <p className="mt-1 text-xs text-white/40">
          New plans are available immediately for purchase. No editing
          or deletion in this release — pick the id carefully.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-white/50">id</span>
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="e.g. pack_20"
              autoComplete="off"
              className="rounded border border-white/20 bg-black px-2 py-1.5 text-sm text-white/80 font-mono outline-none focus:border-white/40"
            />
            <span className="text-[11px] text-white/30">
              lowercase letters, digits, underscores. Stable — referenced by purchases.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-white/50">name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. 20-Class Pass"
              className="rounded border border-white/20 bg-black px-2 py-1.5 text-sm text-white/80 outline-none focus:border-white/40"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-white/50">type</span>
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
            <span className="text-xs text-white/50">price (€)</span>
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
              <span className="text-xs text-white/50">credits</span>
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
                Whole number &gt; 0.
              </span>
            </label>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:text-white hover:border-white/40 disabled:opacity-30"
            >
              {submitting ? "Creating…" : "Create plan"}
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
