"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatPriceEur, type Plan, type PlanType } from "@/lib/plans";
import { planSoftWarnings, validatePlanHard } from "@/lib/plan-validation";

/**
 * v0.14.2 plan-catalogue admin page.
 *
 * Operator-shaped: the form asks for commercial fields only (plan
 * name, type, price, credits). Ids are generated server-side from
 * the name on create and held immutable on edit. Common plan shapes
 * are one-click presets.
 *
 * Guardrails (shared between create and edit, see lib/plan-validation):
 *   - Missing / invalid fields → hard-blocked with plain-English copy.
 *   - Suspicious price (too low, too high, wild per-credit ratio) → soft
 *     warning; operator can "Save anyway".
 *   - Duplicate active plan name → soft warning.
 *   - Duplicate meaning (same type + credits, class_pack) → soft warning.
 *
 * Plans have an active/inactive toggle. Inactive plans stay in the
 * catalogue (so purchase history keeps resolving them) but disappear
 * from member-facing purchase surfaces.
 *
 * Edit (v0.14.2): each existing plan card has an Edit action that
 * opens an inline editor. Plan id is hidden — historical purchases
 * resolve by id, so the id stays fixed forever. Plan type is locked
 * for now: changing class_pack ↔ unlimited would invalidate the
 * coherence CHECK and confuse old purchase rows whose plan_type was
 * snapshotted at purchase time.
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

function parsePriceCents(priceEur: string): number | null {
  const trimmed = priceEur.trim();
  if (!trimmed) return null;
  const euros = Number(trimmed);
  if (!Number.isFinite(euros) || euros < 0) return null;
  return Math.round(euros * 100);
}

function parseCredits(credits: string, type: PlanType): number | null {
  if (type === "unlimited") return null;
  const trimmed = credits.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function PlanRow({
  plan,
  onToggle,
  onEdit,
  busy,
  isEditing,
}: {
  plan: Plan;
  onToggle: (plan: Plan) => void;
  onEdit: (plan: Plan) => void;
  busy: boolean;
  isEditing: boolean;
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
          onClick={() => onEdit(plan)}
          disabled={busy || isEditing}
          className="rounded border border-white/20 px-2 py-1 text-[11px] text-white/60 hover:text-white hover:border-white/40 disabled:opacity-30"
        >
          {isEditing ? "Editing…" : "Edit"}
        </button>
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

function EditPlanPanel({
  plan,
  plans,
  onCancel,
  onSaved,
}: {
  plan: Plan;
  plans: Plan[];
  onCancel: () => void;
  onSaved: (plan: Plan) => void;
}) {
  const [form, setForm] = useState<FormState>({
    name: plan.name,
    type: plan.type,
    priceEur: (plan.priceCents / 100).toString(),
    credits: plan.credits === null ? "" : String(plan.credits),
  });
  const [submitting, setSubmitting] = useState(false);
  const [ackWarnings, setAckWarnings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAckWarnings(false);
  }, [form.name, form.priceEur, form.credits]);

  const priceCentsParsed = useMemo(
    () => parsePriceCents(form.priceEur),
    [form.priceEur],
  );
  const creditsParsed = useMemo(
    () => parseCredits(form.credits, form.type),
    [form.credits, form.type],
  );

  const hardErrors = useMemo(
    () =>
      validatePlanHard({
        name: form.name,
        type: form.type,
        priceCents: priceCentsParsed,
        credits: creditsParsed,
      }),
    [form, priceCentsParsed, creditsParsed],
  );

  const warnings = useMemo(
    () =>
      planSoftWarnings(
        {
          name: form.name,
          type: form.type,
          priceCents: priceCentsParsed,
          credits: creditsParsed,
        },
        plans,
        { excludeId: plan.id },
      ),
    [form, priceCentsParsed, creditsParsed, plans, plan.id],
  );

  const isUnchanged =
    form.name.trim() === plan.name &&
    priceCentsParsed === plan.priceCents &&
    creditsParsed === plan.credits;

  const hardInvalid = submitting || hardErrors.length > 0 || isUnchanged;
  const canSubmit = !hardInvalid && (warnings.length === 0 || ackWarnings);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/admin/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plan.id,
          name: form.name.trim(),
          type: form.type,
          priceCents: priceCentsParsed,
          credits: form.type === "unlimited" ? null : creditsParsed,
          override: warnings.length > 0,
        }),
      });
      const data = (await resp.json().catch(() => null)) as
        | { ok: true; plan: Plan }
        | { ok: false; error: string }
        | null;
      if (!data) {
        setError(`Save failed (${resp.status})`);
        return;
      }
      if (!data.ok) {
        setError(data.error);
        return;
      }
      onSaved(data.plan);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="rounded border border-white/20 bg-white/[0.02] px-4 py-4">
      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-white/50">
            Editing plan
          </span>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-[11px] text-white/40 hover:text-white"
          >
            Cancel
          </button>
        </div>

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

        <div className="flex flex-col gap-1">
          <span className="text-xs text-white/50">Type</span>
          <div className="flex items-center gap-2 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/60">
            <span>
              {plan.type === "unlimited" ? "Unlimited" : "Class pack"}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-white/30">
              locked
            </span>
          </div>
          <span className="text-[11px] text-white/30">
            Plan type can&apos;t be changed on an existing plan — old
            purchases store the type they were sold under, so changing
            it would split history. Create a new plan and deactivate
            this one if you need a different type.
          </span>
        </div>

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

        <div className="rounded border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white/50">
          <p>Changes apply to future purchases only.</p>
          <p>Existing members and purchase history are not rewritten.</p>
          <p>Plan id stays fixed so historical records remain stable.</p>
        </div>

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
              I&apos;ve checked these — save anyway.
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
              ? "Saving…"
              : warnings.length > 0
                ? "Save anyway"
                : "Save changes"}
          </button>
          {isUnchanged && !submitting && (
            <span className="text-[11px] text-white/30">No changes to save.</span>
          )}
          {error && (
            <span className="text-xs text-red-400/90">{error}</span>
          )}
        </div>
      </form>
    </li>
  );
}

export default function PlansAdminPage() {
  const { plans, loading, error, refresh } = useStore();
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [ackWarnings, setAckWarnings] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const priceCentsParsed = useMemo(
    () => parsePriceCents(form.priceEur),
    [form.priceEur],
  );

  const creditsParsed = useMemo(
    () => parseCredits(form.credits, form.type),
    [form.credits, form.type],
  );

  const hardErrors = useMemo(
    () =>
      validatePlanHard({
        name: form.name,
        type: form.type,
        priceCents: priceCentsParsed,
        credits: creditsParsed,
      }),
    [form, priceCentsParsed, creditsParsed],
  );

  const warnings = useMemo(
    () =>
      planSoftWarnings(
        {
          name: form.name,
          type: form.type,
          priceCents: priceCentsParsed,
          credits: creditsParsed,
        },
        plans,
      ),
    [form, plans, priceCentsParsed, creditsParsed],
  );

  const hardInvalid = submitting || hardErrors.length > 0;
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
          override: warnings.length > 0,
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

  function handleEdit(plan: Plan) {
    setEditingId(plan.id);
    setFeedback(null);
  }

  async function handleEdited(saved: Plan) {
    setEditingId(null);
    setFeedback({ kind: "ok", text: `Saved "${saved.name}"` });
    await refresh();
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

  function renderPlanRow(p: Plan) {
    if (editingId === p.id) {
      return (
        <EditPlanPanel
          key={p.id}
          plan={p}
          plans={plans}
          onCancel={() => setEditingId(null)}
          onSaved={handleEdited}
        />
      );
    }
    return (
      <PlanRow
        key={p.id}
        plan={p}
        onToggle={handleToggle}
        onEdit={handleEdit}
        busy={togglingId === p.id}
        isEditing={editingId !== null && editingId !== p.id}
      />
    );
  }

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
            {activePlans.map(renderPlanRow)}
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
            {inactivePlans.map(renderPlanRow)}
          </ul>
        </section>
      )}

      {feedback && (
        <p
          className={`mt-4 text-xs ${
            feedback.kind === "error"
              ? "text-red-400/90"
              : "text-green-400/80"
          }`}
        >
          {feedback.text}
        </p>
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
          </div>
        </form>
      </section>
    </main>
  );
}
