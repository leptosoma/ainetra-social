"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { createBrandStyle, discardBrandStyle, keepBrandStyle } from "@/features/brand-style/service";
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

export async function createBrandStyleAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "brand-style-error";
  try {
    const brandStyle = await createBrandStyle(currentUserId, mediaAssetId, String(formData.get("choice") ?? ""));
    notice = brandStyle?.status === "SUCCEEDED"
      ? "brand-style-ready"
      : brandStyle?.status === "INVALID_OUTPUT"
        ? "brand-style-invalid"
        : brandStyle?.status === "PENDING"
          ? "brand-style-pending"
          : "brand-style-failed";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "VALIDATION_ERROR" ? "brand-style-rejected" : "brand-style-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}

export async function keepBrandStyleAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "brand-style-error";
  try {
    await keepBrandStyle(currentUserId, String(formData.get("brandStyleId") ?? ""));
    notice = "brand-style-kept";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "CONFLICT" ? "brand-style-decided" : "brand-style-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}

export async function discardBrandStyleAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "brand-style-error";
  try {
    await discardBrandStyle(currentUserId, String(formData.get("brandStyleId") ?? ""));
    notice = "brand-style-discarded";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "CONFLICT" ? "brand-style-decided" : "brand-style-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}
