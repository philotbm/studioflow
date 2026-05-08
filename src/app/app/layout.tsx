import {
  getCurrentStaffFromCookies,
  getCurrentUserFromCookies,
} from "@/lib/auth";
import { getSupabaseServerAuthClient } from "@/lib/supabase";
import { AppShell } from "./app-shell";

/**
 * v0.21.0 server outer for /app/*.
 *
 * Auth/role gating happens in src/proxy.ts before this layout
 * renders, so by the time we're here the caller is guaranteed to be
 * a manager or owner. We only need to fetch the staff row to render
 * "Signed in as …", and look up whether the same user also owns a
 * members row (Phil's case) so we can offer a "Member view" link.
 *
 * Splitting the layout into a server outer + client AppShell lets
 * the StoreProvider + usePathname-driven nav stay client-side while
 * the SSR cookie reads happen in this file.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await getCurrentStaffFromCookies();

  // Find the member slug owned by this user, if any. UNIQUE(user_id)
  // means at most one row.
  let memberSlug: string | null = null;
  const user = await getCurrentUserFromCookies();
  if (user) {
    const supabase = await getSupabaseServerAuthClient();
    if (supabase) {
      const { data } = await supabase
        .from("members")
        .select("slug")
        .eq("user_id", user.id)
        .maybeSingle();
      memberSlug = data?.slug ?? null;
    }
  }

  return (
    <AppShell staff={staff} memberSlug={memberSlug}>
      {children}
    </AppShell>
  );
}
