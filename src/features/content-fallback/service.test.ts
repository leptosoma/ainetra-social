import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { createContent } from "@/features/content/service";
import { recordMediaUsage, type MediaUsageSummary } from "@/features/media-usage/service";
import { syncCaptureRequestsForActiveItems } from "@/features/capture-engine/service";
import {
  acceptContentFallbackProposal,
  evaluateContentFallback,
  listContentFallbackProposals,
  proposeContentFallback,
  type FallbackConfirmedFact,
  type FallbackMediaAsset,
  type FallbackSource,
} from "@/features/content-fallback/service";

// Sabit "şimdi": İstanbul'da 5 Ekim 2026. Plan öğeleri 6–11 Ekim'e konur.
const now = new Date("2026-10-05T10:00:00.000Z");
const day = (n: number) => new Date(`2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`);
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

async function fixture() {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `fallback-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `fallback-out-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
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

function mediaFixture(businessId: string, tags: string[], options: { type?: "IMAGE" | "VIDEO"; createdAt?: Date; name?: string } = {}) {
  const type = options.type ?? "IMAGE";
  return prisma.mediaAsset.create({
    data: {
      businessId, type, originalFilename: options.name ?? (type === "VIDEO" ? "klip.mp4" : "urun.jpg"), mimeType: type === "VIDEO" ? "video/mp4" : "image/jpeg",
      size: 10, width: 10, height: 10, storageKey: `${businessId}/${crypto.randomUUID()}`, tags, ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
}

async function planFixture(businessId: string, status: "DRAFT" | "APPROVED" | "SUPERSEDED" = "APPROVED") {
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

function itemFixture(planId: string, goalId: string, overrides: { mediaRequirement: string; plannedDate?: Date; mediaAssetId?: string | null; pillar?: string }) {
  return prisma.contentPlanItem.create({
    data: {
      planId, goalId, platform: "INSTAGRAM", contentType: "POST",
      plannedDate: overrides.plannedDate ?? day(9), recommendedTime: "19:30",
      pillar: overrides.pillar ?? "PRODUCT", topic: "Ürün", concept: "Ürünü göster", hookCategory: "curiosity", hook: "Yeni",
      captionDirection: "Kısa", cta: "Rezervasyon yapın", language: "tr",
      mediaRequirement: overrides.mediaRequirement as never,
      mediaAvailability: (overrides.mediaRequirement === "NO_NEW_MEDIA_REQUIRED" ? "NOT_REQUIRED" : overrides.mediaAssetId ? "AVAILABLE" : "MISSING") as never,
      mediaAssetId: overrides.mediaAssetId ?? null,
      reasoning: "test", platformRulesApplied: [],
    },
  });
}

/** Medyası eksik bir öğe + ona bağlı OPEN çekim görevi (P4-01 akışıyla aynı). */
async function missingItemWithCapture(business: { id: string; sector: string; timezone: string }, goalId: string, mediaRequirement: string, overrides: { plannedDate?: Date; pillar?: string; planStatus?: "DRAFT" | "APPROVED" } = {}) {
  const plan = await planFixture(business.id, overrides.planStatus ?? "APPROVED");
  const item = await itemFixture(plan.id, goalId, { mediaRequirement, plannedDate: overrides.plannedDate, pillar: overrides.pillar });
  await prisma.$transaction((tx) => syncCaptureRequestsForActiveItems(tx, { id: business.id, sector: business.sector, timezone: business.timezone }, [item]));
  return { plan, item };
}

async function usageFixture(userId: string, businessId: string, mediaAssetId: string, usedAt: Date) {
  const content = await createContent(userId, businessId, { title: `Used ${crypto.randomUUID()}`, topic: "Reservation", contentType: "POST", platform: "INSTAGRAM", caption: "Caption", language: "tr", mediaAssetId });
  return prisma.$transaction((tx) => recordMediaUsage(tx, { businessId, mediaAssetId, contentVariantId: content.variants[0].id, usageType: "EXPORTED", usedAt }));
}

/** DB kısıtı gereği yalnızca CONFIRMED kayıtlar kanonik olabilir (BusinessAttribute_canonical_is_confirmed). */
function factFixture(businessId: string, overrides: { category?: string; value?: unknown; verificationStatus?: string; isCanonical?: boolean; key?: string } = {}) {
  const verificationStatus = overrides.verificationStatus ?? "CONFIRMED";
  const isCanonical = overrides.isCanonical ?? verificationStatus === "CONFIRMED";
  return prisma.businessAttribute.create({
    data: {
      businessId, category: (overrides.category ?? "FACT") as never, key: overrides.key ?? `fact-${crypto.randomUUID()}`, value: overrides.value ?? "1998'den beri aile işletmesi",
      source: "USER", verificationStatus: verificationStatus as never, isCanonical, confirmedAt: verificationStatus === "CONFIRMED" ? now : null,
    },
  });
}

// --- Saf değerlendirme yardımcıları ---
const asset = (id: string, tags: string[], overrides: Partial<FallbackMediaAsset> = {}): FallbackMediaAsset => ({ id, type: "IMAGE", tags, createdAt: daysAgo(3), originalFilename: `${id}.jpg`, ...overrides });
const used = (id: string, lastUsedAt: Date, usageCount = 1): [string, MediaUsageSummary] => [id, { mediaAssetId: id, usageCount, lastUsedAt, neverUsed: false }];
const fact = (id: string, overrides: Partial<FallbackConfirmedFact> = {}): FallbackConfirmedFact => ({ id, category: "FACT", key: id, value: "Odun fırınında pişirilir", source: "USER", confirmedAt: now, ...overrides });
const baseInput = { item: { id: "item", mediaRequirement: "PHOTO_PRODUCT" as const, pillar: "PRODUCT" }, assets: [] as FallbackMediaAsset[], usage: new Map<string, MediaUsageSummary>(), confirmedFacts: [] as FallbackConfirmedFact[], verifiedSocialProof: [], brand: { businessName: "Mimoza", hasBrandProfile: true }, now };

describe("Ainetra Phase 4 P4-04 — Content Fallback (pure ranking)", () => {
  it("prefers fresh unused media, then older unused, then reusable outside the protection window", () => {
    const assets = [asset("fresh", ["PHOTO_PRODUCT"], { createdAt: daysAgo(2) }), asset("older", ["PHOTO_PRODUCT"], { createdAt: daysAgo(90) }), asset("reused", ["PHOTO_PRODUCT"], { createdAt: daysAgo(120) })];
    const usage = new Map([used("reused", daysAgo(60))]);
    const first = evaluateContentFallback({ ...baseInput, assets, usage });
    expect(first.proposal).toMatchObject({ kind: "UNUSED_AUTHENTIC_MEDIA", mediaAssetId: "fresh", targetMediaRequirement: "PHOTO_PRODUCT" });
    expect(first.proposal!.rationale).toContain("fresh.jpg");
    expect(first.proposal!.sources).toEqual([expect.objectContaining({ type: "MEDIA_ASSET", id: "fresh", usageCount: 0, lastUsedAt: null })]);

    const second = evaluateContentFallback({ ...baseInput, assets: assets.filter((entry) => entry.id !== "fresh"), usage });
    expect(second.proposal).toMatchObject({ kind: "OLDER_UNUSED_AUTHENTIC_MEDIA", mediaAssetId: "older" });

    const third = evaluateContentFallback({ ...baseInput, assets: assets.filter((entry) => entry.id === "reused"), usage });
    expect(third.proposal).toMatchObject({ kind: "REUSABLE_AUTHENTIC_MEDIA", mediaAssetId: "reused" });
    expect(third.proposal!.rationale).toContain("60 gün önce kullanıldı");
  });

  it("MediaUsage recency: recently used media is protected, the longest-idle reusable wins, and the rationale explains the exclusion", () => {
    const assets = [asset("recent", ["PHOTO_PRODUCT"]), asset("idle45", ["PHOTO_PRODUCT"]), asset("idle90", ["PHOTO_PRODUCT"])];
    const usage = new Map([used("recent", daysAgo(5)), used("idle45", daysAgo(45)), used("idle90", daysAgo(90))]);
    const result = evaluateContentFallback({ ...baseInput, assets, usage });
    expect(result.proposal).toMatchObject({ kind: "REUSABLE_AUTHENTIC_MEDIA", mediaAssetId: "idle90" });
    expect(result.proposal!.rationale).toContain("1 uygun medya son 30 gün içinde kullanıldığı için önerilmedi");

    // Yakınlık koruması politikaya bağlıdır: pencere 3 güne inince "recent" de aday olur ama en uzun süredir boşta olan yine kazanır.
    const relaxed = evaluateContentFallback({ ...baseInput, assets, usage, policy: { reuseProtectionDays: 3 } });
    expect(relaxed.proposal).toMatchObject({ kind: "REUSABLE_AUTHENTIC_MEDIA", mediaAssetId: "idle90" });
    expect(relaxed.proposal!.rationale).not.toContain("önerilmedi");
  });

  it("falls back to format adaptation within the same media family, never across photo/video or to reserved media", () => {
    const assets = [asset("atmos", ["PHOTO_ATMOSPHERE"]), asset("clip", ["VIDEO_VERTICAL"], { type: "VIDEO" }), asset("reservedProduct", ["PHOTO_PRODUCT"])];
    const result = evaluateContentFallback({ ...baseInput, assets, reservedAssetIds: ["reservedProduct"] });
    expect(result.proposal).toMatchObject({ kind: "FORMAT_ADAPTATION", mediaAssetId: "atmos", targetMediaRequirement: "PHOTO_ATMOSPHERE" });
    expect(result.proposal!.rationale).toContain('"Mekân fotoğrafı" olarak güncellenir');

    const videoItem = evaluateContentFallback({ ...baseInput, item: { ...baseInput.item, mediaRequirement: "VIDEO_KITCHEN" }, assets });
    expect(videoItem.proposal).toMatchObject({ kind: "FORMAT_ADAPTATION", mediaAssetId: "clip", targetMediaRequirement: "VIDEO_VERTICAL" });
  });

  it("uses only confirmed canonical information facts, ordered by pillar, capped at three, and never invents anything", () => {
    const facts = [
      fact("f-desc", { category: "DESCRIPTION", confirmedAt: daysAgo(10) }),
      fact("f-loc", { category: "LOCATION_CONTEXT", confirmedAt: daysAgo(9) }),
      fact("f-prod", { category: "PRODUCTS_SERVICES", value: "Odun fırını pizza", confirmedAt: daysAgo(8) }),
      fact("f-fact", { category: "FACT", confirmedAt: daysAgo(7) }),
      fact("f-tone", { category: "BRAND_TONE", value: "Samimi" }),
      fact("f-empty", { category: "FACT", value: "   " }),
    ];
    const product = evaluateContentFallback({ ...baseInput, confirmedFacts: facts });
    expect(product.proposal).toMatchObject({ kind: "CONFIRMED_BUSINESS_INFO", mediaAssetId: null, targetMediaRequirement: "NO_NEW_MEDIA_REQUIRED" });
    expect(product.proposal!.sources.map((source) => (source as { id: string }).id)).toEqual(["f-prod", "f-fact", "f-desc"]);
    expect(product.proposal!.rationale).toContain("ürün, fiyat, etkinlik, kampanya veya yorum uydurulmaz");

    const atmosphere = evaluateContentFallback({ ...baseInput, item: { ...baseInput.item, pillar: "ATMOSPHERE" }, confirmedFacts: facts });
    expect(atmosphere.proposal!.sources.map((source) => (source as { id: string }).id)).toEqual(["f-loc", "f-fact", "f-desc"]);
  });

  it("uses verified social proof only when real verified data exists, otherwise the brand placeholder, otherwise no fallback", () => {
    const proof = evaluateContentFallback({ ...baseInput, verifiedSocialProof: [{ id: "p1", label: "4,8 ortalama puan", sourceReference: "google-reviews", verifiedAt: daysAgo(1) }] });
    expect(proof.proposal).toMatchObject({ kind: "VERIFIED_SOCIAL_PROOF", targetMediaRequirement: "NO_NEW_MEDIA_REQUIRED" });

    const placeholder = evaluateContentFallback(baseInput);
    expect(placeholder.proposal).toMatchObject({ kind: "BRAND_CREATIVE_PLACEHOLDER", targetMediaRequirement: "CUSTOM_GRAPHIC", sources: [{ type: "BRAND", businessName: "Mimoza", hasBrandProfile: true }] });

    const none = evaluateContentFallback({ ...baseInput, item: { ...baseInput.item, mediaRequirement: "CUSTOM_GRAPHIC" } });
    expect(none.proposal).toBeNull();
    expect(none.reason).toContain("yer tutucu da önerilemez");

    const notRequired = evaluateContentFallback({ ...baseInput, item: { ...baseInput.item, mediaRequirement: "NO_NEW_MEDIA_REQUIRED" } });
    expect(notRequired.proposal).toBeNull();
  });

  it("is deterministic regardless of asset input order", () => {
    const assets = [asset("b", ["PHOTO_PRODUCT", "PHOTO_ATMOSPHERE"]), asset("a", ["PHOTO_PRODUCT"]), asset("c", ["PHOTO_PRODUCT"])];
    const forward = evaluateContentFallback({ ...baseInput, assets });
    const reversed = evaluateContentFallback({ ...baseInput, assets: [...assets].reverse() });
    expect(forward.proposal!.mediaAssetId).toBe("a");
    expect(reversed).toEqual(forward);
  });
});

describe("Ainetra Phase 4 P4-04 — Content Fallback (proposal & acceptance)", () => {
  it("proposing never mutates the plan item or its capture request; only explicit acceptance applies the change", async () => {
    const { owner, business, goalId } = await fixture();
    const { item } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    const media = await mediaFixture(business.id, ["PHOTO_PRODUCT"], { createdAt: daysAgo(2) });

    const { proposal } = await proposeContentFallback(owner.id, item.id, { now });
    expect(proposal).toMatchObject({ kind: "UNUSED_AUTHENTIC_MEDIA", mediaAssetId: media.id, status: "PROPOSED", planVersion: 1, itemRevision: 1 });
    const untouched = await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(untouched).toMatchObject({ mediaAssetId: null, mediaAvailability: "MISSING", mediaRequirement: "PHOTO_PRODUCT", revision: 1 });
    expect(await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } })).toMatchObject({ status: "OPEN" });

    const accepted = await acceptContentFallbackProposal(owner.id, proposal!.id, { now });
    expect(accepted).toMatchObject({ status: "ACCEPTED", acceptedById: owner.id });
    const applied = await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(applied).toMatchObject({ mediaAssetId: media.id, mediaAvailability: "AVAILABLE", mediaRequirement: "PHOTO_PRODUCT" });
    expect(await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } })).toMatchObject({ status: "FULFILLED", fulfilledByMediaAssetId: media.id });
    // Kabul bir kullanım değildir: MediaUsage yalnızca gerçek dışa aktarım/yayında yazılır (P4-02).
    expect(await prisma.mediaUsage.count({ where: { mediaAssetId: media.id } })).toBe(0);
  });

  it("uses MediaUsage from the database: never-used media wins, recently used media is protected, reusable media is proposed after the window", async () => {
    const { owner, business, goalId } = await fixture();
    const { item } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    const recent = await mediaFixture(business.id, ["PHOTO_PRODUCT"], { name: "recent.jpg" });
    const idle = await mediaFixture(business.id, ["PHOTO_PRODUCT"], { name: "idle.jpg" });
    await usageFixture(owner.id, business.id, recent.id, daysAgo(3));
    await usageFixture(owner.id, business.id, idle.id, daysAgo(45));

    const reusable = await proposeContentFallback(owner.id, item.id, { now });
    expect(reusable.proposal).toMatchObject({ kind: "REUSABLE_AUTHENTIC_MEDIA", mediaAssetId: idle.id });
    expect((reusable.proposal!.sources as FallbackSource[])[0]).toMatchObject({ type: "MEDIA_ASSET", id: idle.id, usageCount: 1 });

    const fresh = await mediaFixture(business.id, ["PHOTO_PRODUCT"], { name: "fresh.jpg" });
    const unused = await proposeContentFallback(owner.id, item.id, { now });
    expect(unused.proposal).toMatchObject({ kind: "UNUSED_AUTHENTIC_MEDIA", mediaAssetId: fresh.id });
    // Öğe başına en fazla bir açık öneri: önceki öneri geçersiz kılınır.
    expect(await prisma.contentFallbackProposal.findUniqueOrThrow({ where: { id: reusable.proposal!.id } })).toMatchObject({ status: "INVALIDATED" });
    expect(await prisma.contentFallbackProposal.count({ where: { contentPlanItemId: item.id, status: "PROPOSED" } })).toBe(1);
  });

  it("re-proposing the same content is idempotent (same proposal row) and no-fallback invalidates open proposals without touching the item", async () => {
    const { owner, business, goalId } = await fixture();
    const { item } = await missingItemWithCapture(business, goalId, "CUSTOM_GRAPHIC");
    const graphic = await mediaFixture(business.id, ["CUSTOM_GRAPHIC"]);
    const first = await proposeContentFallback(owner.id, item.id, { now });
    const second = await proposeContentFallback(owner.id, item.id, { now });
    expect(first.proposal!.id).toBe(second.proposal!.id);
    expect(await prisma.contentFallbackProposal.count({ where: { contentPlanItemId: item.id } })).toBe(1);

    await prisma.mediaAsset.delete({ where: { id: graphic.id } });
    const none = await proposeContentFallback(owner.id, item.id, { now });
    expect(none.proposal).toBeNull();
    expect(none.reason).toContain("yer tutucu da önerilemez");
    expect(await prisma.contentFallbackProposal.findUniqueOrThrow({ where: { id: first.proposal!.id } })).toMatchObject({ status: "INVALIDATED" });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ mediaAssetId: null, mediaAvailability: "MISSING", mediaRequirement: "CUSTOM_GRAPHIC" });
  });

  it("confirmed-fact restriction: inferred, non-canonical, rejected or non-information attributes are never used; accepting marks the item as needing no media", async () => {
    const { owner, business, goalId } = await fixture();
    const { item } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    await factFixture(business.id, { verificationStatus: "INFERRED" });
    await factFixture(business.id, { verificationStatus: "NEEDS_CONFIRMATION" });
    await factFixture(business.id, { verificationStatus: "REJECTED" });
    await factFixture(business.id, { isCanonical: false });
    await factFixture(business.id, { category: "BRAND_TONE", value: "Samimi" });
    await factFixture(business.id, { value: { structured: true } });

    const placeholder = await proposeContentFallback(owner.id, item.id, { now });
    expect(placeholder.proposal).toMatchObject({ kind: "BRAND_CREATIVE_PLACEHOLDER" });

    const confirmed = await factFixture(business.id, { category: "PRODUCTS_SERVICES", value: "Odun fırını pizza" });
    const info = await proposeContentFallback(owner.id, item.id, { now });
    expect(info.proposal).toMatchObject({ kind: "CONFIRMED_BUSINESS_INFO", targetMediaRequirement: "NO_NEW_MEDIA_REQUIRED" });
    expect(info.proposal!.sources).toEqual([expect.objectContaining({ type: "BUSINESS_ATTRIBUTE", id: confirmed.id, value: "Odun fırını pizza", source: "USER" })]);
    expect(await prisma.contentFallbackProposal.findUniqueOrThrow({ where: { id: placeholder.proposal!.id } })).toMatchObject({ status: "INVALIDATED" });

    await acceptContentFallbackProposal(owner.id, info.proposal!.id, { now });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ mediaRequirement: "NO_NEW_MEDIA_REQUIRED", mediaAvailability: "NOT_REQUIRED", mediaAssetId: null });
    expect(await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } })).toMatchObject({ status: "DISMISSED", dismissedById: owner.id });
  });

  it("rejects acceptance when the supporting fact loses its confirmed status in the meantime", async () => {
    const { owner, business, goalId } = await fixture();
    const { item } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    const confirmed = await factFixture(business.id);
    const { proposal } = await proposeContentFallback(owner.id, item.id, { now });
    expect(proposal).toMatchObject({ kind: "CONFIRMED_BUSINESS_INFO" });
    await prisma.businessAttribute.update({ where: { id: confirmed.id }, data: { verificationStatus: "REJECTED", isCanonical: false } });

    await expect(acceptContentFallbackProposal(owner.id, proposal!.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.contentFallbackProposal.findUniqueOrThrow({ where: { id: proposal!.id } })).toMatchObject({ status: "INVALIDATED" });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ mediaRequirement: "PHOTO_PRODUCT", mediaAvailability: "MISSING" });
  });

  it("format adaptation acceptance retargets the item's requirement; brand placeholder acceptance opens a CUSTOM_GRAPHIC capture request", async () => {
    const { owner, business, goalId } = await fixture();
    const { item: adaptItem } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    const atmosphere = await mediaFixture(business.id, ["PHOTO_ATMOSPHERE"]);
    const adaptation = await proposeContentFallback(owner.id, adaptItem.id, { now });
    expect(adaptation.proposal).toMatchObject({ kind: "FORMAT_ADAPTATION", mediaAssetId: atmosphere.id, targetMediaRequirement: "PHOTO_ATMOSPHERE" });
    await acceptContentFallbackProposal(owner.id, adaptation.proposal!.id, { now });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: adaptItem.id } })).toMatchObject({ mediaRequirement: "PHOTO_ATMOSPHERE", mediaAvailability: "AVAILABLE", mediaAssetId: atmosphere.id });
    expect(await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: adaptItem.id } })).toMatchObject({ status: "FULFILLED", fulfilledByMediaAssetId: atmosphere.id });

    // Uyarlanan medya artık rezerve: ikinci bir öğe için önerilmez; medya kalmayınca yer tutucu önerilir.
    const { item: placeholderItem } = await missingItemWithCapture(business, goalId, "VIDEO_KITCHEN");
    const placeholder = await proposeContentFallback(owner.id, placeholderItem.id, { now });
    expect(placeholder.proposal).toMatchObject({ kind: "BRAND_CREATIVE_PLACEHOLDER", targetMediaRequirement: "CUSTOM_GRAPHIC" });
    await acceptContentFallbackProposal(owner.id, placeholder.proposal!.id, { now });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: placeholderItem.id } })).toMatchObject({ mediaRequirement: "CUSTOM_GRAPHIC", mediaAvailability: "MISSING", mediaAssetId: null });
    const requests = await prisma.captureRequest.findMany({ where: { contentPlanItemId: placeholderItem.id }, orderBy: { createdAt: "asc" } });
    expect(requests.map((request) => [request.mediaRequirement, request.status])).toEqual([["VIDEO_KITCHEN", "DISMISSED"], ["CUSTOM_GRAPHIC", "OPEN"]]);
    expect(requests[1]).toMatchObject({ requestedMediaType: "IMAGE", businessId: business.id });
  });

  it("enforces tenant isolation: foreign media is never proposed and outsiders cannot propose, accept or list", async () => {
    const { owner, outsider, business, otherBusiness, goalId } = await fixture();
    const { plan, item } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    await mediaFixture(otherBusiness.id, ["PHOTO_PRODUCT"]);
    await factFixture(otherBusiness.id);

    await expect(proposeContentFallback(outsider.id, item.id, { now })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { proposal } = await proposeContentFallback(owner.id, item.id, { now });
    expect(proposal).toMatchObject({ kind: "BRAND_CREATIVE_PLACEHOLDER", businessId: business.id });

    await expect(acceptContentFallbackProposal(outsider.id, proposal!.id, { now })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listContentFallbackProposals(outsider.id, plan.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.contentFallbackProposal.findUniqueOrThrow({ where: { id: proposal!.id } })).toMatchObject({ status: "PROPOSED" });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ mediaRequirement: "PHOTO_PRODUCT", mediaAvailability: "MISSING" });

    const listed = await listContentFallbackProposals(owner.id, plan.id);
    expect(listed.get(item.id)?.id).toBe(proposal!.id);
  });

  it("does not propose for past-dated, replaced, superseded, already-covered or no-media items", async () => {
    const { owner, business, goalId } = await fixture();
    const { plan, item: past } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT", { plannedDate: day(1) });
    await expect(proposeContentFallback(owner.id, past.id, { now })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const media = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const covered = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", mediaAssetId: media.id });
    await expect(proposeContentFallback(owner.id, covered.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });
    const noMedia = await itemFixture(plan.id, goalId, { mediaRequirement: "NO_NEW_MEDIA_REQUIRED" });
    await expect(proposeContentFallback(owner.id, noMedia.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });
    const replaced = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PEOPLE" });
    await prisma.contentPlanItem.update({ where: { id: replaced.id }, data: { status: "REPLACED" } });
    await expect(proposeContentFallback(owner.id, replaced.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });

    await prisma.contentPlan.update({ where: { id: plan.id }, data: { status: "SUPERSEDED" } });
    const onSuperseded = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PEOPLE" });
    await expect(proposeContentFallback(owner.id, onSuperseded.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(proposeContentFallback(owner.id, "missing-item", { now })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects stale targets on acceptance: superseded plan, replaced item, bumped revision, and media assigned elsewhere or used in the meantime", async () => {
    const { owner, business, goalId } = await fixture();
    const media = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);

    // Plan sürümü değişti (P4 regenerate akışı: eski plan SUPERSEDED, yeni sürüm üretilir).
    const { plan: v1, item: itemV1 } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    const stalePlan = await proposeContentFallback(owner.id, itemV1.id, { now });
    await prisma.contentPlan.update({ where: { id: v1.id }, data: { status: "SUPERSEDED" } });
    await planFixture(business.id, "APPROVED");
    await expect(acceptContentFallbackProposal(owner.id, stalePlan.proposal!.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.contentFallbackProposal.findUniqueOrThrow({ where: { id: stalePlan.proposal!.id } })).toMatchObject({ status: "INVALIDATED" });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: itemV1.id } })).toMatchObject({ mediaAssetId: null, mediaAvailability: "MISSING" });

    // Öğe yenilendi (REPLACED).
    const { plan, item: replacedItem } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    const staleItem = await proposeContentFallback(owner.id, replacedItem.id, { now });
    await prisma.contentPlanItem.update({ where: { id: replacedItem.id }, data: { status: "REPLACED" } });
    await expect(acceptContentFallbackProposal(owner.id, staleItem.proposal!.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });

    // Öğe revizyonu değişti.
    const revisedItem = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    const staleRevision = await proposeContentFallback(owner.id, revisedItem.id, { now });
    await prisma.contentPlanItem.update({ where: { id: revisedItem.id }, data: { revision: { increment: 1 } } });
    await expect(acceptContentFallbackProposal(owner.id, staleRevision.proposal!.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: revisedItem.id } })).toMatchObject({ mediaAssetId: null, revision: 2 });

    // Medya bu arada başka bir aktif öğeye atandı.
    const contested = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT" });
    const contestedProposal = await proposeContentFallback(owner.id, contested.id, { now });
    expect(contestedProposal.proposal!.mediaAssetId).toBe(media.id);
    await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PRODUCT", mediaAssetId: media.id });
    await expect(acceptContentFallbackProposal(owner.id, contestedProposal.proposal!.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });

    // Medya bu arada kullanıldı (yakınlık koruması içinde).
    const usedMedia = await mediaFixture(business.id, ["PHOTO_PEOPLE"]);
    const usedItem = await itemFixture(plan.id, goalId, { mediaRequirement: "PHOTO_PEOPLE" });
    const usedProposal = await proposeContentFallback(owner.id, usedItem.id, { now });
    expect(usedProposal.proposal!.mediaAssetId).toBe(usedMedia.id);
    await usageFixture(owner.id, business.id, usedMedia.id, daysAgo(1));
    await expect(acceptContentFallbackProposal(owner.id, usedProposal.proposal!.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: usedItem.id } })).toMatchObject({ mediaAssetId: null, mediaAvailability: "MISSING" });

    // Geçersiz kılınmış ve olmayan öneriler.
    await expect(acceptContentFallbackProposal(owner.id, usedProposal.proposal!.id, { now })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(acceptContentFallbackProposal(owner.id, "missing-proposal", { now })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("acceptance is idempotent: a second accept returns the same result and does not re-apply the change", async () => {
    const { owner, business, goalId } = await fixture();
    const { plan, item } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    const media = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const { proposal } = await proposeContentFallback(owner.id, item.id, { now });
    const first = await acceptContentFallbackProposal(owner.id, proposal!.id, { now });
    const later = new Date(now.getTime() + 60_000);
    const second = await acceptContentFallbackProposal(owner.id, proposal!.id, { now: later });
    expect(second).toEqual(first);
    expect(second.acceptedAt?.toISOString()).toBe(now.toISOString());
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ mediaAssetId: media.id, mediaAvailability: "AVAILABLE", revision: 1 });
    expect(await prisma.captureRequest.count({ where: { contentPlanItemId: item.id, status: "FULFILLED" } })).toBe(1);
    // Kabul edilen öneri açık listede görünmez (UI sözleşmesi).
    expect((await listContentFallbackProposals(owner.id, plan.id)).has(item.id)).toBe(false);
  });

  it("concurrent duplicate acceptance applies the change exactly once and every caller converges on the accepted proposal", async () => {
    const { owner, business, goalId } = await fixture();
    const { item } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    const media = await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const { proposal } = await proposeContentFallback(owner.id, item.id, { now });

    const results = await Promise.all(Array.from({ length: 4 }, () => acceptContentFallbackProposal(owner.id, proposal!.id, { now })));
    for (const result of results) expect(result).toMatchObject({ id: proposal!.id, status: "ACCEPTED", acceptedById: owner.id });
    expect(new Set(results.map((result) => result.acceptedAt?.toISOString())).size).toBe(1);
    expect(await prisma.contentFallbackProposal.count({ where: { contentPlanItemId: item.id } })).toBe(1);
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ mediaAssetId: media.id, mediaAvailability: "AVAILABLE" });
    expect(await prisma.captureRequest.findMany({ where: { contentPlanItemId: item.id } })).toHaveLength(1);
  });

  it("proposal creation is safe under concurrent requests: one open proposal per item", async () => {
    const { owner, business, goalId } = await fixture();
    const { item } = await missingItemWithCapture(business, goalId, "PHOTO_PRODUCT");
    await mediaFixture(business.id, ["PHOTO_PRODUCT"]);
    const results = await Promise.all(Array.from({ length: 4 }, () => proposeContentFallback(owner.id, item.id, { now })));
    const ids = new Set(results.map((result) => result.proposal!.id));
    expect(ids.size).toBe(1);
    expect(await prisma.contentFallbackProposal.count({ where: { contentPlanItemId: item.id, status: "PROPOSED" } })).toBe(1);
  });

  it("DomainError codes are surfaced as DomainError instances for the UI layer", async () => {
    const { owner } = await fixture();
    await expect(proposeContentFallback(owner.id, "nope", { now })).rejects.toBeInstanceOf(DomainError);
  });
});
