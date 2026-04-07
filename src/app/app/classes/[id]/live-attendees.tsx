"use client";

import { useState } from "react";
import type { Attendee } from "../data";

export default function LiveAttendees({
  initialAttendees,
}: {
  initialAttendees: Attendee[];
}) {
  const [attendees, setAttendees] = useState(initialAttendees);

  function handleCheckIn(index: number) {
    setAttendees((prev) =>
      prev.map((a, i) =>
        i === index ? { ...a, status: "checked_in" as const } : a
      )
    );
  }

  return (
    <ul className="mt-3 flex flex-col gap-2">
      {attendees.map((a, i) => (
        <li
          key={i}
          className="flex items-center justify-between rounded border border-white/10 px-4 py-2"
        >
          <span className="text-sm">{a.name}</span>
          {a.status === "checked_in" ? (
            <span className="text-xs text-green-400">Checked in</span>
          ) : a.status === "not_checked_in" ? (
            <button
              onClick={() => handleCheckIn(i)}
              className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40"
            >
              Check in
            </button>
          ) : (
            <span className="text-xs text-red-400">
              {a.status === "late_cancel" ? "Late cancel" : a.status}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
