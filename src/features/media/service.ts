import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";

const allowedMimeTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export const imagePlanningTags = ["PHOTO_PRODUCT", "PHOTO_ATMOSPHERE", "PHOTO_PEOPLE", "CUSTOM_GRAPHIC"] as const;

function validatePlanningTags(tags: string[]) {
  if (tags.length > imagePlanningTags.length || new Set(tags).size !== tags.length || tags.some((tag) => !(imagePlanningTags as readonly string[]).includes(tag))) {
    throw new DomainError("Medya etiketleri geçersiz.", "VALIDATION_ERROR");
  }
  return tags;
}

export async function uploadMedia(userId: string, businessId: string, file: File, rawTags: string[] = []) {
  await requireMembership(userId, businessId);
  const tags = validatePlanningTags(rawTags);
  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024);
  const extension = allowedMimeTypes.get(file.type);
  if (!extension) {
    throw new DomainError("Yalnızca JPEG, PNG ve WebP görseller desteklenir.", "VALIDATION_ERROR");
  }
  if (file.size < 1 || file.size > maxBytes) {
    throw new DomainError(`Dosya en fazla ${Math.floor(maxBytes / 1024 / 1024)} MB olabilir.`, "VALIDATION_ERROR");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
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

  const storageKey = `${businessId}/${randomUUID()}.${extension}`;
  await storage.put({ key: storageKey, bytes, contentType: file.type });
  try {
    return await prisma.mediaAsset.create({
      data: {
        businessId,
        type: "IMAGE",
        originalFilename: file.name.slice(0, 255),
        mimeType: file.type,
        size: file.size,
        width: metadata.width,
        height: metadata.height,
        storageKey,
        tags,
      },
    });
  } catch (error) {
    await storage.delete(storageKey);
    throw error;
  }
}

export async function updateMediaPlanningTags(userId: string, mediaAssetId: string, rawTags: string[]) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  if (asset.type !== "IMAGE") throw new DomainError("Bu medya türü için görsel etiketi kullanılamaz.", "VALIDATION_ERROR");
  const tags = validatePlanningTags(rawTags);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.mediaAsset.update({ where: { id: asset.id }, data: { tags } });
    await tx.contentPlanItem.updateMany({
      where: { mediaAssetId: asset.id, mediaRequirement: { notIn: tags as typeof imagePlanningTags[number][] } },
      data: { mediaAssetId: null, mediaAvailability: "MISSING" },
    });
    for (const tag of tags) {
      await tx.contentPlanItem.updateMany({
        where: { plan: { businessId: asset.businessId }, mediaAssetId: null, mediaRequirement: tag as typeof imagePlanningTags[number], mediaAvailability: "MISSING", status: "ACTIVE" },
        data: { mediaAssetId: asset.id, mediaAvailability: "AVAILABLE" },
      });
    }
    return updated;
  });
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
    await tx.mediaAsset.delete({ where: { id: mediaAssetId } });
  });
  await storage.delete(asset.storageKey);
}
