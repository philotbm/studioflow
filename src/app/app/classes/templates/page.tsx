import Link from "next/link";
import { scopedQuery } from "@/lib/db";

/**
 * v0.24.0 (Sprint A) — Class templates list.
 *
 * Server component. Reads class_templates via scopedQuery (cookie-auth
 * + studio-scoped Proxy). The proxy under /app/* already gates this
 * page to owner/manager; the layout above already resolves the staff
 * row. We just render.
 *
 * Sort order: weekday asc, start_time_local asc. Active status is
 * computed from valid_from / valid_until.
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface TemplateRow {
  id: string;
  name: string;
  weekday: number;
  start_time_local: string;
  duration_minutes: number;
  capacity: number;
  valid_from: string;
  valid_until: string | null;
  instructor_id: string | null;
}

function templateActive(t: TemplateRow): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (t.valid_from > today) return false;
  if (t.valid_until && t.valid_until <= today) return false;
  return true;
}

function formatStartTime(time: string): string {
  // "HH:MM:SS" → "HH:MM"
  return time.slice(0, 5);
}

export default async function TemplatesIndexPage() {
  const client = await scopedQuery();
  if (!client) {
    return (
      <main className="mx-auto max-w-3xl pt-12 text-center">
        <p className="text-red-400 text-sm">
          Database client not configured. Check NEXT_PUBLIC_SUPABASE_* env
          vars.
        </p>
      </main>
    );
  }

  // Pull templates + their instructor names in two round-trips. Could be
  // a single JOIN with `select(`*, staff(full_name)`)` but the explicit
  // two-step keeps the row shapes typed cleanly.
  const { data: templatesRaw, error } = await client
    .from("class_templates")
    .select(
      "id, name, weekday, start_time_local, duration_minutes, capacity, valid_from, valid_until, instructor_id",
    )
    .order("weekday", { ascending: true })
    .order("start_time_local", { ascending: true });

  if (error) {
    return (
      <main className="mx-auto max-w-3xl pt-12 text-center">
        <p className="text-red-400 text-sm">Couldn&apos;t load templates.</p>
        <p className="text-white/30 text-xs mt-2">{error.message}</p>
      </main>
    );
  }

  const templates = (templatesRaw ?? []) as TemplateRow[];

  // Resolve instructor names in one batch.
  const instructorIds = Array.from(
    new Set(templates.map((t) => t.instructor_id).filter(Boolean) as string[]),
  );
  const instructorNames = new Map<string, string>();
  if (instructorIds.length > 0) {
    const { data: staff } = await client
      .from("staff")
      .select("id, full_name")
      .in("id", instructorIds);
    for (const s of staff ?? []) {
      instructorNames.set(s.id as string, s.full_name as string);
    }
  }

  return (
    <main className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/app/classes"
            className="text-xs uppercase tracking-wide text-white/40 hover:text-white/80"
          >
            ← Classes
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Class templates
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Recurring weekly templates. The materialise cron rolls these
            out into individual class instances each day.
          </p>
        </div>
        <Link
          href="/app/classes/templates/new"
          className="rounded border border-white/30 px-3 py-1.5 text-sm hover:border-white/60"
        >
          + New template
        </Link>
      </div>

      {templates.length === 0 ? (
        <section className="mt-8 rounded border border-white/10 px-4 py-10 text-center text-sm text-white/50">
          No templates yet. Click <span className="text-white/80">+ New
          template</span> to define one.
        </section>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {templates.map((t) => {
            const active = templateActive(t);
            const instructor = t.instructor_id
              ? (instructorNames.get(t.instructor_id) ?? "Unknown")
              : "TBD";
            return (
              <li key={t.id}>
                <Link
                  href={`/app/classes/templates/${t.id}`}
                  className={`flex flex-col gap-1 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                    active
                      ? "border-white/10 hover:border-white/25"
                      : "border-white/5 hover:border-white/15"
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={`text-sm font-medium ${
                        active ? "" : "text-white/40"
                      }`}
                    >
                      {t.name}
                    </span>
                    <span
                      className={`text-xs ${
                        active ? "text-white/50" : "text-white/30"
                      }`}
                    >
                      {DAY_NAMES[t.weekday]}s · {formatStartTime(t.start_time_local)} ·{" "}
                      {t.duration_minutes}min · {instructor}
                    </span>
                    <span
                      className={`text-xs ${
                        active ? "text-white/40" : "text-white/25"
                      }`}
                    >
                      Capacity {t.capacity} · Valid {t.valid_from}
                      {t.valid_until ? ` → ${t.valid_until}` : " →"}
                    </span>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      active
                        ? "border-green-400/30 text-green-300/90"
                        : "border-white/15 text-white/40"
                    }`}
                  >
                    {active ? "Active" : "Inactive"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
