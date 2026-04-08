"use client";

import { useState } from "react";
import type { Attendee } from "../data";
import { getAttendeeDisplayStatus, toneBadgeClasses } from "./status";

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
    <ul className="mt-3 flex flex-col gap-1.5">
      {attendees.map((a, i) => {
        const display = getAttendeeDisplayStatus(a, "live");
        const isCheckedIn = a.status === "checked_in" || a.status === "attended";
        const canCheckIn = !isCheckedIn && a.status !== "late_cancel";

        return (
          <li
            key={i}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5 hover:border-white/20 hover:bg-white/[0.04]"
          >
            <span className="text-sm text-white/85">{a.name}</span>
            {canCheckIn ? (
              <button
                onClick={() => handleCheckIn(i)}
                className="rounded-full border border-white/20 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-white/70 hover:text-white hover:border-white/40 hover:bg-white/[0.08]"
              >
                Check in
              </button>
            ) : (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${toneBadgeClasses[display.tone]}`}
              >
                {display.label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
