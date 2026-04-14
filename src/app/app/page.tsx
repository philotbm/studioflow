"use client";

import { useStore } from "@/lib/store";
import { useState } from "react";

export default function AppPage() {
  const { resetStore } = useStore();
  const [confirmed, setConfirmed] = useState(false);

  function handleReset() {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    resetStore();
    setConfirmed(false);
  }

  return (
    <main className="flex flex-col items-center gap-4 pt-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Welcome</h1>
      <p className="text-lg text-white/60">
        Product workspace coming next
      </p>

      {/* Dev-only reset — two-click safety */}
      <div className="mt-16">
        <button
          onClick={handleReset}
          className={`rounded border px-3 py-1.5 text-xs ${
            confirmed
              ? "border-red-400/40 text-red-400 hover:border-red-400"
              : "border-white/10 text-white/30 hover:text-white/50 hover:border-white/20"
          }`}
        >
          {confirmed ? "Confirm reset — all data will reseed" : "Reset demo data"}
        </button>
        {confirmed && (
          <button
            onClick={() => setConfirmed(false)}
            className="ml-2 text-xs text-white/30 hover:text-white/50"
          >
            Cancel
          </button>
        )}
      </div>
    </main>
  );
}
