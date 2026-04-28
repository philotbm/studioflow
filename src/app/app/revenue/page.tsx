"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatPriceEur } from "@/lib/plans";
import { sourceDisplayLabel } from "@/lib/revenue";

/**
 * v0.17.1 Revenue page with date-range filter.
 *
 * URL-driven: range comes from ?range= and the page re-fetches on
 * change. Buttons are <Link>s with href=?range=X so deep-linking
 * works (a bookmarked /app/revenue?range=last7 reopens to the same
 * filter).
 *
 * Three sections, unchanged from v0.17.0 (cards / activity / source
 * table) — every number is now scoped to the selected window. The
 * server returns rangeLabel + rangeStart/rangeEnd so the helper
 * copy under the cards reads from server truth.
 *
 * Out of scope (deferred): charts, exports, custom date pickers,
 * member-level breakdown, Stripe reconciliation.
 */

type SourceRow = {
  source: string;
  countCompleted: number;
  revenueCompletedCents: number;
  countRefunded: number;
  revenueRefundedCents: number;
  netRevenueCents: number;
};

type RangeKey = "lifetime" | "today" | "last7" | "last30";

type RevenueSummary = {
  ok: true;
  selectedRange: RangeKey;
  rangeLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  grossRevenueCents: number;
  refundedRevenueCents: number;
  netRevenueCents: number;
  completedCount: number;
  refundedCount: number;
  legacyExcludedCount: number;
  bySource: SourceRow[];
  totalRows: number;
};

const RANGE_BUTTONS: Array<{ value: RangeKey; label: string }> = [
  { value: "lifetime", label: "Lifetime" },
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
];

function isRangeKey(s: string | null): s is RangeKey {
  return (
    s === "lifetime" || s === "today" || s === "last7" || s === "last30"
  );
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

function RangeButtons({ active }: { active: RangeKey }) {
  return (
    <div className="flex flex-wrap gap-2">
      {RANGE_BUTTONS.map((r) => {
        const isActive = active === r.value;
        // Lifetime renders without ?range to keep URLs clean — the
        // page coerces a missing param to "lifetime".
        const href =
          r.value === "lifetime"
            ? "/app/revenue"
            : `/app/revenue?range=${r.value}`;
        const cls = isActive
          ? "border-white/40 text-white"
          : "border-white/15 text-white/60 hover:text-white hover:border-white/30";
        return (
          <Link
            key={r.value}
            href={href}
            scroll={false}
            className={`rounded border px-3 py-1.5 text-xs ${cls}`}
            aria-current={isActive ? "page" : undefined}
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}

function RevenueContent() {
  const params = useSearchParams();
  const requested = params.get("range");
  const range: RangeKey = isRangeKey(requested) ? requested : "lifetime";

  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    const qs = range === "lifetime" ? "" : `?range=${range}`;
    fetch(`/api/admin/revenue${qs}`, { cache: "no-store" })
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
  }, [range]);

  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">Revenue</h1>
      <p className="mt-2 text-xs text-white/40">
        Read-only summary across the purchases table. Legacy rows
        with no recorded price are excluded from revenue numbers and
        counted separately below.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <RangeButtons active={range} />
        {/*
          v0.17.2: Export CSV. Direct anchor (not next/link) because
          Next.js's client navigation would intercept the URL and try
          to render a route — we want the browser to follow the link
          as a normal download with the Content-Disposition header.
          `download` is a hint; the server's filename header wins.
        */}
        <a
          href={
            range === "lifetime"
              ? "/api/admin/revenue/export"
              : `/api/admin/revenue/export?range=${range}`
          }
          download
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:text-white hover:border-white/40"
        >
          Export CSV
        </a>
      </div>

      {error && (
        <div className="mt-6 rounded border border-red-400/30 bg-red-400/5 px-4 py-3">
          <p className="text-sm text-red-400">Failed to load revenue.</p>
          <p className="mt-1 text-xs text-white/40">{error}</p>
        </div>
      )}

      {!summary && !error && (
        <p className="mt-8 text-center text-white/40">Loading revenue…</p>
      )}

      {summary && (
        <>
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
            Showing {summary.rangeLabel}. Legacy rows without
            recorded economics are excluded from revenue totals.
            Gross = total billed across completed and later-refunded
            purchases. Net = Gross − Refunded.
          </p>

          {/* Section 2 — purchase activity */}
          <section className="mt-8">
            <h2 className="text-sm font-medium text-white/70">
              Purchase activity
            </h2>
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
              {summary.totalRows} purchases on file for this range.
              Legacy rows have no recorded price or credits and are
              excluded from revenue totals.
            </p>
          </section>

          {/* Section 3 — revenue by source */}
          <section className="mt-8">
            <h2 className="text-sm font-medium text-white/70">
              Revenue by source
            </h2>
            {summary.bySource.length === 0 ? (
              <p className="mt-3 text-xs text-white/40">
                No revenue-eligible purchases in this range.
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
                      <th className="px-3 py-2 font-normal text-right">
                        Revenue
                      </th>
                      <th className="px-3 py-2 font-normal text-right">
                        Refunded
                      </th>
                      <th className="px-3 py-2 font-normal text-right">
                        Refunded €
                      </th>
                      <th className="px-3 py-2 font-normal text-right">
                        Net €
                      </th>
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
                            {sourceDisplayLabel(row.source)}
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
              Sorted by completed revenue, descending. Sources with
              zero revenue-eligible rows in this range are not
              listed.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

export default function RevenuePage() {
  // Suspense wrapper required by Next.js App Router for any
  // component that calls useSearchParams.
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl pt-12 text-center">
          <p className="text-white/40">Loading revenue…</p>
        </main>
      }
    >
      <RevenueContent />
    </Suspense>
  );
}
