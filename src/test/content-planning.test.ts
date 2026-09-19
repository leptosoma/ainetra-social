import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  approveContentPlan,
  assignPlanItemMedia,
  ensureContentStrategy,
  generateContentPlan,
  regenerateContentPlan,
  regenerateContentPlanItem,
  saveCustomizedContentStrategy,
  acceptRecommendedContentStrategy,
  getContentStrategyDisplay,
} from "@/features/content-planning/service";
import { updateMediaPlanningTags } from "@/features/media/service";
import { LocalContentPlanningProvider } from "@/features/content-planning/providers/local";
import type { ContentPlanningProvider, ContentPlanningProviderInput } from "@/features/content-planning/providers";
import { getActivePlatformRules } from "@/features/platform-intelligence/service";

async function seedRules(businessId?: string) {
  const base = { businessId: businessId ?? null, effectiveFrom: new Date("2026-01-01"), reviewedAt: new Date("2026-09-18"), confidence: 0.8, sectorScope: ["RESTAURANT"], active: true };
  for (const [platform, frequency, formats, times, mix] of [
    ["INSTAGRAM", 2, ["POST", "REEL"], ["12:30", "19:30"], { PRODUCT: 50, ATMOSPHERE: 50 }],
    ["FACEBOOK", 2, ["POST", "REEL"], ["12:00", "18:30"], { PRODUCT: 40, PEOPLE: 30, EDUCATIONAL: 30 }],
    ["TIKTOK", 2, ["REEL"], ["18:30", "21:00"], { PRODUCT: 40, BEHIND_THE_SCENES: 40, TREND: 20 }],
  ] as const) {
    await prisma.platformRule.createMany({ data: [
      { ...base, platform, contentType: null, category: "FREQUENCY", ruleKey: "ainetra.frequency.test", value: { recommendedPerWeek: frequency }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE" },
      { ...base, platform, contentType: null, category: "FORMAT", ruleKey: "ainetra.format.planning", value: { contentTypes: formats }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE" },
      { ...base, platform, contentType: null, category: "POSTING_TIME", ruleKey: "ainetra.time.test", value: { localTimes: times }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE" },
      { ...base, platform, contentType: null, category: "CONTENT_DIVERSITY", ruleKey: "ainetra.mix.test", value: { recommendedMix: mix }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE" },
      { ...base, platform, contentType: null, category: "CTA", ruleKey: `${platform.toLowerCase()}.cta.test`, value: { instruction: "Net CTA" }, recommendationType: "BEST_PRACTICE", source: "VERIFIED_INTERNAL_ANALYSIS" },
    ] });
  }
}

async function fixture(options: { timezone?: string; confirmedSecret?: boolean } = {}) {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `plan-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `plan-out-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({ data: {
    name: "Mimoza", sector: "RESTAURANT", location: "Bodrum", timezone: options.timezone ?? "Europe/Istanbul",
    memberships: { create: { userId: owner.id, role: "OWNER" } },
    brandProfile: { create: { description: "Ege mutfağı restoranı", productsSummary: "Ege mutfağı ve steak", targetAudience: "Bodrum misafirleri", languages: ["tr", "en"] } },
    goals: { create: [{ type: "RESERVATIONS", priority: "PRIMARY" }, { type: "BRAND_AWARENESS", priority: "SECONDARY" }] },
  } });
  const otherBusiness = await prisma.business.create({ data: { name: "Other", sector: "HOTEL", memberships: { create: { userId: outsider.id, role: "OWNER" } } } });
  if (options.confirmedSecret !== false) await prisma.businessAttribute.create({ data: { businessId: business.id, category: "FACT", key: "fact.seasonal", value: "Mevsimsel ürünler", source: "USER", verificationStatus: "CONFIRMED", isCanonical: true, confirmedById: owner.id } });
  await seedRules();
  await acceptRecommendedContentStrategy(owner.id, business.id);
  return { owner, outsider, business, otherBusiness };
}

function mutateProvider(mutate: (output: Awaited<ReturnType<LocalContentPlanningProvider["generate"]>>, input: ContentPlanningProviderInput) => unknown): ContentPlanningProvider {
  const local = new LocalContentPlanningProvider();
  return { provider: "test", model: "mutator-v1", async generate(input) { const output = structuredClone(await local.generate(input)); return mutate(output, input); } };
}

async function planFixture() {
  const data = await fixture();
  const plan = await generateContentPlan(data.owner.id, data.business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true });
  return { ...data, plan };
}

describe("Ainetra Phase 3 content planning", () => {
  it("enforces tenant isolation for strategies", async () => {
    const { outsider, business } = await fixture();
    await expect(ensureContentStrategy(outsider.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sends only canonical context to the provider", async () => {
    const { owner, business } = await fixture();
    await prisma.businessAttribute.create({ data: { businessId: business.id, category: "NOTE", key: "note.hidden", value: "GIZLI-ONAYSIZ-SINYAL", source: "AI_INFERENCE", confidence: 0.5, verificationStatus: "NEEDS_CONFIRMATION" } });
    let captured = "";
    const provider = mutateProvider((output, input) => { captured = input.prompt; return output; });
    await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true });
    expect(captured).not.toContain("GIZLI-ONAYSIZ-SINYAL");
    expect(captured).toContain("Mevsimsel ürünler");
  });

  it("excludes NEEDS_CONFIRMATION data from planning", async () => {
    const { owner, business } = await fixture({ confirmedSecret: false });
    await prisma.businessAttribute.create({ data: { businessId: business.id, category: "FACT", key: "fact.unconfirmed", value: "Sadece cuma açık", source: "AI_INFERENCE", confidence: 0.6, verificationStatus: "NEEDS_CONFIRMATION" } });
    const contextProbe = mutateProvider((output, input) => { expect(input.context.facts).not.toContain("Sadece cuma açık"); return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider: contextProbe, skipRateLimit: true, force: true })).resolves.toBeTruthy();
  });

  it("preserves user strategy overrides during full regeneration", async () => {
    const { owner, business } = await fixture();
    await saveCustomizedContentStrategy(owner.id, business.id, { mode: "CUSTOM", platformSettings: [{ platform: "INSTAGRAM", enabled: true, weeklyFrequency: 2, contentTypes: ["POST"] }], contentMix: [{ pillar: "PRODUCT", percentage: 50 }, { pillar: "ATMOSPHERE", percentage: 50 }], languages: ["tr"] });
    const plan = await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true, force: true });
    const before = await prisma.contentStrategy.findUniqueOrThrow({ where: { businessId: business.id } });
    await regenerateContentPlan(owner.id, plan.id, { skipRateLimit: true });
    const after = await prisma.contentStrategy.findUniqueOrThrow({ where: { businessId: business.id } });
    expect(after.mode).toBe("CUSTOM");
    expect(after.version).toBe(before.version);
    expect(after.platformSettings).toEqual(before.platformSettings);
  });

  it("rejects an output goal that is not owned by the business", async () => {
    const { owner, business } = await fixture();
    const provider = mutateProvider((output) => { output.contentItems[0].businessGoal = "EVENT"; return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects media owned by another business", async () => {
    const { owner, otherBusiness, plan } = await planFixture();
    const media = await prisma.mediaAsset.create({ data: { businessId: otherBusiness.id, type: "IMAGE", originalFilename: "other.jpg", mimeType: "image/jpeg", size: 10, storageKey: `other/${crypto.randomUUID()}.jpg`, tags: ["PHOTO_PRODUCT"] } });
    await expect(assignPlanItemMedia(owner.id, plan.items[0].id, media.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires content mix to total 100", async () => {
    const { owner, business } = await fixture();
    await expect(saveCustomizedContentStrategy(owner.id, business.id, { mode: "CUSTOM", platformSettings: [{ platform: "INSTAGRAM", enabled: true, weeklyFrequency: 2, contentTypes: ["POST"] }], contentMix: [{ pillar: "PRODUCT", percentage: 40 }, { pillar: "ATMOSPHERE", percentage: 40 }], languages: ["tr"] })).rejects.toBeTruthy();
  });

  it("does not write a plan for invalid structured output", async () => {
    const { owner, business } = await fixture();
    const provider: ContentPlanningProvider = { provider: "test", model: "invalid", async generate() { return { broken: true }; } };
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.contentPlan.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("rejects a hallucinated product", async () => {
    const { owner, business } = await fixture();
    const provider = mutateProvider((output) => { const item = output.contentItems.find((candidate) => candidate.pillar === "PRODUCT")!; item.topic = "Sushi menüsü"; item.concept = "Sushi menüsünü göster"; item.hook = "Yeni sushi menüsü"; item.captionDirection = "Sushi çeşitlerini anlat"; return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("stores the business timezone on the plan", async () => {
    const { owner, business } = await fixture({ timezone: "Europe/Istanbul" });
    const plan = await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true });
    expect(plan.timezone).toBe("Europe/Istanbul");
  });

  it("rejects invalid business timezones", async () => {
    const { owner, business } = await fixture({ timezone: "Mars/Olympus" });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a plan with four identical adjacent pillars", async () => {
    const { owner, business } = await fixture();
    const provider = mutateProvider((output) => { output.contentItems.slice(0, 4).forEach((item) => { item.pillar = "ATMOSPHERE"; }); return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects promotional saturation above the selected mix", async () => {
    const { owner, business } = await fixture();
    const provider = mutateProvider((output) => { output.contentItems.forEach((item) => { item.pillar = "PROMOTIONAL"; }); return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not apply one platform's rule to another platform", async () => {
    const { owner, business } = await fixture();
    const provider = mutateProvider((output) => { const item = output.contentItems.find((candidate) => candidate.platform === "FACEBOOK")!; item.platformRulesApplied = ["instagram.cta.test"]; return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("excludes inactive rules", async () => {
    const { owner, business } = await fixture();
    await prisma.platformRule.create({ data: { platform: "INSTAGRAM", category: "HOOK", ruleKey: "inactive.rule", value: {}, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", effectiveFrom: new Date("2026-01-01"), reviewedAt: new Date(), confidence: 1, active: false } });
    expect((await getActivePlatformRules(owner.id, business.id)).some((rule) => rule.ruleKey === "inactive.rule")).toBe(false);
  });

  it("excludes expired rules", async () => {
    const { owner, business } = await fixture();
    await prisma.platformRule.create({ data: { platform: "INSTAGRAM", category: "HOOK", ruleKey: "expired.rule", value: {}, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", effectiveFrom: new Date("2025-01-01"), expiresAt: new Date("2025-12-31"), reviewedAt: new Date("2025-01-01"), confidence: 1 } });
    expect((await getActivePlatformRules(owner.id, business.id, { asOf: new Date("2026-09-18") })).some((rule) => rule.ruleKey === "expired.rule")).toBe(false);
  });

  it("keeps an approved strategy approved after plan regeneration", async () => {
    const { owner, business, plan } = await planFixture();
    await regenerateContentPlan(owner.id, plan.id, { skipRateLimit: true });
    expect((await prisma.contentStrategy.findUniqueOrThrow({ where: { businessId: business.id } })).approvedAt).not.toBeNull();
  });

  it("marks missing media without blocking the plan", async () => {
    const { plan } = await planFixture();
    expect(plan.items.some((item) => item.mediaAvailability === "MISSING")).toBe(true);
  });

  it("keeps plan approval separate from publish approval", async () => {
    const { owner, plan } = await planFixture();
    await approveContentPlan(owner.id, plan.id);
    expect((await prisma.contentPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("APPROVED");
    expect(await prisma.approval.count()).toBe(0);
  });

  it("regenerates one item without changing the other active items", async () => {
    const { owner, plan } = await planFixture();
    const target = plan.items[0];
    const untouched = plan.items.slice(1).map((item) => item.id);
    const replacement = await regenerateContentPlanItem(owner.id, target.id);
    const activeIds = (await prisma.contentPlanItem.findMany({ where: { planId: plan.id, status: "ACTIVE" } })).map((item) => item.id);
    expect(replacement.replacesItemId).toBe(target.id);
    expect(activeIds).toEqual(expect.arrayContaining(untouched));
    expect(activeIds).not.toContain(target.id);
  });

  it("allows seven-day and thirty-day plans to coexist", async () => {
    const { owner, business } = await fixture();
    await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true });
    await generateContentPlan(owner.id, business.id, { period: "THIRTY_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true });
    expect(await prisma.contentPlan.count({ where: { businessId: business.id, status: { not: "SUPERSEDED" } } })).toBe(2);
  });

  it("rejects internal chain-of-thought as item reasoning", async () => {
    const { owner, business } = await fixture();
    const provider = mutateProvider((output) => { output.contentItems[0].reasoning = "Adım adım düşündüm ve iç mantığımı burada açıklıyorum."; return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("preserves an existing plan when the provider fails", async () => {
    const { owner, plan } = await planFixture();
    const failing: ContentPlanningProvider = { provider: "test", model: "failure", async generate() { throw new Error("offline"); } };
    await expect(regenerateContentPlan(owner.id, plan.id, { provider: failing, skipRateLimit: true })).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect((await prisma.contentPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("DRAFT");
  });

  it("creates plan history on full regeneration", async () => {
    const { owner, business, plan } = await planFixture();
    const next = await regenerateContentPlan(owner.id, plan.id, { skipRateLimit: true });
    expect(next.version).toBe(2);
    expect(next.supersedesId).toBe(plan.id);
    expect((await prisma.contentPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("SUPERSEDED");
    expect(await prisma.contentPlan.count({ where: { businessId: business.id } })).toBe(2);
  });

  it("rejects a language outside the user's strategy", async () => {
    const { owner, business } = await fixture();
    await saveCustomizedContentStrategy(owner.id, business.id, { mode: "CUSTOM", platformSettings: [{ platform: "INSTAGRAM", enabled: true, weeklyFrequency: 2, contentTypes: ["POST"] }], contentMix: [{ pillar: "PRODUCT", percentage: 50 }, { pillar: "ATMOSPHERE", percentage: 50 }], languages: ["tr"] });
    const provider = mutateProvider((output) => { output.contentItems[0].language = "en"; return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects canonical avoid words in generated copy", async () => {
    const { owner, business } = await fixture();
    await prisma.businessAttribute.create({ data: { businessId: business.id, category: "AVOID_WORD", key: "avoid.best", value: "en iyi", source: "USER", verificationStatus: "CONFIRMED", isCanonical: true, confirmedById: owner.id } });
    const provider = mutateProvider((output) => { output.contentItems[0].hook = "Bodrum'un en iyi deneyimi"; return output; });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("avoids duplicate provider work for identical inputs", async () => {
    const { owner, business } = await fixture();
    let calls = 0;
    const provider = mutateProvider((output) => { calls += 1; return output; });
    const first = await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true });
    const second = await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true });
    expect(second.id).toBe(first.id);
    expect(calls).toBe(1);
  });

  it("matches media by business metadata tags", async () => {
    const { owner, business } = await fixture();
    const media = await prisma.mediaAsset.create({ data: { businessId: business.id, type: "IMAGE", originalFilename: "product.jpg", mimeType: "image/jpeg", size: 10, storageKey: `media/${crypto.randomUUID()}.jpg`, tags: ["PHOTO_PRODUCT"] } });
    const plan = await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true });
    const product = plan.items.find((item) => item.mediaRequirement === "PHOTO_PRODUCT");
    expect(product?.mediaAssetId).toBe(media.id);
    expect(product?.mediaAvailability).toBe("AVAILABLE");
  });

  it("keeps strategy preview read-only until the user accepts it", async () => {
    const { owner, business } = await fixture();
    await prisma.contentStrategy.delete({ where: { businessId: business.id } });
    const preview = await getContentStrategyDisplay(owner.id, business.id);
    expect(preview.record).toBeNull();
    expect(await prisma.contentStrategy.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("stores the strategy used by each plan version", async () => {
    const { owner, business } = await fixture();
    const first = await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true });
    await saveCustomizedContentStrategy(owner.id, business.id, { mode: "CUSTOM", platformSettings: [{ platform: "INSTAGRAM", enabled: true, weeklyFrequency: 2, contentTypes: ["POST"] }], contentMix: [{ pillar: "PRODUCT", percentage: 50 }, { pillar: "ATMOSPHERE", percentage: 50 }], languages: ["tr"] });
    const second = await generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { skipRateLimit: true });
    expect(first.strategySnapshot).not.toEqual(second.strategySnapshot);
    expect(first.platformStrategies).not.toEqual(second.platformStrategies);
    expect((await prisma.contentPlan.findUniqueOrThrow({ where: { id: first.id } })).strategySnapshot).toEqual(first.strategySnapshot);
  });

  it("updates plan media availability when image tags change", async () => {
    const { owner, business, plan } = await planFixture();
    const asset = await prisma.mediaAsset.create({ data: { businessId: business.id, type: "IMAGE", originalFilename: "product.jpg", mimeType: "image/jpeg", size: 10, storageKey: `media/${crypto.randomUUID()}.jpg`, tags: [] } });
    const product = plan.items.find((item) => item.mediaRequirement === "PHOTO_PRODUCT")!;
    expect(product.mediaAvailability).toBe("MISSING");
    await updateMediaPlanningTags(owner.id, asset.id, ["PHOTO_PRODUCT"]);
    expect(await prisma.contentPlanItem.findUnique({ where: { id: product.id } })).toMatchObject({ mediaAssetId: asset.id, mediaAvailability: "AVAILABLE" });
    await updateMediaPlanningTags(owner.id, asset.id, []);
    expect(await prisma.contentPlanItem.findUnique({ where: { id: product.id } })).toMatchObject({ mediaAssetId: null, mediaAvailability: "MISSING" });
  });

  it("records failed provider calls and limits further generation", async () => {
    const { owner, business } = await fixture();
    const failing: ContentPlanningProvider = { provider: "test", model: "failure", async generate() { throw new Error("offline"); } };
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider: failing })).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(await prisma.contentPlanningRun.findFirst({ where: { businessId: business.id } })).toMatchObject({ scope: "PLAN", status: "FAILED", errorCode: "PROVIDER_FAILED" });
    await prisma.contentPlanningRun.createMany({ data: Array.from({ length: 9 }, (_, index) => ({ businessId: business.id, triggeredById: owner.id, period: "SEVEN_DAYS" as const, scope: "ITEM", provider: "test", model: "test", promptVersion: "test", inputHash: `limit-${index}`, status: "FAILED" as const })) });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider: failing })).rejects.toThrow(/en fazla 10/);
  });

  it("keeps superseded plan history immutable", async () => {
    const { owner, plan } = await planFixture();
    await regenerateContentPlan(owner.id, plan.id, { skipRateLimit: true });
    await expect(regenerateContentPlan(owner.id, plan.id, { skipRateLimit: true })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(regenerateContentPlanItem(owner.id, plan.items[0].id, { skipRateLimit: true })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("creates a new version after an item was regenerated", async () => {
    const { owner, plan } = await planFixture();
    await regenerateContentPlanItem(owner.id, plan.items[0].id, { skipRateLimit: true });
    const next = await regenerateContentPlan(owner.id, plan.id, { skipRateLimit: true });
    expect(next.id).not.toBe(plan.id);
    expect(next.version).toBe(2);
  });

  it("returns one stored plan for concurrent identical requests", async () => {
    const { owner, business } = await fixture();
    const local = new LocalContentPlanningProvider();
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const provider: ContentPlanningProvider = { provider: "test", model: "barrier", async generate(input) { arrivals += 1; if (arrivals === 2) release(); await gate; return local.generate(input); } };
    const [first, second] = await Promise.all([
      generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true }),
      generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true }),
    ]);
    expect(first.id).toBe(second.id);
    expect(await prisma.contentPlan.count({ where: { businessId: business.id } })).toBe(1);
  });

  it("rejects copied concepts across platforms for the same topic", async () => {
    const { owner, business } = await fixture();
    const provider = mutateProvider((output) => {
      const product = output.contentItems.find((item) => item.pillar === "PRODUCT")!;
      const other = output.contentItems.find((item) => item.platform !== product.platform)!;
      other.topic = product.topic;
      other.concept = product.concept;
      return output;
    });
    await expect(generateContentPlan(owner.id, business.id, { period: "SEVEN_DAYS", startDate: "2026-10-05" }, { provider, skipRateLimit: true, force: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not silently replace a plan item linked to real content", async () => {
    const { owner, business, plan } = await planFixture();
    const target = plan.items[0];
    const content = await prisma.contentItem.create({ data: { businessId: business.id, goalId: target.goalId, title: "Bağlı içerik", topic: target.topic, contentType: target.contentType } });
    await prisma.contentPlanItem.update({ where: { id: target.id }, data: { contentItemId: content.id } });
    await expect(regenerateContentPlanItem(owner.id, target.id, { skipRateLimit: true })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
