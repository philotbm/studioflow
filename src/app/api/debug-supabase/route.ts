import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  // Test direct fetch to Supabase REST API
  let fetchResult = "not attempted";
  let fetchError = null;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/classes?select=slug&limit=1`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });
      fetchResult = `status=${res.status}, body=${await res.text()}`;
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    url_set: !!url,
    url_prefix: url ? url.substring(0, 30) + "..." : "EMPTY",
    key_set: !!key,
    key_prefix: key ? key.substring(0, 20) + "..." : "EMPTY",
    key_length: key.length,
    fetchResult,
    fetchError,
  });
}
