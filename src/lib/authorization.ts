import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";

export async function requireMembership(userId: string, businessId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
  });
  if (!membership) throw new DomainError("Bu işletme için yetkiniz yok.", "FORBIDDEN");
  return membership;
}

export async function getFirstBusinessForUser(userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId },
    include: { business: true },
    orderBy: { createdAt: "asc" },
  });
  return membership?.business ?? null;
}
