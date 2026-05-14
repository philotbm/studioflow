import Link from "next/link";
import { notFound } from "next/navigation";
import { scopedQuery } from "@/lib/db";
import {
  updateTemplate,
  type TemplateActionState,
} from "../actions";
import {
  TemplateForm,
  type InstructorOption,
  type TemplateFormInitial,
} from "../template-form";
import { RepublishPanel } from "./republish-panel";

/**
 * v0.24.0 (Sprint A) — Edit template page.
 *
 * Server component. Loads the template by id (scoped to the operator's
 * studio via RLS + scopedQuery), and renders the form with the
 * updateTemplate server action bound to this template's id. Below the
 * form, renders the RepublishPanel — a client component handling the
 * 2-step "Republish all future classes" confirmation.
 */
export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const client = await scopedQuery();
  if (!client) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-red-400 text-sm">
          Database client not configured.
        </p>
      </main>
    );
  }

  const { data: tplRow, error } = await client
    .from("class_templates")
    .select(
      "id, name, weekday, start_time_local, duration_minutes, instructor_id, capacity, cancellation_window_hours, check_in_window_minutes, valid_from, valid_until",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !tplRow) {
    notFound();
  }

  const initial: TemplateFormInitial = {
    name: tplRow.name as string,
    weekday: tplRow.weekday as number,
    start_time_local: (tplRow.start_time_local as string).slice(0, 5),
    duration_minutes: tplRow.duration_minutes as number,
    instructor_id: (tplRow.instructor_id as string | null) ?? null,
    capacity: tplRow.capacity as number,
    cancellation_window_hours: tplRow.cancellation_window_hours as number,
    check_in_window_minutes: tplRow.check_in_window_minutes as number,
    valid_from: tplRow.valid_from as string,
    valid_until: (tplRow.valid_until as string | null) ?? null,
  };

  const { data: studioRows } = await client
    .from("studios")
    .select("tz")
    .limit(1);
  const studioTz = (studioRows?.[0]?.tz as string | undefined) ?? "Europe/Dublin";

  const { data: instructorRows } = await client
    .from("staff")
    .select("id, full_name")
    .order("full_name", { ascending: true });
  const instructors: InstructorOption[] = (instructorRows ?? []).map((r) => ({
    id: r.id as string,
    full_name: r.full_name as string,
  }));

  // Bind the update action to this template's id. Server actions accept
  // .bind(null, …) for currying without losing the use-server marker.
  const boundUpdate = updateTemplate.bind(
    null,
    id,
  ) as (
    state: TemplateActionState,
    formData: FormData,
  ) => Promise<TemplateActionState>;

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/classes/templates"
        className="text-xs uppercase tracking-wide text-white/40 hover:text-white/80"
      >
        ← Templates
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        Edit: {initial.name}
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Edits affect future materialisations only. Already-scheduled
        instances within the studio horizon stay intact unless you use{" "}
        <span className="text-white/80">Republish all future classes</span>{" "}
        below.
      </p>

      <TemplateForm
        mode="edit"
        action={boundUpdate}
        initial={initial}
        instructors={instructors}
        studioTz={studioTz}
      />

      <section className="mt-12 rounded-lg border border-amber-400/20 bg-amber-400/[0.03] p-5">
        <h2 className="text-sm font-medium text-amber-300">
          Republish all future classes
        </h2>
        <p className="mt-1 text-xs text-amber-200/70">
          Rebuilds every future materialised instance (more than 7 days
          out) with the current template values. Bookings on rebuilt
          instances are preserved.
        </p>
        <RepublishPanel templateId={id} />
      </section>
    </main>
  );
}
