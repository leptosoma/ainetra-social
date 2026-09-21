import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createContent } from "@/features/content/service";
import { recordMediaUsage } from "@/features/media-usage/service";
import { buildContentStockReport, calculateContentStock, getContentStock } from "@/features/content-stock/service";

// Sabit "şimdi": İstanbul'da 5 Ekim 2026. Plan öğeleri 6–14 Ekim'e konur (30 günlük pencere içinde).
const now = new Date("2026-10-05T10:00:00.000Z");
const day = (n: number) => new Date(`2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`);

async function fixture() {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `stock-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `stock-out-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: {
      name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul",
      memberships: { create: { userId: owner.id, role: "OWNER" } },
      goals: { create: [{ type: "RESERVATIONS", priority: "PRIMARY" }] },
    },
    include: { goals: true },
  });
  const otherBusiness = await prisma.business.create({
    data: { name: "Other", sector: "HOTEL", timezone: "Europe/Istanbul", memberships: { create: { userId: outsider.id, role: "OWNER" } }, goals: { create: [{ type: "RESERVATIONS", priority: "PRIMARY" }] } },
    include: { goals: true },
  });
  return { owner, outsider, business, otherBusiness, goalId: business.goals[0].id, otherGoalId: otherBusiness.goals[0].id };
}

function mediaFixture(businessId: string, tags: string[], type: "IMAGE" | "VIDEO" = "IMAGE", createdAt?: Date) {
  return prisma.mediaAsset.create({
    data: { businessId, type, originalFilename: type === "VIDEO" ? "klip.mp4" : "urun.jpg", mimeType: type === "VIDEO" ? "video/mp4" : "image/jpeg", size: 10, width: 10, height: 10, storageKey: `${businessId}/${crypto.randomUUID()}`, tags, ...(createdAt ? { createdAt } : {}) },
  });
}

async function planFixture(businessId: string, status: "DRAFT" | "APPROVED" | "SUPERSEDED" = "DRAFT") {
  const strategy = await prisma.contentStrategy.upsert({
    where: { businessId },
    create: { businessId, mode: "CUSTOM", platformSettings: [], contentMix: [], languages: ["tr"], rationale: "test", approvedAt: new Date() },
    update: {},
  });
  const previous = await prisma.contentPlan.findFirst({ where: { businessId, period: "SEVEN_DAYS", startDate: day(5) }, orderBy: { version: "desc" } });
  return prisma.contentPlan.create({
    data: {
      businessId, strategyId: strategy.id, period: "SEVEN_DAYS", startDate: day(5), endDate: day(11), version: (previous?.version ?? 0) + 1, status,
      timezone: "Europe/Istanbul", strategySummary: "test", strategySnapshot: {}, platformStrategies: {}, contentMix: {},
      provider: "test", model: "test", promptVersion: "test", inputHash: crypto.randomUUID(),
    },
  });
}

function itemFixture(planId: string, goalId: string, overrides: { mediaRequirement: string; plannedDate?: Date; mediaAssetId?: string | null; status?: "ACTIVE" | "REPLACED" }) {
  return prisma.contentPlanItem.create({
    data: {
      planId, goalId, platform: "INSTAGRAM", contentType: "POST",
      plannedDate: overrides.plannedDate ?? day(9), recommendedTime: "19:30",
      pillar: "PRODUCT", topic: "Ürün", concept: "Ürünü göster", hookCategory: "curiosity", hook: "Yeni",
      captionDirection: "Kısa", cta: "Rezervasyon yapın", language: "tr",
      mediaRequirement: overrides.mediaRequirement as never,
      mediaAvailability: (overrides.mediaRequirement === "NO_NEW_MEDIA_REQUIRED" ? "NOT_REQUIRED" : overrides.mediaAssetId ? "AVAILABLE" : "MISSING") as never,
      mediaAssetId: overrides.mediaAssetId ?? null,
      status: overrides.status ?? "ACTIVE",
      reasoning: "test", platformRulesApplied: [],
    },
  });
}

async function usageFixture(userId: string, businessId: string, mediaAssetId: string, usedAt: Date) {
  const content = await createContent(userId, businessId, { title: `Used ${crypto.randomUUID()}`, topic: "Reservation", contentType: "POST", platform: "INSTAGRAM", caption: "Caption", language: "tr", mediaAssetId });
  return prisma.$transaction((tx) => recordMediaUsage(tx, { businessId, mediaAssetId, contentVariantId: content.variants[0].id, usageType: "EXPORTED", usedAt }));
}

describe("Ainetra Phase 4 P4-03 — Content Stock", () => {
  it("returns HEALTHY with correct counts when every upcoming item is covered, and HEALTHY 0/0 with no upcoming items", async () => {
    const { business, goalId } = await fixture();
    expect(await calculateContentStock(business.id, { now })).toMatchObject({ status: "HEALTHY", upcomingCount: 0, coveredCount: 0, missingCount: 0, missingByRequirement: [] });

    const plan = await planFixture(business.id, "APPROVED");
    const product = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const video = await mediaFixture(business.id, ["VIDEO_VERTICAL"], "VIDEO");
    const a = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: day(7), mediaAssetId: product.id });
    const b = await itemFixture(plan.id, goalId, { mediaRequirement: "VIDEO_VERTICAL", plannedDate: day(9) });
    await itemFixture(plan.id, goalId, { mediaRequirement: "NO_NEW_MEDIA_REQUIRED", plannedDate: day(8) });

    const stock = await calculateContentStock(business.id, { now });
    expect(stock).toMatchObject({ status: "HEALTHY", upcomingCount: 2, coveredCount: 2, missingCount: 0, missingByRequirement: [] });
    expect(stock.window).toEqual({ from: day(5), to: new Date("2026-11-04T00:00:00.000Z") });
    expect(stock.allocations).toEqual([
      { planItemId: a.id, mediaRequirement: "PHOTO_PRODUCT", plannedDate: day(7), mediaAssetId: product.id },
      { planItemId: b.id, mediaRequirement: "VIDEO_VERTICAL", plannedDate: day(9), mediaAssetId: video.id },
    ]);
    expect(stock.byRequirement).toEqual([
      { mediaRequirement: "PHOTO_PRODUCT", upcoming: 1, covered: 1, missing: 0 },
      { mediaRequirement: "VIDEO_VERTICAL", upcoming: 1, covered: 1, missing: 0 },
    ]);
  });

  it("returns LOW for partial coverage and CRITICAL when nothing upcoming is covered", async () => {
    const { business, goalId } = await fixture();
    const plan = await planFixture(business.id);
    await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: day(7) });
    await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_ATMOSPHERE", plannedDate: day(8) });
    expect(await calculateContentStock(business.id, { now })).toMatchObject({ status: "CRITICAL", upcomingCount: 2, coveredCount: 0, missingCount: 2 });

    await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const low = await calculateContentStock(business.id, { now });
    expect(low).toMatchObject({ status: "LOW", upcomingCount: 2, coveredCount: 1, missingCount: 1 });
    expect(low.missingByRequirement).toEqual([{ mediaRequirement: "PHOTO_ATMOSPHERE", upcoming: 1, covered: 0, missing: 1 }]);
  });

  it("never allocates one asset to more than one item and groups missing quantities by requirement", async () => {
    const { business, goalId } = await fixture();
    const plan = await planFixture(business.id);
    // Yükleme akışı tek medyayı eşleşen tüm MISSING öğelere atar; stok yine de tek öğe sayar.
    const product = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const items = await Promise.all([7, 8, 9].map((d) => itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: day(d), mediaAssetId: product.id })));
    await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_ATMOSPHERE", plannedDate: day(10) });
    await itemFixture(plan.id, goalId, { mediaRequirement: "VIDEO_KITCHEN", plannedDate: day(11) });

    const stock = await calculateContentStock(business.id, { now });
    expect(stock).toMatchObject({ status: "LOW", upcomingCount: 5, coveredCount: 1, missingCount: 4 });
    expect(stock.allocations.filter((allocation) => allocation.mediaAssetId === product.id).map((allocation) => allocation.planItemId)).toEqual([items[0].id]);
    expect(stock.missingByRequirement).toEqual([
      { mediaRequirement: "PHOTO_PRODUCT", upcoming: 3, covered: 1, missing: 2 },
      { mediaRequirement: "PHOTO_ATMOSPHERE", upcoming: 1, covered: 0, missing: 1 },
      { mediaRequirement: "VIDEO_KITCHEN", upcoming: 1, covered: 0, missing: 1 },
    ]);
  });

  it("does not double-count a multi-tag asset across incompatible needs and prefers the most specific asset", async () => {
    const { business, goalId } = await fixture();
    const plan = await planFixture(business.id);
    const productItem = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: day(7) });
    const atmosphereItem = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_ATMOSPHERE", plannedDate: day(8) });
    const both = await mediaFixture(business.id, ["PHOTO_PRODUCT", "PHOTO_ATMOSPHERE"]);

    const onlyMultiTag = await calculateContentStock(business.id, { now });
    expect(onlyMultiTag).toMatchObject({ status: "LOW", coveredCount: 1, missingCount: 1 });
    expect(onlyMultiTag.allocations.map((allocation) => allocation.mediaAssetId)).toEqual([both.id, null]);

    const productOnly = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const withSpecific = await calculateContentStock(business.id, { now });
    expect(withSpecific).toMatchObject({ status: "HEALTHY", coveredCount: 2 });
    expect(withSpecific.allocations).toEqual([
      expect.objectContaining({ planItemId: productItem.id, mediaAssetId: productOnly.id }),
      expect.objectContaining({ planItemId: atmosphereItem.id, mediaAssetId: both.id }),
    ]);
  });

  it("requires the media type to match the requirement even when a tag is present", async () => {
    const { business, goalId } = await fixture();
    const plan = await planFixture(business.id);
    await itemFixture(plan.id, goalId, { mediaRequirement: "VIDEO_VERTICAL", plannedDate: day(7) });
    await mediaFixture(business.id, ["VIDEO_VERTICAL"], "IMAGE");
    expect(await calculateContentStock(business.id, { now })).toMatchObject({ status: "CRITICAL", coveredCount: 0, inventory: { tagged: 1, available: 1 } });
    await mediaFixture(business.id, ["VIDEO_VERTICAL"], "VIDEO");
    expect(await calculateContentStock(business.id, { now })).toMatchObject({ status: "HEALTHY", coveredCount: 1 });
  });

  it("treats previously used media as reusable, excludes recently used media by policy, and prefers never-used media", async () => {
    const { owner, business, goalId } = await fixture();
    const plan = await planFixture(business.id);
    const item = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: day(7) });

    const usedLongAgo = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    await usageFixture(owner.id, business.id, usedLongAgo.id, new Date("2026-08-01T10:00:00.000Z"));
    const reusable = await calculateContentStock(business.id, { now });
    expect(reusable).toMatchObject({ status: "HEALTHY", coveredCount: 1, inventory: { tagged: 1, available: 1, neverUsed: 0, reusable: 1, recentlyUsed: 0 } });
    expect(reusable.allocations[0]).toMatchObject({ planItemId: item.id, mediaAssetId: usedLongAgo.id });

    const usedRecently = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    await usageFixture(owner.id, business.id, usedRecently.id, new Date("2026-10-01T10:00:00.000Z"));
    const secondItem = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: day(8), mediaAssetId: usedRecently.id });
    const protectedStock = await calculateContentStock(business.id, { now });
    expect(protectedStock).toMatchObject({ status: "LOW", upcomingCount: 2, coveredCount: 1, inventory: { tagged: 2, available: 1, recentlyUsed: 1 } });
    expect(protectedStock.allocations.find((allocation) => allocation.planItemId === secondItem.id)?.mediaAssetId).toBeNull();

    // Politika açıkça gevşetilirse yakın zamanda kullanılan medya tekrar stok sayılır.
    expect(await calculateContentStock(business.id, { now, policy: { reuseProtectionDays: 0 } })).toMatchObject({ status: "HEALTHY", coveredCount: 2, inventory: { recentlyUsed: 0 } });

    // Hiç kullanılmamış medya, kullanılmış olana tercih edilir.
    const fresh = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const withFresh = await calculateContentStock(business.id, { now });
    expect(withFresh.allocations.find((allocation) => allocation.planItemId === item.id)?.mediaAssetId).toBe(fresh.id);
    expect(withFresh.allocations.find((allocation) => allocation.planItemId === secondItem.id)?.mediaAssetId).toBe(usedLongAgo.id);
  });

  it("ignores foreign-business media/usages and superseded, replaced, past, or out-of-window plan items", async () => {
    const { owner, outsider, business, otherBusiness, goalId, otherGoalId } = await fixture();
    const plan = await planFixture(business.id, "APPROVED");
    const item = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: day(7) });
    await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PEOPLE", plannedDate: day(8), status: "REPLACED" });
    await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PEOPLE", plannedDate: day(4) });
    await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PEOPLE", plannedDate: new Date("2026-11-04T00:00:00.000Z") });
    const superseded = await planFixture(business.id, "SUPERSEDED");
    await itemFixture(superseded.id, goalId, { mediaRequirement: "VIDEO_VERTICAL", plannedDate: day(9) });

    const foreignMedia = await mediaFixture(otherBusiness.id, ["PHOTO_PRODUCT"]);
    await usageFixture(outsider.id, otherBusiness.id, foreignMedia.id, new Date("2026-10-03T10:00:00.000Z"));
    const foreignPlan = await planFixture(otherBusiness.id);
    await itemFixture(foreignPlan.id, otherGoalId, { mediaRequirement: "CUSTOM_GRAPHIC", plannedDate: day(9) });

    const empty = await calculateContentStock(business.id, { now });
    expect(empty).toMatchObject({ status: "CRITICAL", upcomingCount: 1, coveredCount: 0, inventory: { tagged: 0 } });
    expect(empty.allocations.map((allocation) => allocation.planItemId)).toEqual([item.id]);

    // Kendi medyası, başka işletmedeki kullanımdan etkilenmez.
    const own = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    await usageFixture(owner.id, business.id, own.id, new Date("2026-07-01T10:00:00.000Z"));
    expect(await calculateContentStock(business.id, { now })).toMatchObject({ status: "HEALTHY", coveredCount: 1, inventory: { tagged: 1, reusable: 1, recentlyUsed: 0 } });
    expect(await calculateContentStock(otherBusiness.id, { now })).toMatchObject({ status: "CRITICAL", upcomingCount: 1, inventory: { tagged: 1, available: 0, recentlyUsed: 1 } });
  });

  it("membership-checked entry point rejects cross-tenant reads", async () => {
    const { owner, outsider, business } = await fixture();
    await expect(getContentStock(outsider.id, business.id, { now })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getContentStock(owner.id, business.id, { now })).toMatchObject({ status: "HEALTHY", upcomingCount: 0 });
    await expect(calculateContentStock("missing-business", { now })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("pure report builder is deterministic regardless of input order", () => {
    const usage = new Map();
    const assets = [
      { id: "b", type: "IMAGE" as const, tags: ["PHOTO_PRODUCT"], createdAt: new Date("2026-09-02T00:00:00.000Z") },
      { id: "a", type: "IMAGE" as const, tags: ["PHOTO_PRODUCT"], createdAt: new Date("2026-09-01T00:00:00.000Z") },
    ];
    const items = [
      { id: "later", mediaRequirement: "PHOTO_PRODUCT" as const, plannedDate: day(9), mediaAssetId: null },
      { id: "sooner", mediaRequirement: "PHOTO_PRODUCT" as const, plannedDate: day(7), mediaAssetId: null },
      { id: "third", mediaRequirement: "PHOTO_PRODUCT" as const, plannedDate: day(10), mediaAssetId: null },
    ];
    const window = { from: day(5), to: new Date("2026-11-04T00:00:00.000Z") };
    const first = buildContentStockReport({ items, assets, usage, now, window });
    const reordered = buildContentStockReport({ items: [...items].reverse(), assets: [...assets].reverse(), usage, now, window });
    expect(first).toEqual(reordered);
    expect(first.allocations.map((allocation) => [allocation.planItemId, allocation.mediaAssetId])).toEqual([["sooner", "a"], ["later", "b"], ["third", null]]);
    expect(first).toMatchObject({ status: "LOW", upcomingCount: 3, coveredCount: 2, missingCount: 1 });
  });
});
