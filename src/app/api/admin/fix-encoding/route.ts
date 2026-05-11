import { NextResponse } from "next/server";
import { scopedQuery } from "@/lib/db";

/**
 * v0.9.3 mojibake sanitiser for stored member JSON fields.
 *
 * Why this endpoint exists
 * ------------------------
 * supabase/seed.sql is canonical UTF-8 (61 em dashes, no mojibake).
 * However the live Supabase DB was populated at some point via the
 * SQL Editor on a session where the client software mis-decoded the
 * UTF-8 bytes as Windows-1252 / CP437, so U+2014 em dashes arrived
 * in stored JSON as the three-character sequence "ΓÇö". Visible in
 * live member pages as e.g. "Reformer Pilates ΓÇö Mon 09:00" and
 * "Strong attendance, zero cancellations ΓÇö ideal member".
 *
 * Fixing seed.sql is not enough — the seed file is already clean;
 * the mangled bytes are in the live DB rows. This endpoint walks
 * every member's JSONB columns, replaces known mojibake sequences
 * with their intended Unicode characters, and writes the result back.
 *
 * Idempotent: once a member's JSON is clean, subsequent runs find no
 * matches and write nothing. Safe to re-run as many times as needed.
 *
 * Scoped to the four member JSON columns only — does NOT touch
 * credits_remaining, plan_type, status, bookings, events, or any
 * other live operational data.
 */

type MojibakeMap = Readonly<Record<string, string>>;

// Common Windows-1252/CP437 misinterpretations of UTF-8 bytes. Only
// the ones we've actually observed live plus the obvious adjacent
// cases — anything that might land in operator-entered notes or seed
// JSON strings.
const MOJIBAKE: MojibakeMap = {
  "ΓÇö": "—", // U+2014 em dash — the one observed live
  "ΓÇô": "–", // U+2013 en dash (defensive)
  "ΓÇÖ": "'", // U+2019 right single quote → ASCII apostrophe
  "ΓÇÿ": "'", // U+2018 left single quote → ASCII apostrophe
  "ΓÇ£": '"', // U+201C left double quote → ASCII double quote
  "ΓÇ¥": '"', // U+201D right double quote → ASCII double quote
  "ΓÇª": "…", // U+2026 horizontal ellipsis (defensive)
};

const JSON_COLUMNS = [
  "insights_json",
  "purchase_insights_json",
  "opportunity_signals_json",
  "history_summary_json",
] as const;

type JsonColumn = (typeof JSON_COLUMNS)[number];

function sanitiseString(input: string): string {
  let out = input;
  for (const [bad, good] of Object.entries(MOJIBAKE)) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  return out;
}

/**
 * Walk a JSON value, replacing mojibake in every string leaf.
 * Returns { changed, value } so we only UPDATE rows that actually
 * have mojibake.
 */
function sanitiseJson(input: unknown): { changed: boolean; value: unknown } {
  if (input === null || input === undefined) {
    return { changed: false, value: input };
  }
  if (typeof input === "string") {
    const cleaned = sanitiseString(input);
    return { changed: cleaned !== input, value: cleaned };
  }
  if (Array.isArray(input)) {
    let changed = false;
    const out = input.map((item) => {
      const r = sanitiseJson(item);
      if (r.changed) changed = true;
      return r.value;
    });
    return { changed, value: changed ? out : input };
  }
  if (typeof input === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const r = sanitiseJson(v);
      if (r.changed) changed = true;
      out[k] = r.value;
    }
    return { changed, value: changed ? out : input };
  }
  // numbers, booleans — unchanged
  return { changed: false, value: input };
}

async function handle(confirm: boolean) {
  const client = await scopedQuery();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase client not configured" },
      { status: 503 },
    );
  }

  const { data: rows, error: readErr } = await client
    .from("members")
    .select(
      "id, slug, insights_json, purchase_insights_json, opportunity_signals_json, history_summary_json",
    );
  if (readErr) {
    return NextResponse.json(
      { ok: false, stage: "read", error: readErr.message },
      { status: 500 },
    );
  }

  const members = rows ?? [];
  // Preview pass — count what WOULD be fixed without writing anything.
  const preview: Array<{ slug: string; columns: string[] }> = [];
  let previewColumns = 0;
  for (const m of members as Array<Record<string, unknown>>) {
    const columnsWouldFix: string[] = [];
    const updates: Record<string, unknown> = {};
    for (const col of JSON_COLUMNS as readonly JsonColumn[]) {
      const r = sanitiseJson(m[col]);
      if (r.changed) {
        updates[col] = r.value;
        columnsWouldFix.push(col);
      }
    }
    if (columnsWouldFix.length > 0) {
      const slug = typeof m.slug === "string" ? m.slug : "(unknown)";
      preview.push({ slug, columns: columnsWouldFix });
      previewColumns += columnsWouldFix.length;
    }
  }

  // v0.9.3.1 dry-run-by-default. The write path requires an explicit
  // { confirm: true } in the POST body or ?confirm=true query param.
  // Before v0.9.3.1 any unauthenticated POST ran the write; now the
  // endpoint is safe to leave exposed in production because no caller
  // can accidentally mutate data without explicit opt-in.
  if (!confirm) {
    return NextResponse.json({
      ok: true,
      mode: "dry_run",
      totalMembers: members.length,
      wouldFixMembers: preview.length,
      wouldFixColumns: previewColumns,
      preview,
      patterns: Object.keys(MOJIBAKE),
      note:
        preview.length === 0
          ? "Already clean — no rows need repair."
          : "Dry run only. Re-send with { confirm: true } (POST body) or ?confirm=true to apply.",
    });
  }

  // Confirmed write path — perform the updates.
  let fixedMembers = 0;
  let fixedColumns = 0;
  const fixed: Array<{ slug: string; columns: string[] }> = [];
  const errors: Array<{ slug: string; error: string }> = [];

  for (const m of members as Array<Record<string, unknown>>) {
    const updates: Record<string, unknown> = {};
    const columnsFixed: string[] = [];
    for (const col of JSON_COLUMNS as readonly JsonColumn[]) {
      const r = sanitiseJson(m[col]);
      if (r.changed) {
        updates[col] = r.value;
        columnsFixed.push(col);
      }
    }
    if (columnsFixed.length > 0) {
      const slug = typeof m.slug === "string" ? m.slug : "(unknown)";
      const id = m.id as string;
      const { error: updErr } = await client
        .from("members")
        .update(updates)
        .eq("id", id);
      if (updErr) {
        errors.push({ slug, error: updErr.message });
        continue;
      }
      fixedMembers++;
      fixedColumns += columnsFixed.length;
      fixed.push({ slug, columns: columnsFixed });
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "write",
    totalMembers: members.length,
    fixedMembers,
    fixedColumns,
    fixed,
    errors,
    patterns: Object.keys(MOJIBAKE),
  });
}

function confirmFromUrl(req: Request): boolean {
  const url = new URL(req.url);
  const v = url.searchParams.get("confirm");
  return v === "true" || v === "1" || v === "yes";
}

export async function POST(req: Request) {
  // Accept confirm from either the body or the query string so curl
  // and fetch both work. Body takes precedence.
  let confirm = confirmFromUrl(req);
  try {
    const body = (await req.json()) as { confirm?: unknown };
    if (body && typeof body === "object" && body.confirm !== undefined) {
      confirm = body.confirm === true;
    }
  } catch {
    // no body / not JSON — stick with query-string value
  }
  return handle(confirm);
}

export async function GET(req: Request) {
  // GET is always a dry run — never mutates.
  return handle(false);
}
