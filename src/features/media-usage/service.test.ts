import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createContent, recordContentExport, updateContentVariant } from "@/features/content/service";
import { getMediaUsageOverview, getMediaUsageSummary, recordMediaUsage, summarizeMediaUsage } from "@/features/media-usage/service";

async function fixture() {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `usage-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `usage-out-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: {
      name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul",
      memberships: { create: { userId: owner.id, role: "OWNER" } },
      goals: { create: [{ type: "RESERVATIONS", priority: "PRIMARY" }] },
    },
    include: { goals: true },
  });
  const otherBusiness = await prisma.business.create({ data: { name: "Other", sector: "HOTEL", memberships: { create: { userId: outsider.id, role: "OWNER" } } } });
  return { owner, outsider, business, otherBusiness, goalId: business.goals[0].id };
}

function mediaFixture(businessId: string, tags: string[] = ["PHOTO_PRODUCT"]) {
  return prisma.mediaAsset.create({
    data: { businessId, type: "IMAGE", originalFilename: "urun.jpg", mimeType: "image/jpeg", size: 10, width: 10, height: 10, storageKey: `${businessId}/${crypto.randomUUID()}.jpg`, tags },
  });
}

function contentFixture(userId: string, businessId: string, mediaAssetId: string | null, title = "Friday Steak") {
  return createContent(userId, businessId, { title, topic: "Reservation", contentType: "POST", platform: "INSTAGRAM", caption: "Caption", language: "tr", mediaAssetId: mediaAssetId ?? undefined });
}

async function planItemFixture(businessId: string, goalId: string, overrides: { mediaRequirement: string; mediaAssetId?: string; contentItemId?: string }) {
  const strategy = await prisma.contentStrategy.upsert({
    where: { businessId },
    create: { businessId, mode: "CUSTOM", platformSettings: [], contentMix: [], languages: ["tr"], rationale: "test", approvedAt: new Date() },
    update: {},
  });
  const plan = await prisma.contentPlan.create({
    data: {
      businessId, strategyId: strategy.id, period: "SEVEN_DAYS",
      startDate: new Date("2026-10-05T00:00:00.000Z"), endDate: new Date("2026-10-11T00:00:00.000Z"),
      timezone: "Europe/Istanbul", strategySummary: "test", strategySnapshot: {}, platformStrategies: {}, contentMix: {},
      provider: "test", model: "test", promptVersion: "test", inputHash: crypto.randomUUID(),
    },
  });
  return prisma.contentPlanItem.create({
    data: {
      planId: plan.id, goalId, platform: "INSTAGRAM", contentType: "POST",
      plannedDate: new Date("2026-10-09T00:00:00.000Z"), recommendedTime: "19:30",
      pillar: "PRODUCT", topic: "Ürün", concept: "Ürünü göster", hookCategory: "curiosity", hook: "Yeni",
      captionDirection: "Kısa", cta: "Rezervasyon yapın", language: "tr",
      mediaRequirement: overrides.mediaRequirement as never,
      mediaAvailability: (overrides.mediaAssetId ? "AVAILABLE" : "MISSING") as never,
      mediaAssetId: overrides.mediaAssetId ?? null,
      contentItemId: overrides.contentItemId ?? null,
      reasoning: "test", platformRulesApplied: [],
    },
  });
}

describe("Ainetra Phase 4 P4-02 — MediaUsage", () => {
  it("assignment alone does not record usage; export records one EXPORTED usage with the media angle", async () => {
    const { owner, business } = await fixture();
    const media = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const content = await contentFixture(owner.id, business.id, media.id);
    const variant = content.variants[0];
    expect(await prisma.mediaUsage.count({ where: { businessId: business.id } })).toBe(0);

    const exported = await recordContentExport(owner.id, variant.id);
    expect(exported.exportedVersion).toBe(1);
    const usages = await prisma.mediaUsage.findMany({ where: { businessId: business.id } });
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      mediaAssetId: media.id, contentVariantId: variant.id, platform: "INSTAGRAM", contentType: "POST", usageType: "EXPORTED", mediaRequirement: "PHOTO_PRODUCT",
    });
    expect(usages[0].usedAt.toISOString()).toBe(exported.exportedAt!.toISOString());
    // Dışa aktarım yayın değildir: hiçbir yayın durumu oluşmaz.
    expect(await prisma.scheduledPost.count({ where: { contentVariantId: variant.id } })).toBe(0);
    expect(await prisma.publishAttempt.count()).toBe(0);
  });

  it("re-exporting the same variant keeps one logical usage and preserves the first usedAt", async () => {
    const { owner, business } = await fixture();
    const media = await mediaFixture(business.id);
    const content = await contentFixture(owner.id, business.id, media.id);
    const variant = content.variants[0];
    await recordContentExport(owner.id, variant.id);
    const first = await prisma.mediaUsage.findFirstOrThrow({ where: { contentVariantId: variant.id } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordContentExport(owner.id, variant.id);
    const usages = await prisma.mediaUsage.findMany({ where: { contentVariantId: variant.id } });
    expect(usages).toHaveLength(1);
    expect(usages[0].id).toBe(first.id);
    expect(usages[0].usedAt.toISOString()).toBe(first.usedAt.toISOString());
  });

  it("export without media records nothing; a later media change and export records the new media", async () => {
    const { owner, business } = await fixture();
    const content = await contentFixture(owner.id, business.id, null);
    const variant = content.variants[0];
    await recordContentExport(owner.id, variant.id);
    expect(await prisma.mediaUsage.count({ where: { contentVariantId: variant.id } })).toBe(0);

    const media = await mediaFixture(business.id);
    await updateContentVariant(owner.id, variant.id, { caption: "Caption", cta: null, language: "tr", mediaAssetId: media.id, aspectRatio: null });
    expect(await prisma.mediaUsage.count({ where: { contentVariantId: variant.id } })).toBe(0);
    await recordContentExport(owner.id, variant.id);
    const usages = await prisma.mediaUsage.findMany({ where: { contentVariantId: variant.id } });
    expect(usages).toHaveLength(1);
    expect(usages[0].mediaAssetId).toBe(media.id);
  });

  it("concurrent duplicate exports create exactly one logical usage and all succeed", async () => {
    const { owner, business } = await fixture();
    const media = await mediaFixture(business.id);
    const content = await contentFixture(owner.id, business.id, media.id);
    const variant = content.variants[0];
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => recordContentExport(owner.id, variant.id)));
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await prisma.mediaUsage.count({ where: { contentVariantId: variant.id } })).toBe(1);
  });

  it("concurrent direct recordMediaUsage calls converge on one row and return the same usage", async () => {
    const { owner, business } = await fixture();
    const media = await mediaFixture(business.id);
    const content = await contentFixture(owner.id, business.id, media.id);
    const variant = content.variants[0];
    const input = { businessId: business.id, mediaAssetId: media.id, contentVariantId: variant.id, usageType: "EXPORTED" as const };
    const recorded = await Promise.all(Array.from({ length: 4 }, () => prisma.$transaction((tx) => recordMediaUsage(tx, input))));
    expect(new Set(recorded.map((usage) => usage.id)).size).toBe(1);
    expect(await prisma.mediaUsage.count({ where: { contentVariantId: variant.id } })).toBe(1);
  });

  it("rejects cross-business media/content combinations without writing anything", async () => {
    const { owner, outsider, business, otherBusiness } = await fixture();
    const ownMedia = await mediaFixture(business.id);
    const foreignMedia = await mediaFixture(otherBusiness.id);
    const ownContent = await contentFixture(owner.id, business.id, ownMedia.id);
    const foreignContent = await contentFixture(outsider.id, otherBusiness.id, foreignMedia.id);

    await expect(prisma.$transaction((tx) => recordMediaUsage(tx, { businessId: business.id, mediaAssetId: foreignMedia.id, contentVariantId: ownContent.variants[0].id, usageType: "EXPORTED" })))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prisma.$transaction((tx) => recordMediaUsage(tx, { businessId: business.id, mediaAssetId: ownMedia.id, contentVariantId: foreignContent.variants[0].id, usageType: "EXPORTED" })))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prisma.$transaction((tx) => recordMediaUsage(tx, { businessId: otherBusiness.id, mediaAssetId: ownMedia.id, contentVariantId: ownContent.variants[0].id, usageType: "EXPORTED" })))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.mediaUsage.count()).toBe(0);
  });

  it("never-used, last-used, and count queries are deterministic and tenant isolated", async () => {
    const { owner, outsider, business, otherBusiness } = await fixture();
    const usedTwice = await mediaFixture(business.id);
    const neverUsed = await mediaFixture(business.id);
    const foreignMedia = await mediaFixture(otherBusiness.id);
    const contentA = await contentFixture(owner.id, business.id, usedTwice.id, "Content A");
    const contentB = await contentFixture(owner.id, business.id, usedTwice.id, "Content B");
    const foreignContent = await contentFixture(outsider.id, otherBusiness.id, foreignMedia.id);

    const older = new Date("2026-09-01T10:00:00.000Z");
    const newer = new Date("2026-09-15T10:00:00.000Z");
    await prisma.$transaction((tx) => recordMediaUsage(tx, { businessId: business.id, mediaAssetId: usedTwice.id, contentVariantId: contentA.variants[0].id, usageType: "EXPORTED", usedAt: newer }));
    await prisma.$transaction((tx) => recordMediaUsage(tx, { businessId: business.id, mediaAssetId: usedTwice.id, contentVariantId: contentB.variants[0].id, usageType: "EXPORTED", usedAt: older }));
    await prisma.$transaction((tx) => recordMediaUsage(tx, { businessId: otherBusiness.id, mediaAssetId: foreignMedia.id, contentVariantId: foreignContent.variants[0].id, usageType: "EXPORTED" }));

    const summary = await summarizeMediaUsage(business.id);
    expect([...summary.keys()].sort()).toEqual([usedTwice.id, neverUsed.id].sort());
    expect(summary.get(usedTwice.id)).toEqual({ mediaAssetId: usedTwice.id, usageCount: 2, lastUsedAt: newer, neverUsed: false });
    expect(summary.get(neverUsed.id)).toEqual({ mediaAssetId: neverUsed.id, usageCount: 0, lastUsedAt: null, neverUsed: true });
    expect(summary.has(foreignMedia.id)).toBe(false);

    // Başka işletmenin medyası açıkça istense bile sonuçta yer almaz.
    expect((await summarizeMediaUsage(business.id, [foreignMedia.id])).size).toBe(0);
    expect(await getMediaUsageSummary(business.id, foreignMedia.id)).toBeNull();
    expect(await getMediaUsageSummary(otherBusiness.id, foreignMedia.id)).toMatchObject({ usageCount: 1, neverUsed: false });

    await expect(getMediaUsageOverview(outsider.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getMediaUsageOverview(owner.id, business.id, [usedTwice.id])).get(usedTwice.id)?.usageCount).toBe(2);
  });

  it("derives the usage angle from the linked ACTIVE plan item, else a single planning tag, else null", async () => {
    const { owner, business, goalId } = await fixture();
    const multiTagMedia = await mediaFixture(business.id, ["PHOTO_PRODUCT", "PHOTO_ATMOSPHERE"]);
    const linked = await contentFixture(owner.id, business.id, multiTagMedia.id, "Linked");
    await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_ATMOSPHERE", mediaAssetId: multiTagMedia.id, contentItemId: linked.id });
    await recordContentExport(owner.id, linked.variants[0].id);
    expect((await prisma.mediaUsage.findFirstOrThrow({ where: { contentVariantId: linked.variants[0].id } })).mediaRequirement).toBe("PHOTO_ATMOSPHERE");

    const unlinked = await contentFixture(owner.id, business.id, multiTagMedia.id, "Unlinked");
    await recordContentExport(owner.id, unlinked.variants[0].id);
    expect((await prisma.mediaUsage.findFirstOrThrow({ where: { contentVariantId: unlinked.variants[0].id } })).mediaRequirement).toBeNull();
  });
});
