"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StoreProvider } from "@/lib/store";
import type { StaffRow } from "@/lib/auth";

const navItems = [
  { label: "Dashboard", href: "/app" },
  { label: "Classes", href: "/app/classes" },
  { label: "Members", href: "/app/members" },
  { label: "Plans", href: "/app/plans" },
  { label: "Revenue", href: "/app/revenue" },
];

/**
 * v0.21.0 — client shell extracted from the layout so the layout
 * can stay a server component (which is what lets it call
 * getCurrentStaffFromCookies). Holds StoreProvider, nav, and the
 * "Signed in as …" indicator with the Switch-to-member-view link
 * for users who hold both a staff row and a members row.
 *
 * `staff` is null only in the no-Supabase-config local dev case
 * (proxy passes through with a 503 in API paths but pages can
 * still render); we degrade to "Signed in" without a name.
 */
export function AppShell({
  staff,
  memberSlug,
  children,
}: {
  staff: StaffRow | null;
  memberSlug: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <StoreProvider>
      <div className="min-h-screen bg-black text-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
          <span className="text-sm font-medium tracking-wide text-white/80">
            StudioFlow App
          </span>
          <nav className="flex flex-wrap gap-6">
            {navItems.map((item) => {
              const isActive =
                item.href === "/app"
                  ? pathname === "/app"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`text-sm ${
                    isActive
                      ? "text-white font-medium"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3 text-xs text-white/50">
            {staff ? (
              <span>
                Signed in as{" "}
                <span className="text-white/80">{staff.full_name}</span> (
                {staff.role})
              </span>
            ) : (
              <span>Signed in</span>
            )}
            {memberSlug && (
              <Link
                href={`/my/${memberSlug}`}
                className="text-white/50 hover:text-white/80"
              >
                Member view
              </Link>
            )}
            <Link
              href="/auth/signout?intent=staff"
              className="text-white/50 hover:text-white/80"
            >
              Sign out
            </Link>
          </div>
        </header>
        <div className="px-6 py-8">{children}</div>
      </div>
    </StoreProvider>
  );
}
