"use client";

import { useEffect, useState } from "react";
import { formatPriceEur } from "@/lib/plans";

/**
 * v0.17.0 Revenue Reporting Foundation.
 *
 * Operator-facing read-only revenue surface. Data comes entirely
 * from /api/admin/revenue, which aggregates the `purchases` table
 * with the v0.17.0 eligibility filter (status IN completed/refunded
 * AND price_cents_paid IS NOT NULL AND credits_granted IS NOT NULL).
 *
 * Three sections:
 *   1. Top cards — Gross / Refunded / Net.
 *   2. Purchase activity counts — completed, refunded, legacy excluded.
 *   3. Revenue by source table — sorted by completed-revenue desc.
 *
 * Out of scope (deferred): charts, exports, date filters, member
 * breakdown, Stripe calls, anything writing.
 */

type SourceRow = {
  source: string;
  countCompleted: number;
  revenueCompletedCents: number;
  countRefunded: number;
  revenueRefundedCents: number;
  netRevenueCents: number;
};

type RevenueSummary = {
  ok: true;
  grossRevenueCents: number;
  refundedRevenueCents: number;
  netRevenueCents: number;
  completedCount: number;
  refundedCount: number;
  legacyExcludedCount: number;
  bySource: SourceRow[];
  totalRows: number;
};

// Operator-friendly source labels — matches the Purchase History
// panel on /app/members/[id] so the same source vocabulary appears
// across both surfaces.
const SOURCE_LABELS: Record<string, string> = {
  stripe: "Stripe",
  dev_fake: "Test purchase (no Stripe)",
  operator_manual: "Operator test purchase",
  fake: "Test purchase (legacy)",
};

function sourceLabel(s: string): string {
  return SOURCE_LABELS[s] ?? s;
}

function RevenueCard({
  label,
  cents,
  tone,
}: {
  label: string;
  cents: number;
  tone: "neutral" | "warning" | "positive";
}) {
  const toneCls =
    tone === "positive"
      ? "border-green-400/30"
      : tone === "warning"
        ? "border-amber-400/30"
        : "border-white/15";
  const valueCls =
    tone === "positive"
      ? "text-green-400"
      : tone === "warning"
        ? "text-amber-300"
        : "text-white";
  return (
    <div className={`rounded border ${toneCls} px-4 py-3`}>
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueCls}`}>
        {formatPriceEur(cents)}
      </p>
    </div>
  );
}

export default function RevenuePage() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/revenue", { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as
          | RevenueSummary
          | { ok: false; error?: string }
          | null;
        if (cancelled) return;
        if (!body) {
          setError(`Revenue fetch failed (${r.status})`);
          return;
        }
        if (!body.ok) {
          setError(body.error ?? `Revenue fetch failed (${r.status})`);
          return;
        }
        setSummary(body);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Network error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl pt-12 text-center">
        <p className="text-red-400 text-sm">Failed to load revenue.</p>
        <p className="text-white/30 text-xs mt-2">{error}</p>
      </main>
    );
  }
  if (!summary) {
    return (
      <main className="mx-auto max-w-3xl pt-12 text-center">
        <p className="text-white/40">Loading revenue…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">Revenue</h1>
      <p className="mt-2 text-xs text-white/40">
        Read-only summary across the full purchases table. Legacy rows
        with no recorded price are excluded from revenue numbers and
        counted separately below.
      </p>

      {/* Section 1 — top cards */}
      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RevenueCard
          label="Gross revenue"
          cents={summary.grossRevenueCents}
          tone="neutral"
        />
        <RevenueCard
          label="Refunded"
          cents={summary.refundedRevenueCents}
          tone="warning"
        />
        <RevenueCard
          label="Net revenue"
          cents={summary.netRevenueCents}
          tone="positive"
        />
      </section>
      <p className="mt-2 text-[11px] text-white/30">
        Gross = total billed across completed and later-refunded
        purchases. Net = Gross − Refunded = currently retained
        revenue.
      </p>

      {/* Section 2 — purchase activity */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Purchase activity</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded border border-white/10 px-4 py-3">
            <dt className="text-xs text-white/40">Completed purchases</dt>
            <dd className="mt-1 text-lg font-semibold">
              {summary.completedCount}
            </dd>
          </div>
          <div className="rounded border border-white/10 px-4 py-3">
            <dt className="text-xs text-white/40">Refunded purchases</dt>
            <dd className="mt-1 text-lg font-semibold">
              {summary.refundedCount}
            </dd>
          </div>
          <div className="rounded border border-white/10 px-4 py-3">
            <dt className="text-xs text-white/40">
              Legacy purchases excluded
            </dt>
            <dd className="mt-1 text-lg font-semibold">
              {summary.legacyExcludedCount}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-white/30">
          {summary.totalRows} purchases on file. Legacy rows have no
          recorded price or credits and are excluded from revenue
          totals.
        </p>
      </section>

      {/* Section 3 — revenue by source */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Revenue by source</h2>
        {summary.bySource.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">
            No revenue-eligible purchases yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-white/40">
                  <th className="px-3 py-2 font-normal">Source</th>
                  <th className="px-3 py-2 font-normal text-right">
                    Completed
                  </th>
                  <th className="px-3 py-2 font-normal text-right">Revenue</th>
                  <th className="px-3 py-2 font-normal text-right">
                    Refunded
                  </th>
                  <th className="px-3 py-2 font-normal text-right">
                    Refunded €
                  </th>
                  <th className="px-3 py-2 font-normal text-right">Net €</th>
                </tr>
              </thead>
              <tbody>
                {summary.bySource.map((row) => {
                  const netCls =
                    row.netRevenueCents > 0
                      ? "text-green-400"
                      : row.netRevenueCents < 0
                        ? "text-red-400"
                        : "text-white/60";
                  return (
                    <tr
                      key={row.source}
                      className="border-b border-white/5 last:border-b-0"
                    >
                      <td className="px-3 py-2 text-white/80">
                        {sourceLabel(row.source)}
                      </td>
                      <td className="px-3 py-2 text-right text-white/70">
                        {row.countCompleted}
                      </td>
                      <td className="px-3 py-2 text-right text-white/80">
                        {formatPriceEur(row.revenueCompletedCents)}
                      </td>
                      <td className="px-3 py-2 text-right text-white/70">
                        {row.countRefunded}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-300">
                        {row.revenueRefundedCents > 0
                          ? formatPriceEur(row.revenueRefundedCents)
                          : "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${netCls}`}
                      >
                        {formatPriceEur(row.netRevenueCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-white/30">
          Sorted by completed revenue, descending. Sources with zero
          revenue-eligible rows are not listed.
        </p>
      </section>
    </main>
  );
}
