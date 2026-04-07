export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 px-6 py-4">
        <span className="text-sm font-medium tracking-wide text-white/80">
          StudioFlow App
        </span>
      </header>
      <div className="px-6 py-8">{children}</div>
    </div>
  );
}
