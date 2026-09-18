import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";
import { brandInputSchema, businessInputSchema } from "./schemas";

export async function createBusiness(userId: string, input: unknown) {
  const data = businessInputSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        ...data,
        location: data.location || null,
        website: data.website || null,
        instagramHandle: data.instagramHandle || null,
      },
    });
    await tx.membership.create({
      data: { userId, businessId: business.id, role: "OWNER" },
    });
    await tx.brandProfile.create({ data: { businessId: business.id } });
    return business;
  });
}

export async function updateBusiness(userId: string, businessId: string, input: unknown) {
  await requireMembership(userId, businessId);
  const data = businessInputSchema.parse(input);
  return prisma.business.update({
    where: { id: businessId },
    data: {
      ...data,
      location: data.location || null,
      website: data.website || null,
      instagramHandle: data.instagramHandle || null,
    },
  });
}

export async function updateBrandProfile(userId: string, businessId: string, input: unknown) {
  await requireMembership(userId, businessId);
  const data = brandInputSchema.parse(input);
  return prisma.brandProfile.upsert({
    where: { businessId },
    create: { businessId, ...data },
    update: data,
  });
}
