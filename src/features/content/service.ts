import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { contentInputSchema, variantUpdateSchema } from "./schemas";

async function assertMediaBelongsToBusiness(mediaAssetId: string | null | undefined, businessId: string) {
  if (!mediaAssetId) return;
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!media || media.businessId !== businessId) {
    throw new DomainError("Medya bu işletmeye ait değil.", "FORBIDDEN");
  }
}

export async function createContent(userId: string, businessId: string, input: unknown) {
  await requireMembership(userId, businessId);
  const data = contentInputSchema.parse(input);
  await assertMediaBelongsToBusiness(data.mediaAssetId, businessId);
  if (data.goalId) {
    const goal = await prisma.businessGoal.findUnique({ where: { id: data.goalId } });
    if (!goal || goal.businessId !== businessId) {
      throw new DomainError("Hedef bu işletmeye ait değil.", "FORBIDDEN");
    }
  }

  return prisma.contentItem.create({
    data: {
      businessId,
      goalId: data.goalId || null,
      title: data.title,
      topic: data.topic,
      contentType: data.contentType,
      variants: {
        create: {
          platform: data.platform,
          caption: data.caption,
          cta: data.cta || null,
          language: data.language,
          mediaAssetId: data.mediaAssetId || null,
          aspectRatio: data.aspectRatio || null,
        },
      },
    },
    include: { variants: true },
  });
}

export async function updateContentVariant(userId: string, variantId: string, input: unknown) {
  const data = variantUpdateSchema.parse(input);
  const existing = await prisma.contentVariant.findUnique({
    where: { id: variantId },
    include: { contentItem: true },
  });
  if (!existing) throw new DomainError("İçerik varyantı bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, existing.contentItem.businessId);
  await assertMediaBelongsToBusiness(data.mediaAssetId, existing.contentItem.businessId);

  const changed =
    existing.caption !== data.caption ||
    (existing.cta ?? null) !== (data.cta || null) ||
    existing.language !== data.language ||
    (existing.mediaAssetId ?? null) !== (data.mediaAssetId || null) ||
    (existing.aspectRatio ?? null) !== (data.aspectRatio || null);

  if (!changed) return existing;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.contentVariant.update({
      where: { id: variantId, version: existing.version },
      data: {
        caption: data.caption,
        cta: data.cta || null,
        language: data.language,
        mediaAssetId: data.mediaAssetId || null,
        aspectRatio: data.aspectRatio || null,
        version: { increment: 1 },
      },
    });
    await tx.scheduledPost.updateMany({
      where: { contentVariantId: variantId, status: "SCHEDULED" },
      data: { status: "INVALIDATED", invalidatedAt: new Date() },
    });
    return updated;
  }, { isolationLevel: "Serializable" });
}

export async function recordContentExport(userId: string, variantId: string) {
  const variant = await prisma.contentVariant.findUnique({
    where: { id: variantId },
    include: { contentItem: true },
  });
  if (!variant) throw new DomainError("İçerik varyantı bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, variant.contentItem.businessId);
  return prisma.contentVariant.update({
    where: { id: variantId },
    data: { exportedAt: new Date(), exportedVersion: variant.version },
  });
}

export function deriveWorkflowLabel(input: {
  version: number;
  approvals: { approvedVersion: number }[];
  scheduledPosts: { contentVersion: number; status: string }[];
}) {
  if (input.scheduledPosts.some((post) => post.status === "SCHEDULED" && post.contentVersion === input.version)) {
    return "SCHEDULED";
  }
  if (input.approvals.some((approval) => approval.approvedVersion === input.version)) return "APPROVED";
  return "DRAFT";
}
