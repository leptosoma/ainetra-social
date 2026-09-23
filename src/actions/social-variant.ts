"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { createSocialVariant, discardSocialVariant, keepSocialVariant } from "@/features/social-variant/service";
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

export async function createSocialVariantAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "variant-error";
  try {
    const variant = await createSocialVariant(
      currentUserId,
      mediaAssetId,
      String(formData.get("platform") ?? ""),
      String(formData.get("format") ?? ""),
    );
    notice = variant?.status === "SUCCEEDED"
      ? "variant-ready"
      : variant?.status === "INVALID_OUTPUT"
        ? "variant-invalid"
        : variant?.status === "PENDING"
          ? "variant-pending"
          : "variant-failed";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "VALIDATION_ERROR" ? "variant-rejected" : "variant-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}

export async function keepSocialVariantAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "variant-error";
  try {
    await keepSocialVariant(currentUserId, String(formData.get("variantId") ?? ""));
    notice = "variant-kept";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "CONFLICT" ? "variant-decided" : "variant-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}

export async function discardSocialVariantAction(formData: FormData) {
  const mediaAssetId = String(formData.get("mediaAssetId") ?? "");
  const currentUserId = await userId();
  let notice = "variant-error";
  try {
    await discardSocialVariant(currentUserId, String(formData.get("variantId") ?? ""));
    notice = "variant-discarded";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "CONFLICT" ? "variant-decided" : "variant-error";
  }
  revalidateMedia(mediaAssetId);
  redirect(`/media/${mediaAssetId}/analysis?notice=${notice}`);
}
