import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// NEXT_PUBLIC_ vars are inlined at build time by Next.js.
// Lazy init ensures the client is created when first needed, not at import time.

let _client: SupabaseClient | null = null;
let _initAttempted = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (_initAttempted) return _client;
  _initAttempted = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (url && key) {
    _client = createClient(url, key);
  } else if (typeof window !== "undefined") {
    console.error(
      "[StudioFlow] Supabase env vars missing.",
      "NEXT_PUBLIC_SUPABASE_URL:", url ? "set" : "EMPTY",
      "| NEXT_PUBLIC_SUPABASE_ANON_KEY:", key ? "set" : "EMPTY",
      "| If you just added env vars to Vercel, trigger a redeploy.",
    );
  }

  return _client;
}
