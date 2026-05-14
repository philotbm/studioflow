"use client";

import { useActionState } from "react";
import Link from "next/link";
import { localToUtc } from "@/lib/template-materialise";
import type { TemplateActionState } from "./actions";

/**
 * v0.24.0 (Sprint A) — Shared template form (create + edit).
 *
 * Client component. Wires a server action via React 19's
 * useActionState. The parent page passes:
 *   - `action`: the server action (createTemplate or a bound updateTemplate)
 *   - `initial`: the row to pre-fill (null for /new)
 *   - `instructors`: { id, full_name } list for the dropdown
 *   - `studioTz`: IANA tz used for the "This class will be at …" preview
 *
 * Validation is server-side authoritative (CHECK constraints in the DB,
 * plus parseTemplatePayload in actions.ts). The UI does light
 * client-side niceties (live tz preview) but never gates submission.
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

export interface TemplateFormInitial {
  name: string;
  weekday: number;
  start_time_local: string;
  duration_minutes: number;
  instructor_id: string | null;
  capacity: number;
  cancellation_window_hours: number;
  check_in_window_minutes: number;
  valid_from: string;
  valid_until: string | null;
}

export interface InstructorOption {
  id: string;
  full_name: string;
}

interface TemplateFormProps {
  mode: "new" | "edit";
  action: (
    state: TemplateActionState,
    formData: FormData,
  ) => Promise<TemplateActionState>;
  initial: TemplateFormInitial | null;
  instructors: InstructorOption[];
  studioTz: string;
}

const DEFAULT_INITIAL: TemplateFormInitial = {
  name: "",
  weekday: 1,
  start_time_local: "18:00",
  duration_minutes: 60,
  instructor_id: null,
  capacity: 12,
  cancellation_window_hours: 12,
  check_in_window_minutes: 30,
  valid_from: new Date().toISOString().slice(0, 10),
  valid_until: null,
};

export function TemplateForm({
  mode,
  action,
  initial,
  instructors,
  studioTz,
}: TemplateFormProps) {
  const data = initial ?? DEFAULT_INITIAL;
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-5">
      <Field
        label="Name"
        hint="Member-facing class name (e.g. Vinyasa Flow)."
      >
        <input
          name="name"
          type="text"
          required
          defaultValue={data.name}
          maxLength={120}
          className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Day of week" hint="Repeats every week on this day.">
          <select
            name="weekday"
            defaultValue={String(data.weekday)}
            required
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
          >
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Start time"
          hint={`Local wall-clock in ${studioTz}.`}
        >
          <input
            name="start_time_local"
            type="time"
            required
            defaultValue={data.start_time_local.slice(0, 5)}
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Duration (minutes)" hint="1 to 480.">
          <input
            name="duration_minutes"
            type="number"
            required
            min={1}
            max={480}
            defaultValue={data.duration_minutes}
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
          />
        </Field>

        <Field label="Capacity" hint="Max bookings per occurrence.">
          <input
            name="capacity"
            type="number"
            required
            min={1}
            defaultValue={data.capacity}
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
          />
        </Field>
      </div>

      <Field
        label="Instructor"
        hint="Optional — leave blank to assign later. Materialised classes without an instructor show 'TBD'."
      >
        <select
          name="instructor_id"
          defaultValue={data.instructor_id ?? ""}
          className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
        >
          <option value="">— Unassigned (TBD)</option>
          {instructors.map((i) => (
            <option key={i.id} value={i.id}>
              {i.full_name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          label="Cancellation window (hours)"
          hint="Free cancellation closes this many hours before the start."
        >
          <input
            name="cancellation_window_hours"
            type="number"
            required
            min={0}
            defaultValue={data.cancellation_window_hours}
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
          />
        </Field>

        <Field
          label="Check-in window (minutes)"
          hint="Check-in opens this many minutes before the start."
        >
          <input
            name="check_in_window_minutes"
            type="number"
            required
            min={0}
            max={240}
            defaultValue={data.check_in_window_minutes}
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Valid from" hint="First date this template applies.">
          <input
            name="valid_from"
            type="date"
            required
            defaultValue={data.valid_from}
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
          />
        </Field>

        <Field
          label="Valid until"
          hint="Optional. Last date the template applies (inclusive-exclusive: the cron stops before this date)."
        >
          <input
            name="valid_until"
            type="date"
            defaultValue={data.valid_until ?? ""}
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none"
          />
        </Field>
      </div>

      <TimezonePreview studioTz={studioTz} initial={data} />

      {state.error && (
        <p
          role="alert"
          className="rounded border border-red-400/40 bg-red-400/5 px-4 py-3 text-sm text-red-300"
        >
          {state.error}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <Link
          href="/app/classes/templates"
          className="text-xs uppercase tracking-wide text-white/40 hover:text-white/80"
        >
          ← Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-white/30 px-4 py-2 text-sm hover:border-white/60 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {pending
            ? "Saving…"
            : mode === "new"
              ? "Create template"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-white/60">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-white/40">{hint}</span>}
    </label>
  );
}

/**
 * Renders a "This class will be at HH:MM in <tz>; sample materialised
 * UTC time on the next occurrence" preview. Read-only — purely
 * informational. Helps the operator catch a TZ surprise (e.g. they're
 * setting "07:00" thinking it's UTC when it's local Dublin time).
 */
function TimezonePreview({
  studioTz,
  initial,
}: {
  studioTz: string;
  initial: TemplateFormInitial;
}) {
  const dateLocal = initial.valid_from;
  const timeLocal = initial.start_time_local.slice(0, 5);
  let preview: string;
  try {
    const utc = localToUtc(dateLocal, timeLocal, studioTz);
    preview = `Sample: a class on ${dateLocal} at ${timeLocal} in ${studioTz} corresponds to ${utc.toISOString()} UTC.`;
  } catch {
    preview = `Studio timezone: ${studioTz}.`;
  }
  return (
    <p className="rounded border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/50">
      {preview}
    </p>
  );
}
