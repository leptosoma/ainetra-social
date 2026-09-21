import "server-only";

import type { Prisma } from "../../../generated/prisma/client";
import { MediaRequirement, type MediaUsageType, type SocialPlatform } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { requireMembership } from "@/lib/authorization";

// Phase 4 P4-02 kapsamı: yalnızca MediaUsage kaydı ve sorguları.
// Content Stock ve Fallback Engine bu modülün üzerine sonraki görevlerde kurulur.
//
// Kural: bir medyanın plan öğesine/varyanta ATANMASI kullanım değildir. Kullanım yalnızca
// gerçek bir yaşam döngüsü sınırında (bugün: içerik dışa aktarımı) kaydedilir ve
// usageType ile hangi sınır olduğu açıkça belirtilir. EXPORTED, yayınlandı demek değildir.

export type RecordMediaUsageInput = {
  businessId: string;
  mediaAssetId: string;
  contentVariantId: string;
  usageType: MediaUsageType;
  usedAt?: Date;
};

export type MediaUsageSummary = {
  mediaAssetId: string;
  usageCount: number;
  lastUsedAt: Date | null;
  neverUsed: boolean;
};

/**
 * Kullanım açısını (mediaRequirement) belirler: önce içeriğe bağlı ACTIVE plan öğesi
 * (aynı platform; mümkünse bu medyayı taşıyan), yoksa medyanın tek planlama etiketi.
 * Belirsizse null bırakılır; asla uydurulmaz.
 */
async function resolveMediaRequirement(
  tx: Prisma.TransactionClient,
  variant: { contentItemId: string; platform: SocialPlatform },
  media: { id: string; tags: string[] },
): Promise<MediaRequirement | null> {
  const baseWhere = { contentItemId: variant.contentItemId, platform: variant.platform, status: "ACTIVE" as const };
  const orderBy = [{ createdAt: "asc" as const }, { id: "asc" as const }];
  const planItem =
    (await tx.contentPlanItem.findFirst({ where: { ...baseWhere, mediaAssetId: media.id }, orderBy, select: { mediaRequirement: true } })) ??
    (await tx.contentPlanItem.findFirst({ where: baseWhere, orderBy, select: { mediaRequirement: true } }));
  if (planItem && planItem.mediaRequirement !== "NO_NEW_MEDIA_REQUIRED") return planItem.mediaRequirement;
  const knownTags = media.tags.filter((tag): tag is MediaRequirement => tag in MediaRequirement && tag !== "NO_NEW_MEDIA_REQUIRED");
  return knownTags.length === 1 ? knownTags[0] : null;
}

/**
 * Gerçek bir kullanımı kaydeder. Var olan tx içinde, yaşam döngüsü sınırından çağrılmalıdır.
 * Kiracı doğrulaması: medya ve varyantın işletmesi verilen businessId ile aynı olmalıdır.
 * Idempotent: (contentVariantId, mediaAssetId, usageType) DB unique anahtarıdır; eşzamanlı
 * yarışta createMany+skipDuplicates (ON CONFLICT DO NOTHING) tx'i bozmadan tek satır bırakır
 * ve ilk kaydın usedAt değeri korunur.
 */
export async function recordMediaUsage(tx: Prisma.TransactionClient, input: RecordMediaUsageInput) {
  const media = await tx.mediaAsset.findUnique({ where: { id: input.mediaAssetId }, select: { id: true, businessId: true, tags: true } });
  if (!media || media.businessId !== input.businessId) {
    throw new DomainError("Medya bu işletmeye ait değil.", "FORBIDDEN");
  }
  const variant = await tx.contentVariant.findUnique({
    where: { id: input.contentVariantId },
    select: { id: true, contentItemId: true, platform: true, contentItem: { select: { businessId: true, contentType: true } } },
  });
  if (!variant || variant.contentItem.businessId !== input.businessId) {
    throw new DomainError("İçerik varyantı bu işletmeye ait değil.", "FORBIDDEN");
  }

  const mediaRequirement = await resolveMediaRequirement(tx, variant, media);
  await tx.mediaUsage.createMany({
    data: {
      businessId: input.businessId,
      mediaAssetId: media.id,
      contentVariantId: variant.id,
      platform: variant.platform,
      contentType: variant.contentItem.contentType,
      usageType: input.usageType,
      mediaRequirement,
      usedAt: input.usedAt ?? new Date(),
    },
    skipDuplicates: true,
  });
  return tx.mediaUsage.findUniqueOrThrow({
    where: { contentVariantId_mediaAssetId_usageType: { contentVariantId: variant.id, mediaAssetId: media.id, usageType: input.usageType } },
  });
}

/**
 * İşletmeye ait medyalar için deterministik kullanım özeti (hiç kullanılmadı / son kullanım /
 * kullanım sayısı). Yalnızca bu işletmeye ait medyalar döner; başka işletmenin medyası
 * sonuçta yer almaz. mediaAssetIds verilmezse işletmenin tüm medyaları özetlenir.
 * Sunucu içi bileşim içindir; çağıran taraf yetkilendirmeyi yapmış olmalıdır.
 */
export async function summarizeMediaUsage(businessId: string, mediaAssetIds?: string[]): Promise<Map<string, MediaUsageSummary>> {
  const assets = await prisma.mediaAsset.findMany({
    where: { businessId, ...(mediaAssetIds ? { id: { in: mediaAssetIds } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const summary = new Map<string, MediaUsageSummary>();
  if (!assets.length) return summary;

  const groups = await prisma.mediaUsage.groupBy({
    by: ["mediaAssetId"],
    where: { businessId, mediaAssetId: { in: assets.map((asset) => asset.id) } },
    _count: { _all: true },
    _max: { usedAt: true },
  });
  const byAsset = new Map(groups.map((group) => [group.mediaAssetId, group]));
  for (const asset of assets) {
    const group = byAsset.get(asset.id);
    const usageCount = group?._count._all ?? 0;
    summary.set(asset.id, { mediaAssetId: asset.id, usageCount, lastUsedAt: group?._max.usedAt ?? null, neverUsed: usageCount === 0 });
  }
  return summary;
}

/** Tek medya için özet; medya bu işletmeye ait değilse null döner. */
export async function getMediaUsageSummary(businessId: string, mediaAssetId: string): Promise<MediaUsageSummary | null> {
  const summary = await summarizeMediaUsage(businessId, [mediaAssetId]);
  return summary.get(mediaAssetId) ?? null;
}

/** Üyelik denetimli giriş noktası (UI/aksiyon katmanı için). */
export async function getMediaUsageOverview(userId: string, businessId: string, mediaAssetIds?: string[]) {
  await requireMembership(userId, businessId);
  return summarizeMediaUsage(businessId, mediaAssetIds);
}
