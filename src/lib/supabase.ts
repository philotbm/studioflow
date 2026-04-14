import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  if (process.env.NODE_ENV === "development") {
    console.log("[StudioFlow] Supabase client initialized:", supabaseUrl);
  }
} else if (typeof window !== "undefined") {
  // Client-side only — during build this is expected to be missing
  console.error(
    "[StudioFlow] Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
  );
}

export { supabase };
