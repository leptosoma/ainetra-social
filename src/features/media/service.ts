import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { fulfillCaptureRequestsForItems, reopenCaptureRequestsForRemovedMedia } from "@/features/capture-engine/service";

const allowedImageMimeTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const allowedVideoMimeTypes = new Map([
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
]);

export const imagePlanningTags = ["PHOTO_PRODUCT", "PHOTO_ATMOSPHERE", "PHOTO_PEOPLE", "CUSTOM_GRAPHIC"] as const;
export const videoPlanningTags = ["VIDEO_VERTICAL", "VIDEO_KITCHEN"] as const;
type PlanningTag = typeof imagePlanningTags[number] | typeof videoPlanningTags[number];

function validatePlanningTags(tags: string[], allowed: readonly string[]) {
  if (tags.length > allowed.length || new Set(tags).size !== tags.length || tags.some((tag) => !allowed.includes(tag))) {
    throw new DomainError("Medya etiketleri geçersiz.", "VALIDATION_ERROR");
  }
  return tags;
}

/**
 * P5-04: kasıtlı olarak tasarlanmış bir kreatif, gerçek fotoğraf/video kanıtı isteyen bir planlama
 * ihtiyacını karşılayamaz. Bu sınır etiket düzeyinde uygulanır: tasarım çıktısı yalnızca
 * CUSTOM_GRAPHIC etiketi alabilir, bu yüzden PHOTO_* / VIDEO_* gereksinimlerine hiçbir zaman
 * eşleşmez (Content Stock, Capture ve Fallback aynı etiketleri okur).
 *
 * Teknik format türevleri (SOCIAL_VARIANT) bu kısıtın dışındadır: kaynağı kadar özgündürler.
 */
export function allowedPlanningTagsFor(asset: { type: string; origin: string }): readonly string[] {
  if (asset.origin === "CREATIVE_CAMPAIGN") return ["CUSTOM_GRAPHIC"];
  return asset.type === "IMAGE" ? imagePlanningTags : videoPlanningTags;
}

// Basit dosya imzası (magic bytes) kontrolü: beyan edilen MIME türüne güvenmek yerine
// dosya içeriğinin gerçekten o konteyner formatında olduğunu doğrular. ffprobe/codec
// düzeyinde bir doğrulama değildir; amaç yanlış etiketlenmiş/rastgele dosyaları elemektir.
function isValidVideoSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "video/webm") {
    return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  // MP4 / QuickTime (MOV): ISO Base Media File Format kutuları 4. bayttan itibaren "ftyp" ile başlar.
  return bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

export async function uploadMedia(userId: string, businessId: string, file: File, rawTags: string[] = []) {
  await requireMembership(userId, businessId);
  const imageExtension = allowedImageMimeTypes.get(file.type);
  const videoExtension = allowedVideoMimeTypes.get(file.type);
  if (!imageExtension && !videoExtension) {
    throw new DomainError("Yalnızca JPEG, PNG, WebP görseller veya MP4, MOV, WebM videolar desteklenir.", "VALIDATION_ERROR");
  }
  const mediaType: "IMAGE" | "VIDEO" = imageExtension ? "IMAGE" : "VIDEO";
  const extension = imageExtension ?? videoExtension!;
  const tags = validatePlanningTags(rawTags, mediaType === "IMAGE" ? imagePlanningTags : videoPlanningTags);
  const maxBytes = mediaType === "IMAGE"
    ? Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024)
    : Number(process.env.MAX_VIDEO_UPLOAD_BYTES ?? 80 * 1024 * 1024);
  if (file.size < 1 || file.size > maxBytes) {
    throw new DomainError(`Dosya en fazla ${Math.floor(maxBytes / 1024 / 1024)} MB olabilir.`, "VALIDATION_ERROR");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let width: number | null = null;
  let height: number | null = null;
  if (mediaType === "IMAGE") {
    let metadata: Metadata;
    try {
      metadata = await sharp(bytes).metadata();
    } catch {
      throw new DomainError("Dosya geçerli bir görsel değil.", "VALIDATION_ERROR");
    }
    const formatMatchesMime =
      (file.type === "image/jpeg" && metadata.format === "jpeg") ||
      (file.type === "image/png" && metadata.format === "png") ||
      (file.type === "image/webp" && metadata.format === "webp");
    if (!formatMatchesMime || !metadata.width || !metadata.height) {
      throw new DomainError("Dosya içeriği ile MIME türü uyuşmuyor.", "VALIDATION_ERROR");
    }
    width = metadata.width;
    height = metadata.height;
  } else if (!isValidVideoSignature(bytes, file.type)) {
    throw new DomainError("Dosya içeriği ile MIME türü uyuşmuyor.", "VALIDATION_ERROR");
  }

  const storageKey = `${businessId}/${randomUUID()}.${extension}`;
  await storage.put({ key: storageKey, bytes, contentType: file.type });
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({
        data: {
          businessId,
          type: mediaType,
          originalFilename: file.name.slice(0, 255),
          mimeType: file.type,
          size: file.size,
          width,
          height,
          storageKey,
          tags,
        },
      });
      if (tags.length) {
        const matches = await tx.contentPlanItem.findMany({
          where: { plan: { businessId }, mediaAssetId: null, mediaAvailability: "MISSING", status: "ACTIVE", mediaRequirement: { in: tags as PlanningTag[] } },
          select: { id: true },
        });
        if (matches.length) {
          await tx.contentPlanItem.updateMany({ where: { id: { in: matches.map((match) => match.id) } }, data: { mediaAssetId: created.id, mediaAvailability: "AVAILABLE" } });
          await fulfillCaptureRequestsForItems(tx, matches.map((match) => match.id), created.id);
        }
      }
      return created;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    await storage.delete(storageKey);
    throw error;
  }
}

export async function updateMediaPlanningTags(userId: string, mediaAssetId: string, rawTags: string[]) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  if (asset.origin === "CREATIVE_CAMPAIGN" && rawTags.some((tag) => tag !== "CUSTOM_GRAPHIC")) {
    throw new DomainError("Tasarım kreatifi yalnızca özel tasarım ihtiyacı için işaretlenebilir; gerçek fotoğraf gerektiren bir ihtiyacı karşılayamaz.", "VALIDATION_ERROR");
  }
  const tags = validatePlanningTags(rawTags, allowedPlanningTagsFor(asset));
  return prisma.$transaction(async (tx) => {
    const updated = await tx.mediaAsset.update({ where: { id: asset.id }, data: { tags } });
    await tx.contentPlanItem.updateMany({
      where: { mediaAssetId: asset.id, mediaRequirement: { notIn: tags as PlanningTag[] } },
      data: { mediaAssetId: null, mediaAvailability: "MISSING" },
    });
    await reopenCaptureRequestsForRemovedMedia(tx, asset.id);
    for (const tag of tags) {
      const matches = await tx.contentPlanItem.findMany({
        where: { plan: { businessId: asset.businessId }, mediaAssetId: null, mediaRequirement: tag as PlanningTag, mediaAvailability: "MISSING", status: "ACTIVE" },
        select: { id: true },
      });
      if (!matches.length) continue;
      await tx.contentPlanItem.updateMany({ where: { id: { in: matches.map((match) => match.id) } }, data: { mediaAssetId: asset.id, mediaAvailability: "AVAILABLE" } });
      await fulfillCaptureRequestsForItems(tx, matches.map((match) => match.id), asset.id);
    }
    return updated;
  }, { isolationLevel: "Serializable" });
}

export async function deleteMedia(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  const usageCount = await prisma.contentVariant.count({ where: { mediaAssetId } });
  if (usageCount) {
    throw new DomainError("İçerikte kullanılan medya silinemez.", "CONFLICT");
  }
  await prisma.$transaction(async (tx) => {
    await tx.contentPlanItem.updateMany({ where: { mediaAssetId }, data: { mediaAssetId: null, mediaAvailability: "MISSING" } });
    await reopenCaptureRequestsForRemovedMedia(tx, mediaAssetId);
    await tx.mediaAsset.delete({ where: { id: mediaAssetId } });
  }, { isolationLevel: "Serializable" });
  await storage.delete(asset.storageKey);
}
