import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";

export async function approveContentVariant(userId: string, variantId: string) {
  const variant = await prisma.contentVariant.findUnique({
    where: { id: variantId },
    include: { contentItem: true },
  });
  if (!variant) throw new DomainError("İçerik varyantı bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, variant.contentItem.businessId);

  return prisma.approval.upsert({
    where: {
      contentVariantId_approvedVersion: {
        contentVariantId: variantId,
        approvedVersion: variant.version,
      },
    },
    create: { contentVariantId: variantId, approvedVersion: variant.version, approvedById: userId },
    update: { approvedById: userId, approvedAt: new Date() },
  });
}

export async function isCurrentVersionApproved(variantId: string) {
  const variant = await prisma.contentVariant.findUnique({ where: { id: variantId } });
  if (!variant) return false;
  const approval = await prisma.approval.findUnique({
    where: {
      contentVariantId_approvedVersion: {
        contentVariantId: variantId,
        approvedVersion: variant.version,
      },
    },
  });
  return Boolean(approval);
}
