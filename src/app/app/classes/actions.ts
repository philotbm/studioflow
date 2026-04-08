"use server";

import { revalidatePath } from "next/cache";
import {
  isCurrentlyPromoted,
  readPromotionEvents,
  writePromotionEvents,
} from "./promotions";

function parseTargets(formData: FormData): {
  classId: string;
  position: number;
} | null {
  const classId = String(formData.get("classId") ?? "").trim();
  const position = Number(formData.get("position"));
  if (!classId || !Number.isFinite(position)) return null;
  return { classId, position };
}

async function revalidateClass(classId: string) {
  // Both the list card and the detail page render from the same cookie-backed
  // transform, so both have to be rebuilt to keep counts consistent.
  revalidatePath(`/app/classes/${classId}`);
  revalidatePath("/app/classes");
}

export async function promoteWaitlistEntry(formData: FormData) {
  const target = parseTargets(formData);
  if (!target) return;

  const events = await readPromotionEvents();
  if (isCurrentlyPromoted(events, target.classId, target.position)) {
    return; // already promoted — no-op, keeps the audit log clean
  }

  events.push({
    classId: target.classId,
    position: target.position,
    action: "promote",
    at: Date.now(),
  });
  await writePromotionEvents(events);
  await revalidateClass(target.classId);
}

export async function unpromoteWaitlistEntry(formData: FormData) {
  const target = parseTargets(formData);
  if (!target) return;

  const events = await readPromotionEvents();
  if (!isCurrentlyPromoted(events, target.classId, target.position)) {
    return; // not currently promoted — no-op
  }

  events.push({
    classId: target.classId,
    position: target.position,
    action: "unpromote",
    at: Date.now(),
  });
  await writePromotionEvents(events);
  await revalidateClass(target.classId);
}
