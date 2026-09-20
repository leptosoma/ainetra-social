import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  dismissCaptureRequest,
  fulfillCaptureRequestsForItems,
  invalidateCaptureRequestsForInactiveItems,
  listCaptureRequests,
  syncCaptureRequestsForActiveItems,
} from "@/features/capture-engine/service";
import { updateMediaPlanningTags } from "@/features/media/service";

async function businessFixture() {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `capture-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `capture-out-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
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

async function planItemFixture(
  businessId: string,
  goalId: string,
  overrides: { mediaRequirement?: string; mediaAvailability?: string; plannedDate?: Date } = {},
) {
  await prisma.contentStrategy.upsert({
    where: { businessId },
    create: { businessId, mode: "CUSTOM", platformSettings: [], contentMix: [], languages: ["tr"], rationale: "test", approvedAt: new Date() },
    update: {},
  });
  const strategy = await prisma.contentStrategy.findUniqueOrThrow({ where: { businessId } });
  const period = "SEVEN_DAYS" as const;
  const startDate = new Date("2026-10-05T00:00:00.000Z");
  const previousPlan = await prisma.contentPlan.findFirst({ where: { businessId, period, startDate }, orderBy: { version: "desc" } });
  const plan = await prisma.contentPlan.create({
    data: {
      businessId, strategyId: strategy.id, period,
      startDate, endDate: new Date("2026-10-11T00:00:00.000Z"),
      version: (previousPlan?.version ?? 0) + 1,
      timezone: "Europe/Istanbul", strategySummary: "test", strategySnapshot: {}, platformStrategies: {}, contentMix: {},
      provider: "test", model: "test", promptVersion: "test", inputHash: crypto.randomUUID(),
    },
  });
  const item = await prisma.contentPlanItem.create({
    data: {
      planId: plan.id, goalId, platform: "INSTAGRAM", contentType: "REEL",
      plannedDate: overrides.plannedDate ?? new Date("2026-10-09T00:00:00.000Z"), recommendedTime: "19:30",
      pillar: "ATMOSPHERE", topic: "Akşam atmosferi", concept: "Akşam atmosferini göster", hookCategory: "curiosity", hook: "Akşam yaklaşıyor",
      captionDirection: "Sıcak bir dille anlat", cta: "Rezervasyon yapın", language: "tr",
      mediaRequirement: (overrides.mediaRequirement ?? "VIDEO_VERTICAL") as never,
      mediaAvailability: (overrides.mediaAvailability ?? "MISSING") as never,
      reasoning: "test", platformRulesApplied: [],
    },
  });
  return { plan, item };
}

function runSync(business: { id: string; sector: string; timezone: string }, items: Parameters<typeof syncCaptureRequestsForActiveItems>[2]) {
  return prisma.$transaction((tx) => syncCaptureRequestsForActiveItems(tx, business, items));
}

function asBusiness(business: { id: string; sector: string; timezone: string }) {
  return { id: business.id, sector: business.sector, timezone: business.timezone };
}

describe("Ainetra Phase 4 capture engine", () => {
  it("creates an OPEN CaptureRequest for a MISSING media requirement", async () => {
    const { business, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaRequirement: "VIDEO_VERTICAL", mediaAvailability: "MISSING" });
    await runSync(asBusiness(business), [item]);
    const requests = await prisma.captureRequest.findMany({ where: { contentPlanItemId: item.id } });
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("OPEN");
    expect(requests[0].requestedMediaType).toBe("VIDEO");
    expect(requests[0].dueAt.toISOString()).toBe(item.plannedDate.toISOString());
    expect(requests[0].title).toContain("Reel");
    expect(requests[0].instructions.length).toBeGreaterThan(0);
  });

  it("does not create a CaptureRequest for an AVAILABLE media requirement", async () => {
    const { business, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaAvailability: "AVAILABLE" });
    await runSync(asBusiness(business), [item]);
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: item.id } })).toBe(0);
  });

  it("does not duplicate a CaptureRequest for the same item and requirement on repeated sync", async () => {
    const { business, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId);
    await runSync(asBusiness(business), [item]);
    await runSync(asBusiness(business), [item]);
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: item.id } })).toBe(1);
  });

  it("enforces tenant isolation for dismiss and list", async () => {
    const { business, outsider, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId);
    await runSync(asBusiness(business), [item]);
    const request = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } });
    await expect(dismissCaptureRequest(outsider.id, request.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listCaptureRequests(outsider.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fulfills the matching OPEN CaptureRequest when tagged media covers the requirement", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    await runSync(asBusiness(business), [item]);
    const asset = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "IMAGE", originalFilename: "urun.jpg", mimeType: "image/jpeg", size: 10, storageKey: `${business.id}/${crypto.randomUUID()}.jpg`, tags: [] },
    });
    await updateMediaPlanningTags(owner.id, asset.id, ["PHOTO_PRODUCT"]);
    const request = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } });
    expect(request.status).toBe("FULFILLED");
    expect(request.fulfilledByMediaAssetId).toBe(asset.id);
    const updatedItem = await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updatedItem.mediaAssetId).toBe(asset.id);
    expect(updatedItem.mediaAvailability).toBe("AVAILABLE");
  });

  it("does not fulfill a CaptureRequest when the media tag does not match the requirement", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    await runSync(asBusiness(business), [item]);
    const asset = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "IMAGE", originalFilename: "atmosfer.jpg", mimeType: "image/jpeg", size: 10, storageKey: `${business.id}/${crypto.randomUUID()}.jpg`, tags: [] },
    });
    await updateMediaPlanningTags(owner.id, asset.id, ["PHOTO_ATMOSPHERE"]);
    const request = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } });
    expect(request.status).toBe("OPEN");
  });

  it("reopens a FULFILLED CaptureRequest when its fulfilling media is untagged", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    await runSync(asBusiness(business), [item]);
    const asset = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "IMAGE", originalFilename: "urun.jpg", mimeType: "image/jpeg", size: 10, storageKey: `${business.id}/${crypto.randomUUID()}.jpg`, tags: [] },
    });
    await updateMediaPlanningTags(owner.id, asset.id, ["PHOTO_PRODUCT"]);
    await updateMediaPlanningTags(owner.id, asset.id, []);
    const request = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } });
    expect(request.status).toBe("OPEN");
    expect(request.fulfilledByMediaAssetId).toBeNull();
    const updatedItem = await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updatedItem.mediaAvailability).toBe("MISSING");
  });

  it("keeps a DISMISSED CaptureRequest closed on resync (does not auto-reopen)", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId);
    await runSync(asBusiness(business), [item]);
    const request = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } });
    await dismissCaptureRequest(owner.id, request.id);
    await runSync(asBusiness(business), [item]);
    const after = await prisma.captureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe("DISMISSED");
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: item.id } })).toBe(1);
  });

  it("invalidates the replaced item's CaptureRequest and opens a fresh one for its replacement", async () => {
    const { business, goalId } = await businessFixture();
    const { item: oldItem } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PEOPLE" });
    await runSync(asBusiness(business), [oldItem]);
    const oldRequest = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: oldItem.id } });

    await prisma.contentPlanItem.update({ where: { id: oldItem.id }, data: { status: "REPLACED" } });
    await prisma.$transaction((tx) => invalidateCaptureRequestsForInactiveItems(tx, [oldItem.id]));

    const { item: newItem } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PEOPLE" });
    await runSync(asBusiness(business), [newItem]);

    const oldAfter = await prisma.captureRequest.findUniqueOrThrow({ where: { id: oldRequest.id } });
    expect(oldAfter.status).toBe("DISMISSED");
    expect(oldAfter.dismissedById).toBeNull();

    const newRequest = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: newItem.id } });
    expect(newRequest.status).toBe("OPEN");
    expect(newRequest.id).not.toBe(oldRequest.id);
  });

  it("never double-fulfills the same item under concurrent tagging of two different media assets", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    await runSync(asBusiness(business), [item]);
    const [assetA, assetB] = await Promise.all([
      prisma.mediaAsset.create({ data: { businessId: business.id, type: "IMAGE", originalFilename: "a.jpg", mimeType: "image/jpeg", size: 10, storageKey: `${business.id}/${crypto.randomUUID()}.jpg`, tags: [] } }),
      prisma.mediaAsset.create({ data: { businessId: business.id, type: "IMAGE", originalFilename: "b.jpg", mimeType: "image/jpeg", size: 10, storageKey: `${business.id}/${crypto.randomUUID()}.jpg`, tags: [] } }),
    ]);

    const results = await Promise.allSettled([
      updateMediaPlanningTags(owner.id, assetA.id, ["PHOTO_PRODUCT"]),
      updateMediaPlanningTags(owner.id, assetB.id, ["PHOTO_PRODUCT"]),
    ]);
    // Serializable çakışmasında bir taraf reddedilebilir; önemli olan hiçbir zaman
    // her iki tarafın da aynı anda "başarılı" görünmemesi ve nihai durumun tutarlı olmasıdır.
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);

    const finalItem = await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([assetA.id, assetB.id]).toContain(finalItem.mediaAssetId);
    expect(finalItem.mediaAvailability).toBe("AVAILABLE");

    const requests = await prisma.captureRequest.findMany({ where: { contentPlanItemId: item.id } });
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("FULFILLED");
    expect(requests[0].fulfilledByMediaAssetId).toBe(finalItem.mediaAssetId);
  });

  it("fulfillCaptureRequestsForItems is a no-op for items without an OPEN request", async () => {
    const { business, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaAvailability: "AVAILABLE" });
    await runSync(asBusiness(business), [item]);
    await expect(prisma.$transaction((tx) => fulfillCaptureRequestsForItems(tx, [item.id], "nonexistent-media-id"))).resolves.toBeUndefined();
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: item.id } })).toBe(0);
  });

  it("removes a dismissed request from listCaptureRequests output (UI wiring contract)", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PEOPLE", plannedDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) });
    await runSync(asBusiness(business), [item]);
    const before = await listCaptureRequests(owner.id, business.id);
    expect(before.some((request) => request.contentPlanItemId === item.id)).toBe(true);
    const request = before.find((candidate) => candidate.contentPlanItemId === item.id)!;
    await dismissCaptureRequest(owner.id, request.id);
    const after = await listCaptureRequests(owner.id, business.id);
    expect(after.some((candidate) => candidate.id === request.id)).toBe(false);
  });
});
