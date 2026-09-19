import "server-only";

import type { ContentType, PlatformRuleSource, SocialPlatform } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";

const sourcePriority: Record<PlatformRuleSource, number> = {
  OFFICIAL_PLATFORM: 0,
  VERIFIED_INTERNAL_ANALYSIS: 1,
  BUSINESS_PERFORMANCE: 2,
  MANUAL_ADMIN_RULE: 3,
};

export type ActivePlatformRule = Awaited<ReturnType<typeof getActivePlatformRules>>[number];

export async function getActivePlatformRules(
  userId: string,
  businessId: string,
  options: { platforms?: SocialPlatform[]; contentTypes?: ContentType[]; asOf?: Date } = {},
) {
  await requireMembership(userId, businessId);
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { sector: true } });
  if (!business) return [];
  const asOf = options.asOf ?? new Date();
  const constraints = [
    { OR: [{ businessId }, { businessId: null }] },
    { OR: [{ expiresAt: null }, { expiresAt: { gte: asOf } }] },
    ...(options.contentTypes?.length ? [{ OR: [{ contentType: null }, { contentType: { in: options.contentTypes } }] }] : []),
  ];
  const rows = await prisma.platformRule.findMany({
    where: {
      active: true,
      effectiveFrom: { lte: asOf },
      AND: constraints,
      ...(options.platforms?.length ? { platform: { in: options.platforms } } : {}),
    },
  });
  const scoped = rows.filter((row) => !row.sectorScope.length || row.sectorScope.includes(business.sector.toUpperCase()));
  scoped.sort((left, right) =>
    sourcePriority[left.source] - sourcePriority[right.source] ||
    Number(Boolean(right.businessId)) - Number(Boolean(left.businessId)) ||
    right.reviewedAt.getTime() - left.reviewedAt.getTime(),
  );
  const selected = new Map<string, (typeof scoped)[number]>();
  for (const row of scoped) {
    const key = `${row.platform}:${row.contentType ?? "ALL"}:${row.ruleKey}`;
    if (!selected.has(key)) selected.set(key, row);
  }
  return [...selected.values()].sort((left, right) => left.platform.localeCompare(right.platform) || left.category.localeCompare(right.category));
}

export function rulesForItem(rules: ActivePlatformRule[], platform: SocialPlatform, contentType: ContentType) {
  return rules.filter((rule) => rule.platform === platform && (!rule.contentType || rule.contentType === contentType));
}
