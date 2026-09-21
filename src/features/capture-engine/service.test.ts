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

async function businessFixture(options: { timezone?: string } = {}) {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `capture-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `capture-out-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: {
      name: "Mimoza", sector: "RESTAURANT", timezone: options.timezone ?? "Europe/Istanbul",
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

  // ---- P4-05: listCaptureRequests reconciliation + business-local expiry ----
  // Fixture plan window: 2026-10-05..2026-10-11; default item plannedDate 2026-10-09.
  const inWindow = new Date("2026-10-07T12:00:00.000Z");

  it("backfills a CaptureRequest for a current ACTIVE MISSING item that was never synced", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: item.id } })).toBe(0);
    const listed = await listCaptureRequests(owner.id, business.id, { now: inWindow });
    expect(listed.map((request) => request.contentPlanItemId)).toEqual([item.id]);
    expect(listed[0].status).toBe("OPEN");
    expect(listed[0].mediaRequirement).toBe("PHOTO_PRODUCT");
    expect(listed[0].requestedMediaType).toBe("IMAGE");
    expect(listed[0].dueAt.toISOString()).toBe(item.plannedDate.toISOString());
  });

  it("does not backfill for NO_NEW_MEDIA_REQUIRED or non-MISSING items", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item: notRequired } = await planItemFixture(business.id, goalId, { mediaRequirement: "NO_NEW_MEDIA_REQUIRED", mediaAvailability: "NOT_REQUIRED" });
    const { item: available } = await planItemFixture(business.id, goalId, { mediaAvailability: "AVAILABLE" });
    const listed = await listCaptureRequests(owner.id, business.id, { now: inWindow, scope: "ALL" });
    expect(listed).toHaveLength(0);
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: { in: [notRequired.id, available.id] } } })).toBe(0);
  });

  it("creates no duplicates under repeated and concurrent reconciliation", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item: first } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    const { item: second } = await planItemFixture(business.id, goalId, { mediaRequirement: "VIDEO_VERTICAL" });
    await listCaptureRequests(owner.id, business.id, { now: inWindow });
    await listCaptureRequests(owner.id, business.id, { now: inWindow });
    const results = await Promise.allSettled([
      listCaptureRequests(owner.id, business.id, { now: inWindow }),
      listCaptureRequests(owner.id, business.id, { now: inWindow }),
      listCaptureRequests(owner.id, business.id, { now: inWindow }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: first.id } })).toBe(1);
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: second.id } })).toBe(1);
    expect(await prisma.captureRequest.count({ where: { businessId: business.id } })).toBe(2);
  });

  it("creates no duplicates when concurrent lists reconcile the same unsynced item from a cold table", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item } = await planItemFixture(business.id, goalId);
    const results = await Promise.allSettled([
      listCaptureRequests(owner.id, business.id, { now: inWindow }),
      listCaptureRequests(owner.id, business.id, { now: inWindow }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: item.id } })).toBe(1);
  });

  it("keeps DISMISSED and EXPIRED requests terminal across reconciliation", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item: dismissedItem } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PEOPLE" });
    const { item: expiredItem } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: new Date("2026-10-06T00:00:00.000Z") });
    const first = await listCaptureRequests(owner.id, business.id, { now: inWindow, scope: "ALL" });
    const dismissTarget = first.find((request) => request.contentPlanItemId === dismissedItem.id)!;
    await dismissCaptureRequest(owner.id, dismissTarget.id);
    // expiredItem was due 2026-10-06, before the business-local "today" (2026-10-07) -> EXPIRED on first list.
    const expiredRequest = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: expiredItem.id } });
    expect(expiredRequest.status).toBe("EXPIRED");

    const second = await listCaptureRequests(owner.id, business.id, { now: inWindow, scope: "ALL" });
    expect(second).toHaveLength(0);
    expect((await prisma.captureRequest.findUniqueOrThrow({ where: { id: dismissTarget.id } })).status).toBe("DISMISSED");
    expect((await prisma.captureRequest.findUniqueOrThrow({ where: { id: expiredRequest.id } })).status).toBe("EXPIRED");
    expect(await prisma.captureRequest.count({ where: { businessId: business.id } })).toBe(2);
  });

  it("closes and hides OPEN requests whose item was REPLACED or whose plan was SUPERSEDED", async () => {
    const { business, owner, goalId } = await businessFixture();
    const { item: replacedItem } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PEOPLE" });
    const { plan: oldPlan, item: supersededItem } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    const { item: currentItem } = await planItemFixture(business.id, goalId, { mediaRequirement: "VIDEO_VERTICAL" });
    await runSync(asBusiness(business), [replacedItem, supersededItem, currentItem]);
    // Simulate stale state without the invalidation hook having run.
    await prisma.contentPlanItem.update({ where: { id: replacedItem.id }, data: { status: "REPLACED" } });
    await prisma.contentPlan.update({ where: { id: oldPlan.id }, data: { status: "SUPERSEDED" } });

    const listed = await listCaptureRequests(owner.id, business.id, { now: inWindow, scope: "ALL" });
    expect(listed.map((request) => request.contentPlanItemId)).toEqual([currentItem.id]);
    const stale = await prisma.captureRequest.findMany({ where: { contentPlanItemId: { in: [replacedItem.id, supersededItem.id] } } });
    expect(stale).toHaveLength(2);
    for (const request of stale) {
      expect(request.status).toBe("DISMISSED");
      expect(request.dismissedById).toBeNull();
      expect(request.dismissedAt).not.toBeNull();
    }
    expect(await prisma.captureRequest.count({ where: { businessId: business.id } })).toBe(3);
  });

  it("keeps a request due today open all business-local day and expires only prior business days", async () => {
    const { business, owner, goalId } = await businessFixture({ timezone: "Europe/Istanbul" });
    const { item: dueToday } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: new Date("2026-10-09T00:00:00.000Z") });
    const { item: dueYesterday } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PEOPLE", plannedDate: new Date("2026-10-08T00:00:00.000Z") });
    // 2026-10-09 05:00Z = 08:00 Istanbul on the due day; the UTC-midnight dueAt is already in the past as a timestamp.
    const morning = new Date("2026-10-09T05:00:00.000Z");
    const listed = await listCaptureRequests(owner.id, business.id, { now: morning, scope: "TODAY" });
    expect(listed.map((request) => request.contentPlanItemId)).toEqual([dueToday.id]);
    expect((await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: dueYesterday.id } })).status).toBe("EXPIRED");

    // 2026-10-09 20:59Z = 23:59 Istanbul: still the due day -> still open.
    const lateEvening = new Date("2026-10-09T20:59:00.000Z");
    expect((await listCaptureRequests(owner.id, business.id, { now: lateEvening, scope: "TODAY" })).map((request) => request.contentPlanItemId)).toEqual([dueToday.id]);

    // 2026-10-09 21:00Z = 00:00 Istanbul on 2026-10-10: due day has ended -> expired.
    const nextLocalDay = new Date("2026-10-09T21:00:00.000Z");
    expect(await listCaptureRequests(owner.id, business.id, { now: nextLocalDay, scope: "ALL" })).toHaveLength(0);
    expect((await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: dueToday.id } })).status).toBe("EXPIRED");
  });

  it("uses the business timezone (not UTC) for the day boundary in a negative-offset timezone", async () => {
    const { business, owner, goalId } = await businessFixture({ timezone: "America/Los_Angeles" });
    const { item } = await planItemFixture(business.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", plannedDate: new Date("2026-10-08T00:00:00.000Z") });
    // 2026-10-09 03:00Z is already Oct 9 in UTC but still Oct 8 20:00 in Los Angeles -> due today, stays open.
    const stillDueDayLocally = new Date("2026-10-09T03:00:00.000Z");
    const listed = await listCaptureRequests(owner.id, business.id, { now: stillDueDayLocally, scope: "TODAY" });
    expect(listed.map((request) => request.contentPlanItemId)).toEqual([item.id]);
    // 2026-10-09 07:00Z = Oct 9 00:00 in Los Angeles -> prior business day, expires.
    const nextLocalDay = new Date("2026-10-09T07:00:00.000Z");
    expect(await listCaptureRequests(owner.id, business.id, { now: nextLocalDay, scope: "ALL" })).toHaveLength(0);
    expect((await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } })).status).toBe("EXPIRED");
  });

  it("reconciles only the requesting tenant's plan items", async () => {
    const { business, owner, outsider, otherBusiness, goalId, otherGoalId } = await businessFixture();
    const { item: ownItem } = await planItemFixture(business.id, goalId);
    const { item: foreignItem } = await planItemFixture(otherBusiness.id, otherGoalId);
    const listed = await listCaptureRequests(owner.id, business.id, { now: inWindow, scope: "ALL" });
    expect(listed.map((request) => request.contentPlanItemId)).toEqual([ownItem.id]);
    expect(listed.every((request) => request.businessId === business.id)).toBe(true);
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: foreignItem.id } })).toBe(0);
    expect(await prisma.captureRequest.count({ where: { businessId: otherBusiness.id } })).toBe(0);
    await expect(listCaptureRequests(outsider.id, business.id, { now: inWindow })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreignListed = await listCaptureRequests(outsider.id, otherBusiness.id, { now: inWindow, scope: "ALL" });
    expect(foreignListed.map((request) => request.contentPlanItemId)).toEqual([foreignItem.id]);
    expect(await prisma.captureRequest.count({ where: { businessId: business.id } })).toBe(1);
  });
});
