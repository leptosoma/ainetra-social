"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { createContent, recordContentExport, updateContentVariant } from "@/features/content/service";
import { approveContentVariant } from "@/features/approval/service";
import { scheduleContentVariant } from "@/features/publishing/service";

function str(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

export async function createContentAction(formData: FormData) {
  const content = await createContent(await userId(), str(formData, "businessId"), {
    title: str(formData, "title"),
    topic: str(formData, "topic"),
    contentType: str(formData, "contentType"),
    goalId: str(formData, "goalId") || null,
    platform: str(formData, "platform"),
    caption: str(formData, "caption"),
    cta: str(formData, "cta") || null,
    language: str(formData, "language") || "tr",
    mediaAssetId: str(formData, "mediaAssetId") || null,
    aspectRatio: str(formData, "aspectRatio") || null,
  });
  redirect(`/content/${content.id}`);
}

export async function updateVariantAction(formData: FormData) {
  const variantId = str(formData, "variantId");
  const contentId = str(formData, "contentId");
  await updateContentVariant(await userId(), variantId, {
    caption: str(formData, "caption"),
    cta: str(formData, "cta") || null,
    language: str(formData, "language") || "tr",
    mediaAssetId: str(formData, "mediaAssetId") || null,
    aspectRatio: str(formData, "aspectRatio") || null,
  });
  revalidatePath(`/content/${contentId}`);
}

export async function approveVariantAction(formData: FormData) {
  await approveContentVariant(await userId(), str(formData, "variantId"));
  revalidatePath(`/content/${str(formData, "contentId")}`);
  revalidatePath("/content");
}

export async function scheduleVariantAction(formData: FormData) {
  await scheduleContentVariant(await userId(), str(formData, "variantId"), {
    socialAccountId: str(formData, "socialAccountId"),
    scheduledAt: str(formData, "scheduledAt"),
    expectedVersion: Number(str(formData, "expectedVersion")),
  });
  revalidatePath(`/content/${str(formData, "contentId")}`);
  revalidatePath("/calendar");
}

export async function exportVariantAction(formData: FormData) {
  await recordContentExport(await userId(), str(formData, "variantId"));
  revalidatePath(`/content/${str(formData, "contentId")}`);
}
