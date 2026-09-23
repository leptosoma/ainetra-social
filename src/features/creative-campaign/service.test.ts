import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { allowedPlanningTagsFor, updateMediaPlanningTags, uploadMedia } from "@/features/media/service";
import { calculateContentStock } from "@/features/content-stock/service";
import { evaluateContentFallback } from "@/features/content-fallback/service";
import {
  createCreativeCampaign,
  discardCreativeCampaign,
  getCreativeCampaignWorkspace,
  keepCreativeCampaign,
  readCreativeCampaignOutput,
} from "@/features/creative-campaign/service";
import { LocalTemplateCreativeProvider } from "@/features/creative-campaign/providers/local";
import type { CreativeRenderProvider } from "@/features/creative-campaign/providers/types";
import { creativeCategoryDefinitions } from "@/features/creative-campaign/categories";

// P5-04B Kreatif Kampanya testleri. Odak: metnin YALNIZCA kanonik ve ONAYLI Business Brain
// bilgilerinden kurulması, eksik bilgide üretimin durması, tasarımın hiçbir yerde gerçek fotoğraf
// yerine geçmemesi, kabul edilmiş gerçek medyanın arka plan olarak açık soyla kullanılması,
// kiracı sınırı, sürümleme/eşzamanlılık ve Content Stock uyumu.

async function businessFixture(suffix = "") {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `cc-owner-${suffix}${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: { name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul", memberships: { create: { userId: owner.id, role: "OWNER" } } },
  });
  return { owner, business };
}

/** Kanonik ve ONAYLI bir Business Brain bilgisi: kreatif metninin tek meşru kaynağı. */
function confirmedFact(
  businessId: string,
  category: "DESCRIPTION" | "PRODUCTS_SERVICES" | "LOCATION_CONTEXT" | "FACT",
  value: string,
  overrides: { isCanonical?: boolean; verificationStatus?: "CONFIRMED" | "INFERRED" | "NEEDS_CONFIRMATION" | "REJECTED" } = {},
) {
  return prisma.businessAttribute.create({
    data: {
      businessId,
      category,
      key: `${category.toLowerCase()}.${crypto.randomUUID()}`,
      value,
      source: "USER",
      verificationStatus: overrides.verificationStatus ?? "CONFIRMED",
      // Veritabanı kısıtı: yalnızca CONFIRMED bir satır kanonik olabilir.
      isCanonical: overrides.isCanonical ?? (overrides.verificationStatus ?? "CONFIRMED") === "CONFIRMED",
      confirmedAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  });
}

async function aspectRule(businessId: string, platform: "INSTAGRAM" | "FACEBOOK", contentType: "POST" | "STORY" | "REEL", recommended: string) {
  return prisma.platformRule.create({
    data: {
      businessId, platform, contentType, category: "ASPECT_RATIO",
      ruleKey: `test.aspect.${platform.toLowerCase()}.${contentType.toLowerCase()}`,
      value: { recommended },
      recommendationType: "BEST_PRACTICE", source: "MANUAL_ADMIN_RULE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
      confidence: 0.9, sectorScope: [], active: true,
    },
  });
}

/** Instagram Akış (4:5) ve Hikâye (9:16). Kural yoksa hiçbir format sunulmaz. */
async function instagramRules(businessId: string) {
  const post = await aspectRule(businessId, "INSTAGRAM", "POST", "4:5");
  await aspectRule(businessId, "INSTAGRAM", "STORY", "9:16");
  return { post };
}

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

async function storedBytes(key: string) {
  const object = await storage.get(key);
  return object ? createHash("sha256").update(object.bytes).digest("hex") : null;
}

const localProvider = () => new LocalTemplateCreativeProvider();

function fakeProvider(render: (input: { canvas: { width: number; height: number } }) => Promise<unknown> | unknown, delayMs = 0): CreativeRenderProvider {
  return {
    provider: "test-creative", model: "test-model", provenance: "REAL", generative: false,
    async render(input) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return render(input);
    },
  };
}

describe("Ainetra P5-04B — creative campaign", () => {
  it("builds copy only from canonical CONFIRMED facts and records the fact, rule and development provenance snapshot", async () => {
    const { owner, business } = await businessFixture();
    const { post } = await instagramRules(business.id);
    const fact = await confirmedFact(business.id, "DESCRIPTION", "Bodrum'da deniz ürünleri sunan aile restoranı.");

    const campaign = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });

    expect(campaign).toMatchObject({
      status: "SUCCEEDED", decision: null, version: 1, category: "BUSINESS_INTRO",
      platform: "INSTAGRAM", contentType: "POST", format: "FEED", targetAspectRatio: "4:5",
      provider: "development-template-local", model: "none", provenance: "DEVELOPMENT",
      ruleId: post.id, ruleKey: post.ruleKey, outputMimeType: "image/png",
      outputWidth: 1080, outputHeight: 1350, sourceAssetId: null, rootAssetId: null,
      triggeredById: owner.id, outputAssetId: null,
    });

    // Metnin her satırı bir onaylı bilgiye birebir karşılık gelir; slogan, teklif veya çağrı yoktur.
    expect(campaign!.copy).toEqual({ headline: "Mimoza", lines: [fact.value], designNote: "Tasarım görseli" });
    expect(campaign!.factRefs).toEqual([
      { attributeId: fact.id, category: "DESCRIPTION", key: fact.key, value: fact.value, source: "USER", confirmedAt: fact.confirmedAt!.toISOString() },
    ]);
    expect(campaign!.brandSnapshot).toMatchObject({ businessName: "Mimoza", profileAvailable: false });

    const preview = await readCreativeCampaignOutput(owner.id, campaign!.id);
    expect(await sharp(preview!.bytes).metadata()).toMatchObject({ width: 1080, height: 1350, format: "png" });
  });

  it("refuses to invent missing facts: a category without a confirmed fact is unavailable and produces nothing", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    // Onaya girmemiş, reddedilmiş ve kanonik olmayan satırlar hiçbir koşulda okunmaz.
    await confirmedFact(business.id, "DESCRIPTION", "Çıkarım.", { verificationStatus: "INFERRED" });
    await confirmedFact(business.id, "DESCRIPTION", "Onay bekliyor.", { verificationStatus: "NEEDS_CONFIRMATION" });
    await confirmedFact(business.id, "DESCRIPTION", "Reddedildi.", { verificationStatus: "REJECTED" });
    await confirmedFact(business.id, "PRODUCTS_SERVICES", "Kanonik değil.", { isCanonical: false });

    const workspace = await getCreativeCampaignWorkspace(owner.id, business.id);
    expect(workspace.categories.every((category) => !category.available)).toBe(true);
    expect(workspace.categories.every((category) => category.factPreview.length === 0)).toBe(true);
    expect(workspace.categories.find((category) => category.category === "PRODUCTS_SERVICES")?.missingReason)
      .toBe(creativeCategoryDefinitions.PRODUCTS_SERVICES.missingReason);

    await expect(createCreativeCampaign(owner.id, business.id, "PRODUCTS_SERVICES", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", message: creativeCategoryDefinitions.PRODUCTS_SERVICES.missingReason });
    expect(await prisma.mediaCreativeCampaign.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("offers and accepts only platform/format targets backed by a real aspect ratio rule", async () => {
    const { owner, business } = await businessFixture();
    await confirmedFact(business.id, "FACT", "1998'den beri hizmet veriyoruz.");

    const withoutRules = await getCreativeCampaignWorkspace(owner.id, business.id);
    expect(withoutRules.formats).toEqual([]);
    await expect(createCreativeCampaign(owner.id, business.id, "CONFIRMED_FACTS", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await instagramRules(business.id);
    const workspace = await getCreativeCampaignWorkspace(owner.id, business.id);
    // Yalnızca kuralı olan hedefler; TikTok/Facebook ve 1:1 desteklenmeyen "kare" listede yok.
    expect(workspace.formats.map((format) => `${format.platform}:${format.format}`).sort()).toEqual(["INSTAGRAM:FEED", "INSTAGRAM:STORY"]);
    expect(workspace.formats.find((format) => format.format === "STORY")).toMatchObject({ targetAspectRatio: "9:16", outputWidth: 1080, outputHeight: 1920 });
    await expect(createCreativeCampaign(owner.id, business.id, "CONFIRMED_FACTS", "TIKTOK", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("never writes to Business Brain and keeps produced output unchanged when facts or brand settings change later", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const fact = await confirmedFact(business.id, "LOCATION_CONTEXT", "Yalıkavak Marina girişindeyiz.");
    const before = await prisma.businessAttribute.findMany({ where: { businessId: business.id }, orderBy: { id: "asc" } });

    const campaign = await createCreativeCampaign(owner.id, business.id, "LOCATION_INFO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    await keepCreativeCampaign(owner.id, campaign!.id);

    // Kreatif akışı Business Brain'e hiçbir satır yazmaz ve mevcut satırları değiştirmez.
    expect(await prisma.businessAttribute.findMany({ where: { businessId: business.id }, orderBy: { id: "asc" } })).toEqual(before);

    await prisma.businessAttribute.update({ where: { id: fact.id }, data: { value: "Artık başka bir adresteyiz." } });
    await prisma.brandProfile.create({ data: { businessId: business.id, languages: ["tr"], toneDimensions: { minimalVibrant: 95, seriousPlayful: 90 } } });

    const stored = await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } });
    expect(stored.copy).toEqual(campaign!.copy);
    expect(stored.factRefs).toEqual(campaign!.factRefs);
    expect(stored.brandSnapshot).toEqual(campaign!.brandSnapshot);
    expect(stored.ruleSnapshot).toEqual(campaign!.ruleSnapshot);
  });

  it("keeps a design as a CREATIVE_CAMPAIGN asset that can only carry the CUSTOM_GRAPHIC planning tag", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "PRODUCTS_SERVICES", "Taze balık ve meze tabakları sunuyoruz.");

    const campaign = await createCreativeCampaign(owner.id, business.id, "PRODUCTS_SERVICES", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    const kept = await keepCreativeCampaign(owner.id, campaign!.id);
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });

    expect(asset).toMatchObject({ origin: "CREATIVE_CAMPAIGN", type: "IMAGE", tags: ["CUSTOM_GRAPHIC"], derivedFromId: null, storageKey: campaign!.outputStorageKey });
    expect(asset.originalFilename).toBe("mimoza-products-services-tasarim-s1.png");
    // Tasarım, gerçek fotoğraf kanıtı isteyen bir ihtiyaç için işaretlenemez.
    expect(allowedPlanningTagsFor(asset)).toEqual(["CUSTOM_GRAPHIC"]);
    await expect(updateMediaPlanningTags(owner.id, asset.id, ["PHOTO_PRODUCT"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateMediaPlanningTags(owner.id, asset.id, ["CUSTOM_GRAPHIC", "PHOTO_ATMOSPHERE"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await updateMediaPlanningTags(owner.id, asset.id, ["CUSTOM_GRAPHIC"])).tags).toEqual(["CUSTOM_GRAPHIC"]);
  });

  it("lets a kept design cover only a CUSTOM_GRAPHIC requirement in Content Stock, never a photo requirement", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "FACT", "Rezervasyon telefonla alınır.");
    const campaign = await createCreativeCampaign(owner.id, business.id, "CONFIRMED_FACTS", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    const kept = await keepCreativeCampaign(owner.id, campaign!.id);
    const design = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });

    // Fallback aynı etiket sınırını okur: tasarım gerçek fotoğraf isteyen bir öğeye format
    // uyarlamasıyla bile geçemez, yalnızca özel tasarım ihtiyacına önerilir.
    const fallbackBase = {
      assets: [{ id: design.id, type: design.type, tags: design.tags, createdAt: design.createdAt, originalFilename: design.originalFilename, origin: design.origin }],
      usage: new Map<string, never>(), confirmedFacts: [], verifiedSocialProof: [],
      brand: { businessName: "Mimoza", hasBrandProfile: false }, now: new Date("2026-10-05T10:00:00.000Z"),
    };
    expect(evaluateContentFallback({ ...fallbackBase, item: { id: "photo", mediaRequirement: "PHOTO_PRODUCT", pillar: "PRODUCT" } }).proposal)
      .toMatchObject({ kind: "BRAND_CREATIVE_PLACEHOLDER", mediaAssetId: null });
    const graphic = evaluateContentFallback({ ...fallbackBase, item: { id: "graphic", mediaRequirement: "CUSTOM_GRAPHIC", pillar: "PRODUCT" } }).proposal;
    // Tasarım yalnızca özel tasarım ihtiyacına ve AÇIKÇA tasarım olarak önerilir; özgün medya türlerinden biri olarak değil.
    expect(graphic).toMatchObject({ kind: "EXISTING_DESIGNED_CREATIVE", mediaAssetId: design.id, targetMediaRequirement: "CUSTOM_GRAPHIC" });
    expect(graphic!.rationale).toContain("Bu bir tasarımdır, gerçek ürün/ekip/mekân fotoğrafı değildir");
    expect(graphic!.rationale.toLocaleLowerCase("tr")).not.toContain("özgün");

    const goal = await prisma.businessGoal.create({ data: { businessId: business.id, type: "RESERVATIONS", priority: "PRIMARY" } });
    const strategy = await prisma.contentStrategy.create({
      data: { businessId: business.id, mode: "CUSTOM", platformSettings: [], contentMix: [], languages: ["tr"], rationale: "test", approvedAt: new Date() },
    });
    const plan = await prisma.contentPlan.create({
      data: {
        businessId: business.id, strategyId: strategy.id, period: "SEVEN_DAYS",
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
    await item("CUSTOM_GRAPHIC");
    await item("PHOTO_PRODUCT");

    const report = await calculateContentStock(business.id, { now: new Date("2026-10-05T10:00:00.000Z") });
    expect(report.byRequirement).toEqual(expect.arrayContaining([
      { mediaRequirement: "CUSTOM_GRAPHIC", upcoming: 1, covered: 1, missing: 0 },
      { mediaRequirement: "PHOTO_PRODUCT", upcoming: 1, covered: 0, missing: 1 },
    ]));
  });

  it("uses accepted authentic media as background with explicit lineage, leaves it byte-identical, and refuses a design as background", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "DESCRIPTION", "Deniz kenarında kahvaltı ve akşam yemeği.");
    const source = await imageFixture(owner.id, business.id);
    const sourceHash = await storedBytes(source.storageKey);

    const campaign = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", {
      provider: localProvider(), skipRateLimit: true, sourceAssetId: source.id,
    });
    expect(campaign).toMatchObject({ status: "SUCCEEDED", sourceAssetId: source.id, rootAssetId: source.id, outputMimeType: "image/jpeg", outputWidth: 1080, outputHeight: 1350 });

    const kept = await keepCreativeCampaign(owner.id, campaign!.id);
    const design = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });
    // Soy açık, ama sonuç yine TASARIM: gerçek fotoğrafın kökeni ve etiketleri devralınmaz.
    expect(design).toMatchObject({ origin: "CREATIVE_CAMPAIGN", derivedFromId: source.id, tags: ["CUSTOM_GRAPHIC"] });
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    expect(await storedBytes(source.storageKey)).toBe(sourceHash);

    // Tasarımın üstüne tasarım kurulamaz; arka plan listesine de girmez.
    await expect(createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "STORY", {
      provider: localProvider(), skipRateLimit: true, sourceAssetId: design.id,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const workspace = await getCreativeCampaignWorkspace(owner.id, business.id);
    expect(workspace.backgrounds.map((asset) => asset.id)).toEqual([source.id]);
  });

  it("denies every create, read, preview, keep and discard path across tenants", async () => {
    const { owner, business } = await businessFixture("a");
    const other = await businessFixture("b");
    await instagramRules(business.id);
    await confirmedFact(business.id, "FACT", "Pazartesi kapalıyız bilgisi onaylandı.");
    const campaign = await createCreativeCampaign(owner.id, business.id, "CONFIRMED_FACTS", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });

    await expect(getCreativeCampaignWorkspace(other.owner.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createCreativeCampaign(other.owner.id, business.id, "CONFIRMED_FACTS", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(keepCreativeCampaign(other.owner.id, campaign!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(discardCreativeCampaign(other.owner.id, campaign!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await readCreativeCampaignOutput(other.owner.id, campaign!.id)).toBeNull();

    // Başka kiracının medyası arka plan olarak kullanılamaz.
    const foreign = await imageFixture(other.owner.id, other.business.id);
    await expect(createCreativeCampaign(owner.id, business.id, "CONFIRMED_FACTS", "INSTAGRAM", "STORY", {
      provider: localProvider(), skipRateLimit: true, sourceAssetId: foreign.id,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } })).toMatchObject({ decision: null, status: "SUCCEEDED" });
  });

  it("deduplicates concurrent identical requests and opens a new version after a decision while preserving history", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "DESCRIPTION", "Aile işletmesi.");

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true })),
    );
    for (const result of results) expect(result.status).toBe("fulfilled");
    const rows = await prisma.mediaCreativeCampaign.findMany({ where: { businessId: business.id, category: "BUSINESS_INTRO", format: "FEED" } });
    expect(rows).toHaveLength(1);
    expect(new Set(results.map((result) => (result as PromiseFulfilledResult<{ id: string } | null>).value?.id))).toEqual(new Set([rows[0].id]));

    // Farklı bir hedef ayrı bir sürümdür.
    const story = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "STORY", { provider: localProvider(), skipRateLimit: true });
    expect(story?.version).toBe(2);

    await keepCreativeCampaign(owner.id, rows[0].id);
    const rerun = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(rerun?.id).not.toBe(rows[0].id);
    expect(rerun?.version).toBe(3);

    const first = await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(first.decision).toBe("KEPT");
    expect(await storage.get(first.outputStorageKey!)).not.toBeNull();
    expect((await getCreativeCampaignWorkspace(owner.id, business.id)).history.map((entry) => entry.version)).toEqual([3, 2, 1]);
  });

  it("records provider failure and invalid output without persisting an output, an asset or a decidable result", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "DESCRIPTION", "Küçük bir balık restoranı.");
    const create = (provider: CreativeRenderProvider) =>
      createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider, skipRateLimit: true });

    expect(await create(fakeProvider(() => { throw new Error("PROVIDER_DOWN"); }))).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_FAILED" });
    expect(await create(fakeProvider(() => ({ bytes: "not-bytes", mimeType: "image/png" })))).toMatchObject({ status: "INVALID_OUTPUT", errorCode: "SCHEMA_VALIDATION_FAILED" });
    expect(await create(fakeProvider(() => ({ bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "image/png" })))).toMatchObject({ status: "INVALID_OUTPUT", errorCode: "OUTPUT_NOT_DECODABLE" });
    expect(await create(fakeProvider(async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#fff" } }).jpeg().toBuffer()), mimeType: "image/png" }))))
      .toMatchObject({ status: "INVALID_OUTPUT", errorCode: "OUTPUT_FORMAT_MISMATCH" });
    expect(await create(fakeProvider(async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 123, height: 456, channels: 3, background: "#fff" } }).png().toBuffer()), mimeType: "image/png" }))))
      .toMatchObject({ status: "INVALID_OUTPUT", errorCode: "OUTPUT_DIMENSIONS_UNEXPECTED" });

    const rows = await prisma.mediaCreativeCampaign.findMany({ where: { businessId: business.id } });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.outputStorageKey).toBeNull();
      expect(row.outputAssetId).toBeNull();
      expect(row.completedAt).not.toBeNull();
      await expect(keepCreativeCampaign(owner.id, row.id)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("settles concurrent keep and discard on one decision and discards only the design's own bytes", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    await confirmedFact(business.id, "DESCRIPTION", "Deniz manzaralı terasımız onaylandı.");
    const source = await imageFixture(owner.id, business.id);
    const sourceHash = await storedBytes(source.storageKey);
    const campaign = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", {
      provider: localProvider(), skipRateLimit: true, sourceAssetId: source.id,
    });
    const outputKey = campaign!.outputStorageKey!;

    const results = await Promise.allSettled([
      keepCreativeCampaign(owner.id, campaign!.id),
      discardCreativeCampaign(owner.id, campaign!.id),
      keepCreativeCampaign(owner.id, campaign!.id),
      discardCreativeCampaign(owner.id, campaign!.id),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);

    const settled = await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } });
    expect(settled.decidedById).toBe(owner.id);
    if (settled.decision === "KEPT") {
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: settled.outputAssetId! } })).storageKey).toBe(outputKey);
      expect(await storage.get(outputKey)).not.toBeNull();
    } else {
      expect(settled.decision).toBe("DISCARDED");
      expect(settled.outputAssetId).toBeNull();
      expect(settled.outputStorageKey).toBeNull();
      expect(await storage.get(outputKey)).toBeNull();
      expect(await prisma.mediaAsset.count({ where: { businessId: business.id, origin: "CREATIVE_CAMPAIGN" } })).toBe(0);
      expect(await readCreativeCampaignOutput(owner.id, campaign!.id)).toBeNull();
    }
    // Arka plan olarak kullanılan gerçek görsel her iki sonuçta da olduğu gibi durur.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    expect(await storedBytes(source.storageKey)).toBe(sourceHash);
  });
});
