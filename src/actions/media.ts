"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { deleteMedia, updateMediaPlanningTags, uploadMedia } from "@/features/media/service";
import { analyzeMediaAsset } from "@/features/visual-analysis/service";
import { DomainError } from "@/lib/domain-error";

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

export async function uploadMediaAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Dosya seçilmedi.");
  await uploadMedia(await userId(), String(formData.get("businessId") ?? ""), file, formData.getAll("tags").map(String));
  revalidatePath("/media");
  revalidatePath("/content-plan");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function updateMediaPlanningTagsAction(formData: FormData) {
  await updateMediaPlanningTags(await userId(), String(formData.get("mediaAssetId") ?? ""), formData.getAll("tags").map(String));
  revalidatePath("/media");
  revalidatePath("/content-plan");
}

export async function deleteMediaAction(formData: FormData) {
  await deleteMedia(await userId(), String(formData.get("mediaAssetId") ?? ""));
  revalidatePath("/media");
  revalidatePath("/content-plan");
}

export async function analyzeMediaAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "") === "library" ? "/media" : `/media/${mediaAssetId}/analysis`;
  const currentUserId = await userId();
  let notice = "analysis-error";
  try {
    const attempt = await analyzeMediaAsset(currentUserId, mediaAssetId);
    notice = attempt?.status === "SUCCEEDED" ? "analysis-complete" : attempt?.status === "INVALID_OUTPUT" ? "analysis-invalid" : "analysis-failed";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "VALIDATION_ERROR" ? "analysis-rejected" : "analysis-error";
  }
  revalidatePath("/media");
  revalidatePath(`/media/${mediaAssetId}/analysis`);
  redirect(`${returnTo}?notice=${notice}`);
}
