"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { deleteMedia, uploadMedia } from "@/features/media/service";

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

export async function uploadMediaAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Dosya seçilmedi.");
  await uploadMedia(await userId(), String(formData.get("businessId") ?? ""), file);
  revalidatePath("/media");
}

export async function deleteMediaAction(formData: FormData) {
  await deleteMedia(await userId(), String(formData.get("mediaAssetId") ?? ""));
  revalidatePath("/media");
}
