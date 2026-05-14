import Link from "next/link";
import { scopedQuery } from "@/lib/db";
import { createTemplate } from "../actions";
import {
  TemplateForm,
  type InstructorOption,
} from "../template-form";

/**
 * v0.24.0 (Sprint A) — Create template page.
 *
 * Server component. Resolves the studio's tz + the available
 * instructor list, then hands off to the client form.
 */
export default async function NewTemplatePage() {
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

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/classes/templates"
        className="text-xs uppercase tracking-wide text-white/40 hover:text-white/80"
      >
        ← Templates
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        New class template
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Saving will create the template. The daily cron picks it up on its
        next run and materialises the first N weeks of classes.
      </p>
      <TemplateForm
        mode="new"
        action={createTemplate}
        initial={null}
        instructors={instructors}
        studioTz={studioTz}
      />
    </main>
  );
}
