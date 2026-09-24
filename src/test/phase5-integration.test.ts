import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { allowedPlanningTagsFor, updateMediaPlanningTags, uploadMedia } from "@/features/media/service";
import { analyzeMediaAsset } from "@/features/visual-analysis/service";
import { DevelopmentImageAnalysisProvider } from "@/features/visual-analysis/providers/development";
import { createSafeEnhancement, keepSafeEnhancement } from "@/features/safe-enhance/service";
import { DevelopmentSharpTransformProvider } from "@/features/safe-enhance/providers/development";
import { createBrandStyle, keepBrandStyle } from "@/features/brand-style/service";
import { createSocialVariant, keepSocialVariant } from "@/features/social-variant/service";
import { DevelopmentSharpReframeProvider } from "@/features/social-variant/providers/development";
import { createCreativeCampaign, keepCreativeCampaign } from "@/features/creative-campaign/service";
import { LocalTemplateCreativeProvider } from "@/features/creative-campaign/providers/local";
import { calculateContentStock } from "@/features/content-stock/service";
import { acceptContentFallbackProposal, proposeContentFallback } from "@/features/content-fallback/service";

// P5-05 Phase 5 entegrasyon testleri. Burada yalnızca ÇAPRAZ modül davranışı sınanır; her adımın
// kendi testleri yerinde durur ve tekrar edilmez. Sorular:
//  - Kabul edilmiş özgün türev zinciri (yükleme → analiz → güvenli iyileştirme → marka stili →
//    sosyal varyant) baştan sona özgün kalıyor mu, orijinal satır ve baytları değişmeden duruyor mu?
//  - Tasarım kreatifi bu zincirin soyuna bağlanıyor ama özgün medyadan AYRI mı kalıyor?
//  - Content Stock ve Fallback bu ayrımı okuyor mu; medya kabulü içerik onayı/yayın yapıyor mu?
//  - Kiracı sınırı zincirin her adımında duruyor mu ve Business Brain hiçbir adımda değişiyor mu?

async function businessFixture(suffix = "") {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `p5-owner-${suffix}${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: { name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul", memberships: { create: { userId: owner.id, role: "OWNER" } } },
  });
  return { owner, business };
}

function confirmedFact(businessId: string, category: "DESCRIPTION" | "PRODUCTS_SERVICES" | "FACT", value: string) {
  return prisma.businessAttribute.create({
    data: {
      businessId, category, key: `${category.toLowerCase()}.${crypto.randomUUID()}`, value, source: "USER",
      verificationStatus: "CONFIRMED", isCanonical: true, confirmedAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  });
}

async function aspectRule(businessId: string, contentType: "POST" | "STORY", recommended: string) {
  return prisma.platformRule.create({
    data: {
      businessId, platform: "INSTAGRAM", contentType, category: "ASPECT_RATIO",
      ruleKey: `test.aspect.instagram.${contentType.toLowerCase()}`,
      value: { recommended }, recommendationType: "BEST_PRACTICE", source: "MANUAL_ADMIN_RULE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
      confidence: 0.9, sectorScope: [], active: true,
    },
  });
}

async function instagramRules(businessId: string) {
  await aspectRule(businessId, "POST", "4:5");
  await aspectRule(businessId, "STORY", "9:16");
}

/** Ton geçişi olan kaynak: iyileştirme ve kırpma gerçekten piksele dokunsun. */
async function jpegBytes(width: number, height: number) {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      raw[offset] = (x * 255) / width;
      raw[offset + 1] = (y * 255) / height;
      raw[offset + 2] = 90;
    }
  }
  const buffer = await sharp(raw, { raw: { width, height, channels } }).jpeg({ quality: 88 }).toBuffer();
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

async function imageFixture(userId: string, businessId: string, tags: string[] = ["PHOTO_PRODUCT"]) {
  const file = new File([await jpegBytes(900, 1000)], "urun.jpg", { type: "image/jpeg" });
  return uploadMedia(userId, businessId, file, tags);
}

async function storedHash(key: string) {
  const object = await storage.get(key);
  return object ? createHash("sha256").update(object.bytes).digest("hex") : null;
}

/**
 * Tam özgün türev zinciri: yükleme → analiz → güvenli iyileştirme (Sakla) → marka stili (Sakla) →
 * sosyal varyant (Sakla). Her adımda kullanıcının açık kararı vardır.
 */
async function authenticChain(userId: string, businessId: string) {
  const original = await imageFixture(userId, businessId);
  const analysis = await analyzeMediaAsset(userId, original.id, { provider: new DevelopmentImageAnalysisProvider(), skipRateLimit: true });

  const enhancement = await createSafeEnhancement(userId, original.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
  const keptEnhancement = await keepSafeEnhancement(userId, enhancement!.id);
  const enhanced = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: keptEnhancement.outputAssetId! } });

  const brandStyle = await createBrandStyle(userId, enhanced.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
  const keptBrandStyle = await keepBrandStyle(userId, brandStyle!.id);
  const branded = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: keptBrandStyle.outputAssetId! } });

  const variant = await createSocialVariant(userId, branded.id, "INSTAGRAM", "FEED", { provider: new DevelopmentSharpReframeProvider(), skipRateLimit: true });
  const keptVariant = await keepSocialVariant(userId, variant!.id);
  const variantAsset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: keptVariant.outputAssetId! } });

  return { original, analysis, enhancement: keptEnhancement, enhanced, brandStyle: keptBrandStyle, branded, variant: keptVariant, variantAsset };
}

/** Onaylanmış bir strateji ve APPROVED bir plan; medya kabulünün planı değiştirmediği buradan görülür. */
async function planFixture(businessId: string) {
  const goal = await prisma.businessGoal.create({ data: { businessId, type: "RESERVATIONS", priority: "PRIMARY" } });
  const strategy = await prisma.contentStrategy.create({
    data: { businessId, mode: "CUSTOM", platformSettings: [], contentMix: [], languages: ["tr"], rationale: "test", approvedAt: new Date() },
  });
  const plan = await prisma.contentPlan.create({
    data: {
      businessId, strategyId: strategy.id, period: "SEVEN_DAYS",
      startDate: new Date("2026-10-05T00:00:00.000Z"), endDate: new Date("2026-10-11T00:00:00.000Z"), version: 1, status: "APPROVED",
      timezone: "Europe/Istanbul", strategySummary: "test", strategySnapshot: {}, platformStrategies: {}, contentMix: {},
      provider: "test", model: "test", promptVersion: "test", inputHash: crypto.randomUUID(),
    },
  });
  const item = (requirement: "CUSTOM_GRAPHIC" | "PHOTO_PRODUCT") => prisma.contentPlanItem.create({
    data: {
      planId: plan.id, goalId: goal.id, platform: "INSTAGRAM", contentType: "POST",
      plannedDate: new Date("2026-10-09T00:00:00.000Z"), recommendedTime: "19:30",
      pillar: "PRODUCT", topic: "Bilgi", concept: "Bilgi ver", hookCategory: "curiosity", hook: "Yeni",
      captionDirection: "Kısa", cta: "Arayın", language: "tr",
      mediaRequirement: requirement, mediaAvailability: "MISSING", status: "ACTIVE", reasoning: "test", platformRulesApplied: [],
    },
  });
  return { goal, strategy, plan, item };
}

describe("Ainetra P5-05 — Phase 5 integration", () => {
  it("carries authenticity through the whole derivative chain and never touches the original row or bytes", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const chain = await authenticChain(owner.id, business.id);
    const originalHash = await storedHash(chain.original.storageKey);

    // Zincir: yükleme → güvenli iyileştirme → marka stili → sosyal varyant. Her halka bir öncekini
    // AÇIKÇA gösterir; kök her zaman kullanıcının yüklediği orijinaldir.
    expect(chain.enhanced).toMatchObject({ origin: "SAFE_ENHANCE", derivedFromId: chain.original.id });
    expect(chain.branded).toMatchObject({ origin: "BRAND_STYLE", derivedFromId: chain.enhanced.id });
    expect(chain.variantAsset).toMatchObject({ origin: "SOCIAL_VARIANT", derivedFromId: chain.branded.id });
    expect(chain.variant).toMatchObject({ sourceAssetId: chain.branded.id, rootAssetId: chain.original.id, decision: "KEPT" });
    expect(chain.brandStyle).toMatchObject({ sourceAssetId: chain.enhanced.id, sourceEnhancementId: chain.enhancement.id });

    // Teknik türev ÖZGÜN kalır: gerçek fotoğraf gereksinimi için işaretlenebilir ve her adımda
    // ayrı bir kullanılabilir MediaAsset'tir.
    for (const asset of [chain.enhanced, chain.branded, chain.variantAsset]) {
      expect(allowedPlanningTagsFor(asset)).toContain("PHOTO_PRODUCT");
      expect((await updateMediaPlanningTags(owner.id, asset.id, ["PHOTO_PRODUCT"])).tags).toEqual(["PHOTO_PRODUCT"]);
      expect(await storage.get(asset.storageKey)).not.toBeNull();
      expect(asset.storageKey).not.toBe(chain.original.storageKey);
    }

    // Orijinal satır ve baytları hiçbir adımda değişmedi; analiz işaretçisi dışında dokunulmadı.
    const originalNow = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: chain.original.id } });
    expect(originalNow).toMatchObject({
      origin: "UPLOAD", derivedFromId: null, storageKey: chain.original.storageKey,
      size: chain.original.size, width: chain.original.width, height: chain.original.height,
      originalFilename: chain.original.originalFilename, currentAnalysisId: chain.analysis!.id,
    });
    expect(await storedHash(chain.original.storageKey)).toBe(originalHash);

    // Geçmiş sürümler korunur: yeniden analiz eskisini silmez, yalnızca güncel işaretçiyi taşır.
    const reanalysis = await analyzeMediaAsset(owner.id, chain.original.id, { provider: new DevelopmentImageAnalysisProvider(), skipRateLimit: true });
    expect(reanalysis).toMatchObject({ version: 2, status: "SUCCEEDED", supersededAt: null });
    expect(await prisma.mediaAnalysis.findUniqueOrThrow({ where: { id: chain.analysis!.id } })).toMatchObject({ version: 1, status: "SUCCEEDED" });
    expect((await prisma.mediaAnalysis.findUniqueOrThrow({ where: { id: chain.analysis!.id } })).supersededAt).not.toBeNull();
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: chain.original.id } })).currentAnalysisId).toBe(reanalysis!.id);
    // Provenans dürüstlüğü zincir boyunca korunur: geliştirme sağlayıcısı REAL olarak sunulmaz.
    expect(reanalysis).toMatchObject({ provider: "development-pixel-stats", provenance: "DEVELOPMENT" });
  });

  it("keeps a designed creative separate from the authentic chain even when it is built on one of its derivatives", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "PRODUCTS_SERVICES", "Taze balık ve mevsim mezeleri sunuyoruz.");
    const chain = await authenticChain(owner.id, business.id);
    const variantHash = await storedHash(chain.variantAsset.storageKey);

    const campaign = await createCreativeCampaign(owner.id, business.id, "PRODUCTS_SERVICES", "INSTAGRAM", "FEED", {
      provider: new LocalTemplateCreativeProvider(), skipRateLimit: true, sourceAssetId: chain.variantAsset.id,
    });
    // Soy açık: hem doğrudan kaynak hem de zincirin kökü kayda geçer.
    expect(campaign).toMatchObject({ status: "SUCCEEDED", sourceAssetId: chain.variantAsset.id, rootAssetId: chain.original.id });

    const kept = await keepCreativeCampaign(owner.id, campaign!.id);
    const design = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });

    // Ama sonuç TASARIMDIR: özgün zincirin kökenini ve etiketlerini devralmaz.
    expect(design).toMatchObject({ origin: "CREATIVE_CAMPAIGN", derivedFromId: chain.variantAsset.id, tags: ["CUSTOM_GRAPHIC"] });
    expect(allowedPlanningTagsFor(design)).toEqual(["CUSTOM_GRAPHIC"]);
    await expect(updateMediaPlanningTags(owner.id, design.id, ["PHOTO_PRODUCT"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Kullanılan özgün türev olduğu gibi durur ve kendi kimliğini korur.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: chain.variantAsset.id } })).toMatchObject({ origin: "SOCIAL_VARIANT", tags: chain.variantAsset.tags });
    expect(await storedHash(chain.variantAsset.storageKey)).toBe(variantHash);
    expect(design.storageKey).not.toBe(chain.variantAsset.storageKey);

    // Tasarım, özgün zincirin üstüne yeni bir teknik türev kuramaz.
    await expect(createSocialVariant(owner.id, design.id, "INSTAGRAM", "STORY", { provider: new DevelopmentSharpReframeProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createSafeEnhancement(owner.id, design.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lets Content Stock and Fallback read the authentic/designed split and treats a design as a custom-graphic answer only", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "FACT", "Rezervasyon telefonla alınır.");
    const chain = await authenticChain(owner.id, business.id);
    // Zincirin sonundaki özgün türev gerçek fotoğraf ihtiyacı için işaretlenir.
    await updateMediaPlanningTags(owner.id, chain.variantAsset.id, ["PHOTO_PRODUCT"]);

    const campaign = await createCreativeCampaign(owner.id, business.id, "CONFIRMED_FACTS", "INSTAGRAM", "FEED", { provider: new LocalTemplateCreativeProvider(), skipRateLimit: true });
    const kept = await keepCreativeCampaign(owner.id, campaign!.id);
    const design = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });

    const { item } = await planFixture(business.id);
    const graphicItem = await item("CUSTOM_GRAPHIC");
    const photoItem = await item("PHOTO_PRODUCT");
    const now = new Date("2026-10-05T10:00:00.000Z");

    // Content Stock: tasarım yalnızca özel tasarım ihtiyacını, özgün türev yalnızca fotoğraf
    // ihtiyacını karşılar. Kabul edilmemiş ara türevler de kütüphanede kullanılabilir durur.
    const report = await calculateContentStock(business.id, { now });
    expect(report.byRequirement).toEqual(expect.arrayContaining([
      { mediaRequirement: "CUSTOM_GRAPHIC", upcoming: 1, covered: 1, missing: 0 },
      { mediaRequirement: "PHOTO_PRODUCT", upcoming: 1, covered: 1, missing: 0 },
    ]));

    // Fallback: özel tasarım ihtiyacına AÇIKÇA tasarım olarak önerilir.
    const graphicProposal = await proposeContentFallback(owner.id, graphicItem.id, { now });
    expect(graphicProposal.proposal).toMatchObject({ kind: "EXISTING_DESIGNED_CREATIVE", mediaAssetId: design.id, targetMediaRequirement: "CUSTOM_GRAPHIC" });

    // Fotoğraf ihtiyacına ise tasarım hiçbir koşulda önerilmez; özgün medya seçilir.
    const photoProposal = await proposeContentFallback(owner.id, photoItem.id, { now });
    expect(photoProposal.proposal!.mediaAssetId).not.toBe(design.id);
    expect(photoProposal.proposal!.kind).toBe("UNUSED_AUTHENTIC_MEDIA");

    // Kabul kullanıcının açık eylemidir ve yalnızca plan öğesinin medya alanlarını değiştirir.
    const accepted = await acceptContentFallbackProposal(owner.id, graphicProposal.proposal!.id, { now });
    expect(accepted.status).toBe("ACCEPTED");
    expect(await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: graphicItem.id } }))
      .toMatchObject({ mediaAssetId: design.id, mediaRequirement: "CUSTOM_GRAPHIC", mediaAvailability: "AVAILABLE", status: "ACTIVE" });
  });

  it("does not approve, schedule or publish anything when media and designs are accepted", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "DESCRIPTION", "Deniz kenarında aile restoranı.");
    const { plan } = await planFixture(business.id);

    const chain = await authenticChain(owner.id, business.id);
    const campaign = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", {
      provider: new LocalTemplateCreativeProvider(), skipRateLimit: true, sourceAssetId: chain.variantAsset.id,
    });
    await keepCreativeCampaign(owner.id, campaign!.id);

    // Medya kabulü içerik onayı, sürüm, zamanlama veya yayın yaratmaz; plan durumu da değişmez.
    expect(await prisma.contentItem.count({ where: { businessId: business.id } })).toBe(0);
    expect(await prisma.contentVariant.count({ where: { contentItem: { businessId: business.id } } })).toBe(0);
    expect(await prisma.approval.count({ where: { contentVariant: { contentItem: { businessId: business.id } } } })).toBe(0);
    expect(await prisma.scheduledPost.count({ where: { contentVariant: { contentItem: { businessId: business.id } } } })).toBe(0);
    expect(await prisma.contentPlan.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({ status: "APPROVED", version: 1 });
    // Medya kullanım kaydı da açık bir içerik eylemine bağlıdır; kabul tek başına kullanım yazmaz.
    expect(await prisma.mediaUsage.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("denies every Phase 5 step across tenants and never mutates Business Brain", async () => {
    const { owner, business } = await businessFixture("a");
    const other = await businessFixture("b");
    await instagramRules(business.id);
    await confirmedFact(business.id, "DESCRIPTION", "Bodrum'da deniz ürünleri sunan aile restoranı.");
    const brainBefore = await prisma.businessAttribute.findMany({ where: { businessId: business.id }, orderBy: { id: "asc" } });

    const chain = await authenticChain(owner.id, business.id);
    const campaign = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", {
      provider: new LocalTemplateCreativeProvider(), skipRateLimit: true, sourceAssetId: chain.variantAsset.id,
    });

    // Zincirin her adımı yabancı kiracıya kapalıdır: okuma, üretme ve karar yolları dâhil.
    const foreign = other.owner.id;
    await expect(analyzeMediaAsset(foreign, chain.original.id, { provider: new DevelopmentImageAnalysisProvider(), skipRateLimit: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createSafeEnhancement(foreign, chain.original.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createBrandStyle(foreign, chain.enhanced.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createSocialVariant(foreign, chain.branded.id, "INSTAGRAM", "STORY", { provider: new DevelopmentSharpReframeProvider(), skipRateLimit: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(keepCreativeCampaign(foreign, campaign!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateMediaPlanningTags(foreign, chain.variantAsset.id, ["PHOTO_PRODUCT"])).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Yabancı kiracının medyası bu işletmenin zincirine giremez.
    const foreignAsset = await imageFixture(other.owner.id, other.business.id);
    await expect(createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "STORY", {
      provider: new LocalTemplateCreativeProvider(), skipRateLimit: true, sourceAssetId: foreignAsset.id,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Hiçbir Phase 5 adımı Business Brain'e yazmaz veya mevcut satırları değiştirmez.
    expect(await prisma.businessAttribute.findMany({ where: { businessId: business.id }, orderBy: { id: "asc" } })).toEqual(brainBefore);
    expect(await prisma.mediaAsset.count({ where: { businessId: other.business.id } })).toBe(1);
  });
});
