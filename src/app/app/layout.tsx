"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StoreProvider } from "@/lib/store";

const navItems = [
  { label: "Dashboard", href: "/app" },
  { label: "Classes", href: "/app/classes" },
  { label: "Members", href: "/app/members" },
  { label: "Plans", href: "/app/plans" },
  { label: "Revenue", href: "/app/revenue" },
];

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();

  return (
    <StoreProvider>
      <div className="min-h-screen bg-black text-white">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <span className="text-sm font-medium tracking-wide text-white/80">
            StudioFlow App
          </span>
          <nav className="flex gap-6">
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
        </header>
        <div className="px-6 py-8">{children}</div>
      </div>
    </StoreProvider>
  );
}
