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

export async function uploadMedia(userId: string, businessId: string, file: File) {
  await requireMembership(userId, businessId);
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
      },
    });
  } catch (error) {
    await storage.delete(storageKey);
    throw error;
  }
}

export async function deleteMedia(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  const usageCount = await prisma.contentVariant.count({ where: { mediaAssetId } });
  if (usageCount) {
    throw new DomainError("İçerikte kullanılan medya silinemez.", "CONFLICT");
  }
  await prisma.mediaAsset.delete({ where: { id: mediaAssetId } });
  await storage.delete(asset.storageKey);
}
