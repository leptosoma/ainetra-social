"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { createSafeEnhancement, discardSafeEnhancement, keepSafeEnhancement } from "@/features/safe-enhance/service";
import { DomainError } from "@/lib/domain-error";

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

function revalidateMedia(mediaAssetId: string) {
  revalidatePath("/media");
  revalidatePath(`/media/${mediaAssetId}/analysis`);
}

export async function createSafeEnhancementAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "enhance-error";
  try {
    const enhancement = await createSafeEnhancement(currentUserId, mediaAssetId, String(formData.get("preset") ?? ""));
    notice = enhancement?.status === "SUCCEEDED"
      ? "enhance-ready"
      : enhancement?.status === "INVALID_OUTPUT"
        ? "enhance-invalid"
        : enhancement?.status === "PENDING"
          ? "enhance-pending"
          : "enhance-failed";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "VALIDATION_ERROR" ? "enhance-rejected" : "enhance-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}

export async function keepSafeEnhancementAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "enhance-error";
  try {
    await keepSafeEnhancement(currentUserId, String(formData.get("enhancementId") ?? ""));
    notice = "enhance-kept";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "CONFLICT" ? "enhance-decided" : "enhance-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}

export async function discardSafeEnhancementAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "enhance-error";
  try {
    await discardSafeEnhancement(currentUserId, String(formData.get("enhancementId") ?? ""));
    notice = "enhance-discarded";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "CONFLICT" ? "enhance-decided" : "enhance-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}
