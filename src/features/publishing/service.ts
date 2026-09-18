import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";

const scheduleSchema = z.object({
  socialAccountId: z.string().min(1),
  scheduledAt: z.coerce.date(),
  expectedVersion: z.number().int().positive().optional(),
});

export async function scheduleContentVariant(
  userId: string,
  variantId: string,
  input: unknown,
  now = new Date(),
) {
  const data = scheduleSchema.parse(input);
  const variant = await prisma.contentVariant.findUnique({
    where: { id: variantId },
    include: { contentItem: true },
  });
  if (!variant) throw new DomainError("İçerik varyantı bulunamadı.", "NOT_FOUND");
  const businessId = variant.contentItem.businessId;
  await requireMembership(userId, businessId);

  if (data.scheduledAt.getTime() <= now.getTime()) {
    throw new DomainError("Planlama tarihi gelecekte olmalıdır.", "VALIDATION_ERROR");
  }

  return prisma.$transaction(async (tx) => {
    const freshVariant = await tx.contentVariant.findUnique({
      where: { id: variantId },
      include: { contentItem: true },
    });
    if (!freshVariant || freshVariant.contentItem.businessId !== businessId) {
      throw new DomainError("İçerik varyantı değişti veya bulunamadı.", "CONFLICT");
    }
    if (data.expectedVersion && data.expectedVersion !== freshVariant.version) {
      throw new DomainError("İçerik sürümü değişti; yeniden onaylayın.", "CONFLICT");
    }
    const account = await tx.socialAccount.findUnique({ where: { id: data.socialAccountId } });
    if (!account || account.businessId !== businessId) {
      throw new DomainError("Sosyal hesap bu işletmeye ait değil.", "FORBIDDEN");
    }
    const approval = await tx.approval.findUnique({
      where: {
        contentVariantId_approvedVersion: {
          contentVariantId: freshVariant.id,
          approvedVersion: freshVariant.version,
        },
      },
    });
    if (!approval) {
      throw new DomainError("Yalnızca güncel sürümü onaylanmış içerik planlanabilir.", "VALIDATION_ERROR");
    }
    return tx.scheduledPost.create({
      data: {
        businessId,
        socialAccountId: account.id,
        contentVariantId: freshVariant.id,
        contentVersion: freshVariant.version,
        scheduledAt: data.scheduledAt,
      },
    });
  }, { isolationLevel: "Serializable" });
}

export async function isScheduledPostPublishable(scheduledPostId: string) {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: scheduledPostId },
    include: { contentVariant: { include: { approvals: true } } },
  });
  if (!post || post.status !== "SCHEDULED") return false;
  if (post.contentVersion !== post.contentVariant.version) return false;
  return post.contentVariant.approvals.some(
    (approval) => approval.approvedVersion === post.contentVariant.version,
  );
}
