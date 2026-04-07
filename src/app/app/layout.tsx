export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <span className="text-sm font-medium tracking-wide text-white/80">
          StudioFlow App
        </span>
        <nav className="flex gap-6">
          <a href="/app" className="text-sm text-white/60 hover:text-white">Dashboard</a>
          <a href="/app" className="text-sm text-white/60 hover:text-white">Classes</a>
          <a href="/app" className="text-sm text-white/60 hover:text-white">Members</a>
        </nav>
      </header>
      <div className="px-6 py-8">{children}</div>
    </div>
  );
}
