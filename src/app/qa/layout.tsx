import Link from "next/link";

/**
 * v0.8.4.1 QA shell. Deliberately independent of the member-facing
 * /checkin and operator-facing /instructor shells so the QA landing
 * can't be mistaken for a production surface.
 */
export default function QaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <Link
          href="/qa"
          className="text-sm font-medium tracking-wide text-white/80 hover:text-white"
        >
          StudioFlow QA
        </Link>
        <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] text-amber-300/80">
          fixtures
        </span>
      </header>
      <div className="px-6 py-8">{children}</div>
    </div>
  );
}
