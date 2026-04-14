"use client";

import { useStore } from "@/lib/store";

export default function AppPage() {
  const { refresh } = useStore();

  return (
    <main className="flex flex-col items-center gap-4 pt-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Welcome</h1>
      <p className="text-lg text-white/60">
        Product workspace coming next
      </p>

      <div className="mt-16">
        <button
          onClick={() => refresh()}
          className="rounded border border-white/10 px-3 py-1.5 text-xs text-white/30 hover:text-white/50 hover:border-white/20"
        >
          Refresh data
        </button>
      </div>
    </main>
  );
}
