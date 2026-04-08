"use server";

import { revalidatePath } from "next/cache";
import { readPromotions, writePromotions } from "./promotions";

export async function promoteWaitlistEntry(formData: FormData) {
  const classId = String(formData.get("classId") ?? "").trim();
  const position = Number(formData.get("position"));

  if (!classId || !Number.isFinite(position)) {
    return;
  }

  const promotions = await readPromotions();
  const alreadyPromoted = promotions.some(
    (p) => p.classId === classId && p.position === position,
  );

  if (!alreadyPromoted) {
    promotions.push({ classId, position });
    await writePromotions(promotions);
  }

  // Re-render the class detail and the classes list so booked/waitlist
  // counts reflect the new promotion everywhere they're displayed.
  revalidatePath(`/app/classes/${classId}`);
  revalidatePath("/app/classes");
}
