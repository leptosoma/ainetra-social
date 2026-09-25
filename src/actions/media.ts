"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { deleteMedia, updateMediaPlanningTags, uploadMedia, uploadMediaForCaptureRequest } from "@/features/media/service";
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

export type CaptureUploadState = { status: "idle" | "success" | "error"; message: string };

/**
 * P5.5B: mobil çekim sayfası ve Bugün kartı için yükleme. Hata bir hata sayfasına düşmez; kullanıcıya
 * düz Türkçe bir sonuç döner. `captureRequestId` varsa işletme ve etiket sunucuda istekten türetilir;
 * yoksa dosya etiketsiz olarak medya kütüphanesine eklenir (üyelik yine sunucuda denetlenir).
 */
export async function captureUploadAction(_previous: CaptureUploadState, formData: FormData): Promise<CaptureUploadState> {
  const currentUserId = await userId();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Dosya seçilmedi." };
  const captureRequestId = String(formData.get("captureRequestId") ?? "");
  try {
    if (captureRequestId) await uploadMediaForCaptureRequest(currentUserId, captureRequestId, file);
    else await uploadMedia(currentUserId, String(formData.get("businessId") ?? ""), file, []);
  } catch (error) {
    if (error instanceof DomainError) return { status: "error", message: error.message };
    throw error;
  }
  revalidatePath("/media");
  revalidatePath("/content-plan");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return {
    status: "success",
    message: captureRequestId ? "Yüklendi. Bu çekim görevi için medya alındı." : "Yüklendi. Dosya medya kütüphanenize eklendi.",
  };
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
