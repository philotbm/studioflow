import type { StudioClass } from "../data";
import type { PromotionEvent } from "../promotions";
import { formatRelative } from "../promotions";

// Lightweight operator-facing audit surface for promotion activity on a
// single class. Shows each promote/unpromote event in reverse chronological
// order. Read-only — all actions live on the roster/waitlist rows.
//
// `now` is supplied by the parent (which is already opted into dynamic
// rendering via `cookies()`) so the component body stays free of impure
// calls and satisfies React's purity rules.
export default function PromotionAuditLog({
  sourceCls,
  events,
  now,
}: {
  sourceCls: StudioClass;
  events: PromotionEvent[];
  now: number;
}) {
  const forThis = events.filter((e) => e.classId === sourceCls.id);
  if (forThis.length === 0) return null;

  const waitlist = sourceCls.waitlist ?? [];

  // Names are resolved against the source (untransformed) waitlist so that
  // promoted entries — which are absent from the transformed waitlist — still
  // display a real name in the log.
  const nameFor = (position: number): string =>
    waitlist.find((w) => w.position === position)?.name ??
    `Waitlist #${position}`;

  // Newest events first.
  const sorted = [...forThis].sort((a, b) => b.at - a.at);

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-white/70">Promotion activity</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {sorted.map((ev, i) => {
          const isPromote = ev.action === "promote";
          return (
            <li
              key={`${ev.classId}-${ev.position}-${ev.at}-${i}`}
              className="flex items-center justify-between gap-3 rounded border border-white/10 px-4 py-2"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">{nameFor(ev.position)}</span>
                <span className="text-xs text-white/40">
                  {isPromote
                    ? `Promoted from waitlist #${ev.position}`
                    : `Promotion reverted (back to waitlist #${ev.position})`}
                </span>
              </div>
              <span
                className={`shrink-0 text-xs ${
                  isPromote ? "text-green-400/80" : "text-amber-400/80"
                }`}
              >
                {formatRelative(ev.at, now)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
