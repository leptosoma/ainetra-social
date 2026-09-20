"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { dismissCaptureRequest } from "@/features/capture-engine/service";

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

export async function dismissCaptureRequestAction(formData: FormData) {
  await dismissCaptureRequest(await userId(), String(formData.get("captureRequestId") ?? ""));
  revalidatePath("/content-plan");
  revalidatePath("/dashboard");
  revalidatePath("/media");
}
