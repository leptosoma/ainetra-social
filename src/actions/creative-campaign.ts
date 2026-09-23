"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { createCreativeCampaign, discardCreativeCampaign, keepCreativeCampaign } from "@/features/creative-campaign/service";
import { DomainError } from "@/lib/domain-error";

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

function revalidateCreative() {
  revalidatePath("/creative");
  revalidatePath("/media");
}

/**
 * Format seçimi tek bir radyo düğmesiyle yapıldığı için platform ve format `PLATFORM:FORMAT`
 * biçiminde birlikte gelir. Ayrı alanlar gönderildiğinde de çalışır; çözümlenemeyen bir hedef
 * serviste doğrulanır ve kreatif hazırlanmaz.
 */
function readTarget(formData: FormData): { platform: string; format: string } {
  const combined = String(formData.get("target") ?? "");
  if (combined.includes(":")) {
    const [platform, format] = combined.split(":", 2);
    return { platform, format };
  }
  return { platform: String(formData.get("platform") ?? ""), format: String(formData.get("format") ?? "") };
}

export async function createCreativeCampaignAction(formData: FormData) {
  const currentUserId = await userId();
  const sourceAssetId = String(formData.get("sourceAssetId") ?? "");
  const target = readTarget(formData);
  let notice = "creative-error";
  try {
    const campaign = await createCreativeCampaign(
      currentUserId,
      String(formData.get("businessId") ?? ""),
      String(formData.get("category") ?? ""),
      target.platform,
      target.format,
      { sourceAssetId: sourceAssetId || null },
    );
    notice = campaign?.status === "SUCCEEDED"
      ? "creative-ready"
      : campaign?.status === "INVALID_OUTPUT"
        ? "creative-invalid"
        : campaign?.status === "PENDING"
          ? "creative-pending"
          : "creative-failed";
  } catch (error) {
    // Eksik onaylı bilgi de buraya düşer: kullanıcıya kreatifin neden hazırlanmadığı söylenir.
    notice = error instanceof DomainError && error.code === "VALIDATION_ERROR" ? "creative-missing-facts" : "creative-error";
  }
  revalidateCreative();
  redirect(`/creative?notice=${notice}`);
}

export async function keepCreativeCampaignAction(formData: FormData) {
  const currentUserId = await userId();
  let notice = "creative-error";
  try {
    await keepCreativeCampaign(currentUserId, String(formData.get("campaignId") ?? ""));
    notice = "creative-kept";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "CONFLICT" ? "creative-decided" : "creative-error";
  }
  revalidateCreative();
  redirect(`/creative?notice=${notice}`);
}

export async function discardCreativeCampaignAction(formData: FormData) {
  const currentUserId = await userId();
  let notice = "creative-error";
  try {
    await discardCreativeCampaign(currentUserId, String(formData.get("campaignId") ?? ""));
    notice = "creative-discarded";
  } catch (error) {
    notice = error instanceof DomainError && error.code === "CONFLICT" ? "creative-decided" : "creative-error";
  }
  revalidateCreative();
  redirect(`/creative?notice=${notice}`);
}
