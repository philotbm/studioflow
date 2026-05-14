/**
 * v0.24.0 — Class-template materialisation core.
 *
 * Shared between the daily Vercel cron at /api/cron/materialise-templates
 * and the operator "Republish all future classes" server action. Both
 * paths converge on the same upsert semantics (idempotent by
 * (template_id, starts_at) unique index), so the cron can run as often
 * as it wants without producing duplicates and the operator override
 * can re-materialise a single template without affecting others.
 *
 * Timezone handling: templates store start_time_local as wall-clock
 * (e.g. "18:00") on a given weekday. The studio's IANA tz governs the
 * conversion to UTC at materialisation time. Ireland's BST↔IST
 * transitions are handled naturally — the same "Monday 18:00" template
 * resolves to different UTC starts_at before and after the DST switch,
 * which is the correct behaviour.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** A class_templates row, projected to the fields materialisation needs. */
export interface MaterialisableTemplate {
  id: string;
  studio_id: string;
  name: string;
  weekday: number; // 0=Sunday..6=Saturday
  start_time_local: string; // "HH:MM" or "HH:MM:SS"
  duration_minutes: number;
  instructor_id: string | null;
  capacity: number;
  cancellation_window_hours: number;
  check_in_window_minutes: number;
  valid_from: string; // "YYYY-MM-DD"
  valid_until: string | null; // "YYYY-MM-DD" | null
}

export interface MaterialiseStudio {
  id: string;
  tz: string;
  materialisation_horizon_weeks: number;
}

export interface MaterialiseSummary {
  studioId: string;
  templateId: string;
  inserted: number;
  skipped: number;
}

/**
 * Convert a local wall-clock date+time in a given IANA tz into a UTC
 * Date. Handles DST transitions correctly via a single round-trip
 * through Intl.DateTimeFormat in `sv-SE` locale (which formats as
 * "YYYY-MM-DD HH:MM:SS").
 *
 * Edge case (skipped local hour during spring-forward): caller must
 * not pass a wall-clock time that doesn't exist in the tz. For class
 * scheduling at 18:00 in Europe/Dublin this is never an issue —
 * transitions happen at 01:00. If a template is ever defined with a
 * start_time in [01:00, 02:00) and lands on a spring-forward Sunday,
 * the result is the canonical "shifted forward by one hour" Date that
 * Intl produces for the non-existent local time; not strictly correct
 * but a defensible fallback.
 *
 * Edge case (repeated local hour during fall-back): the result picks
 * the FIRST occurrence (DST → standard). Again, only an issue if a
 * template lands in the [01:00, 02:00) window.
 */
export function localToUtc(
  dateLocal: string,
  timeLocal: string,
  tz: string,
): Date {
  // Normalise time to HH:MM (drop seconds if present).
  const [hh, mm] = timeLocal.split(":").map(Number);
  const [yr, mo, da] = dateLocal.split("-").map(Number);

  // Treat the wall-clock as if it were UTC, then ask Intl what THAT
  // moment renders as in the target tz. The diff is the tz offset at
  // that moment; subtracting it yields the real UTC instant whose
  // local-in-tz rendering matches the desired wall-clock.
  const wallAsUtc = Date.UTC(yr, mo - 1, da, hh, mm, 0);
  const rendered = new Date(wallAsUtc).toLocaleString("sv-SE", {
    timeZone: tz,
  });
  // sv-SE locale: "YYYY-MM-DD HH:MM:SS"
  const [rDate, rTime] = rendered.split(" ");
  const [ry, rm, rd] = rDate.split("-").map(Number);
  const [rh, rmin, rsec] = rTime.split(":").map(Number);
  const renderedAsUtc = Date.UTC(ry, rm - 1, rd, rh, rmin, rsec);
  const offsetMs = renderedAsUtc - wallAsUtc;
  return new Date(wallAsUtc - offsetMs);
}

/**
 * Today's date (YYYY-MM-DD) in the given IANA tz. Used as the anchor
 * for "where the materialisation horizon starts."
 */
export function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Add `days` to a YYYY-MM-DD string and return YYYY-MM-DD. Pure
 * calendar arithmetic — no tz concerns because we're working with
 * date-only values.
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Day-of-week (0=Sunday..6=Saturday) for a YYYY-MM-DD string. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The first date >= `fromDate` whose weekday matches `targetWeekday`.
 * If fromDate itself is on the target weekday, returns fromDate
 * unchanged.
 */
export function nextOccurrenceOnOrAfter(
  fromDate: string,
  targetWeekday: number,
): string {
  const current = weekdayOf(fromDate);
  const delta = (targetWeekday - current + 7) % 7;
  return addDays(fromDate, delta);
}

/**
 * Slug for a materialised class. Stable per (template, occurrence date)
 * because both inputs are unique. The 8-char prefix of the template id
 * is enough to avoid cross-template collisions at any plausible
 * pilot-stage row count (UUID v4 prefixes are uniformly distributed).
 */
export function materialisedSlug(templateId: string, dateStr: string): string {
  const short = templateId.replace(/-/g, "").slice(0, 8);
  return `tpl-${short}-${dateStr.replace(/-/g, "")}`;
}

/**
 * Compute the list of target occurrence dates for a single template,
 * given the studio's horizon. Returns dates in YYYY-MM-DD form,
 * ordered ascending.
 *
 * Logic:
 *   - Start = MAX(today's next-matching-weekday, latestExistingDate + 7)
 *   - End   = today + horizon_weeks * 7
 *   - Step  = 7 days
 *
 * latestExistingDate (when not null) is the YYYY-MM-DD of the latest
 * already-materialised class for this template (computed by the
 * caller from classes.starts_at after converting to studio tz).
 */
export function computeTargetDates(args: {
  todayLocal: string;
  weekday: number;
  horizonDays: number;
  validFrom: string;
  validUntil: string | null;
  latestExistingDateLocal: string | null;
}): string[] {
  const { todayLocal, weekday, horizonDays, validFrom, validUntil } = args;

  const nextFromToday = nextOccurrenceOnOrAfter(todayLocal, weekday);
  const nextFromLatest = args.latestExistingDateLocal
    ? addDays(args.latestExistingDateLocal, 7)
    : null;

  // Take the later of "next future occurrence" and "one week after the
  // latest existing materialised instance." Both guarantee weekday
  // alignment because the latest existing is itself weekday-aligned.
  let cursor = nextFromLatest && nextFromLatest > nextFromToday
    ? nextFromLatest
    : nextFromToday;

  // Respect the template's valid_from. If valid_from is in the future,
  // walk cursor forward to the first weekday on/after valid_from.
  if (cursor < validFrom) {
    cursor = nextOccurrenceOnOrAfter(validFrom, weekday);
  }

  const horizonEnd = addDays(todayLocal, horizonDays);

  const dates: string[] = [];
  while (cursor <= horizonEnd) {
    if (validUntil && cursor >= validUntil) break;
    dates.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return dates;
}

/**
 * Materialise a single template's instances into the classes table.
 * Returns a summary of how many rows were inserted vs. skipped (already
 * existed under the unique (template_id, starts_at) index).
 *
 * `client` must be the service-role Supabase client — the cron caller
 * iterates all studios, which RLS won't permit under any cookie session.
 *
 * `instructorName` is resolved by the caller (the cron pre-fetches all
 * staff full_names for the studio so it can look them up by template
 * instructor_id without N+1 round-trips). Falls back to "TBD" when the
 * template has no instructor.
 */
export async function materialiseTemplate(
  client: SupabaseClient,
  studio: MaterialiseStudio,
  template: MaterialisableTemplate,
  instructorName: string,
): Promise<MaterialiseSummary> {
  const todayLocal = todayInTz(studio.tz);

  // Look up the latest already-materialised class for this template.
  // Returns its starts_at as a UTC timestamp; we convert back to local
  // date in the studio's tz for cursor comparison.
  const { data: latestRows } = await client
    .from("classes")
    .select("starts_at")
    .eq("template_id", template.id)
    .order("starts_at", { ascending: false })
    .limit(1);

  const latestExistingDateLocal = latestRows?.[0]?.starts_at
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: studio.tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(latestRows[0].starts_at as string))
    : null;

  const targetDates = computeTargetDates({
    todayLocal,
    weekday: template.weekday,
    horizonDays: studio.materialisation_horizon_weeks * 7,
    validFrom: template.valid_from,
    validUntil: template.valid_until,
    latestExistingDateLocal,
  });

  if (targetDates.length === 0) {
    return {
      studioId: studio.id,
      templateId: template.id,
      inserted: 0,
      skipped: 0,
    };
  }

  const rows = targetDates.map((dateLocal) => {
    const startsAt = localToUtc(dateLocal, template.start_time_local, studio.tz);
    const endsAt = new Date(
      startsAt.getTime() + template.duration_minutes * 60_000,
    );
    return {
      studio_id: studio.id,
      template_id: template.id,
      slug: materialisedSlug(template.id, dateLocal),
      title: template.name,
      instructor_name: instructorName,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      capacity: template.capacity,
      cancellation_window_hours: template.cancellation_window_hours,
      check_in_window_minutes: template.check_in_window_minutes,
    };
  });

  // Use ignoreDuplicates so the partial-unique index on
  // (template_id, starts_at) WHERE template_id IS NOT NULL silently
  // skips already-materialised rows. We don't UPDATE existing rows
  // here on purpose — the operator's "Republish all future" action
  // handles in-place updates; the cron only fills forward.
  const { data, error } = await client
    .from("classes")
    .upsert(rows, {
      onConflict: "template_id,starts_at",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    throw new Error(
      `materialiseTemplate(${template.id}): upsert failed: ${error.message}`,
    );
  }

  const inserted = data?.length ?? 0;
  return {
    studioId: studio.id,
    templateId: template.id,
    inserted,
    skipped: rows.length - inserted,
  };
}

/**
 * Republish all FUTURE instances for one template (operator action).
 *
 * Semantics:
 *   - "Future" = starts_at > now() + 7 days. The 7-day buffer protects
 *     this-week classes from getting altered by a template edit; only
 *     beyond-the-horizon-but-already-materialised rows get rebuilt.
 *   - In-place UPDATE on existing rows by (template_id, starts_at).
 *     Bookings stay attached (no FK cascade fires).
 *   - Then call materialiseTemplate() to fill any gaps up to the studio
 *     horizon (e.g. if the template's valid_from moved earlier).
 *
 * The UPDATE-in-place strategy is deliberate (open question #1 in the
 * SF-004 brief): the DELETE+REINSERT alternative would cascade-delete
 * class_bookings rows, breaking the "bookings preserved on rebuilt
 * instances" contract.
 *
 * Returns the count of rebuilt classes and the count of bookings on
 * those rebuilt classes (for the confirmation UI's `M bookings` line).
 */
export interface RepublishCounts {
  rebuilt: number;
  bookingsAffected: number;
  newlyMaterialised: number;
}

export async function republishFutureInstances(
  client: SupabaseClient,
  studio: MaterialiseStudio,
  template: MaterialisableTemplate,
  instructorName: string,
): Promise<RepublishCounts> {
  const cutoff = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

  // Read existing future rows for this template.
  const { data: existingRows, error: readErr } = await client
    .from("classes")
    .select("id, starts_at")
    .eq("template_id", template.id)
    .gt("starts_at", cutoff)
    .order("starts_at", { ascending: true });

  if (readErr) {
    throw new Error(
      `republishFutureInstances(${template.id}): read failed: ${readErr.message}`,
    );
  }

  let bookingsAffected = 0;
  if (existingRows && existingRows.length > 0) {
    const classIds = existingRows.map((r) => r.id as string);
    const { count } = await client
      .from("class_bookings")
      .select("id", { count: "exact", head: true })
      .in("class_id", classIds)
      .eq("is_active", true);
    bookingsAffected = count ?? 0;

    // For each existing row, recompute the local-date and rebuild its
    // fields from the (now possibly updated) template values. The
    // starts_at stays put — UPDATE doesn't change the unique key, so
    // bookings keep referencing the same classes.id.
    for (const row of existingRows) {
      const startsAt = row.starts_at as string;
      const dateLocal = new Intl.DateTimeFormat("sv-SE", {
        timeZone: studio.tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(startsAt));
      // Recompute starts_at from the template — DST might have moved
      // the wall-clock since original materialisation.
      const newStartsAt = localToUtc(
        dateLocal,
        template.start_time_local,
        studio.tz,
      );
      const newEndsAt = new Date(
        newStartsAt.getTime() + template.duration_minutes * 60_000,
      );

      const { error: updErr } = await client
        .from("classes")
        .update({
          title: template.name,
          instructor_name: instructorName,
          starts_at: newStartsAt.toISOString(),
          ends_at: newEndsAt.toISOString(),
          capacity: template.capacity,
          cancellation_window_hours: template.cancellation_window_hours,
          check_in_window_minutes: template.check_in_window_minutes,
        })
        .eq("id", row.id as string);
      if (updErr) {
        throw new Error(
          `republishFutureInstances(${template.id}): update ${row.id} failed: ${updErr.message}`,
        );
      }
    }
  }

  // Fill forward — materialise any missing instances out to the studio
  // horizon. The cron's idempotent upsert handles dedupe.
  const fill = await materialiseTemplate(client, studio, template, instructorName);

  return {
    rebuilt: existingRows?.length ?? 0,
    bookingsAffected,
    newlyMaterialised: fill.inserted,
  };
}
