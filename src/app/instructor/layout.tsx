import { getCurrentStaffFromCookies } from "@/lib/auth";
import { InstructorShell } from "./instructor-shell";

/**
 * v0.21.0 server outer for /instructor/*.
 *
 * Auth/role gating happens in src/proxy.ts before this layout
 * renders, so by the time we're here the caller is guaranteed to
 * hold an instructor, manager, or owner role. We only need to
 * fetch the staff row for the "Signed in as …" indicator.
 *
 * Splitting into a server outer + client InstructorShell keeps the
 * SSR cookie read in this file while StoreProvider stays client.
 */
export default async function InstructorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await getCurrentStaffFromCookies();
  return <InstructorShell staff={staff}>{children}</InstructorShell>;
}
