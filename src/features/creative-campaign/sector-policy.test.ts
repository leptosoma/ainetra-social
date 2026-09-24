import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { uploadMedia } from "@/features/media/service";
import {
  createCreativeCampaign,
  getCreativeCampaignWorkspace,
  keepCreativeCampaign,
  staleFactMessage,
} from "@/features/creative-campaign/service";
import { LocalTemplateCreativeProvider } from "@/features/creative-campaign/providers/local";
import type { CreativeRenderProvider } from "@/features/creative-campaign/providers/types";
import { creativeCategoryDefinitions } from "@/features/creative-campaign/categories";
import { creativeCategories } from "@/features/creative-campaign/schemas";
import {
  creativePolicyPrecedence,
  creativeRestrictedClaimRules,
  creativeSectorPolicyKeys,
  findRestrictedClaim,
  healthAcceptanceRequiredMessage,
  resolveCreativeSectorPolicy,
} from "@/features/creative-campaign/sector-policy";

// P5-05 sektör politikası testleri. Odak: politikanın `Business.sector` alanından deterministik
// olarak çözülmesi, tanınmayan sektörün güvenli tarafa düşmesi ve öncelik sırasının
// ÖZGÜNLÜK > ONAYLI BİLGİ > SEKTÖR POLİTİKASI > MARKA STİLİ > KREATİF SERBESTLİK
// olarak hem oluşturma hem saklama yolunda gerçekten uygulanması.

async function businessFixture(sector: string, suffix = "") {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `sp-owner-${suffix}${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: { name: "Mimoza", sector, timezone: "Europe/Istanbul", memberships: { create: { userId: owner.id, role: "OWNER" } } },
  });
  return { owner, business };
}

function confirmedFact(
  businessId: string,
  category: "DESCRIPTION" | "PRODUCTS_SERVICES" | "LOCATION_CONTEXT" | "FACT",
  value: string,
) {
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

async function jpegBytes(width: number, height: number) {
  const buffer = await sharp({ create: { width, height, channels: 3, background: "#7a8b6f" } }).jpeg({ quality: 88 }).toBuffer();
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

async function imageFixture(userId: string, businessId: string) {
  const file = new File([await jpegBytes(900, 1000)], "urun.jpg", { type: "image/jpeg" });
  return uploadMedia(userId, businessId, file, ["PHOTO_PRODUCT"]);
}

const localProvider = () => new LocalTemplateCreativeProvider();

/** Doğru boyutta gerçek bir PNG üreten, ama kendini ÜRETKEN olarak beyan eden sağlayıcı. */
function generativeProvider(): CreativeRenderProvider {
  return {
    provider: "test-generative", model: "test-model", provenance: "REAL", generative: true,
    async render(input) {
      const buffer = await sharp({ create: { width: input.canvas.width, height: input.canvas.height, channels: 3, background: "#ffffff" } }).png().toBuffer();
      return { bytes: new Uint8Array(buffer), mimeType: "image/png" as const };
    },
  };
}

describe("Ainetra P5-05 — creative campaign sector policy", () => {
  it("1) resolves the three policies deterministically from Business.sector, case- and diacritic-insensitively", async () => {
    for (const sector of ["Otel", "OTEL", "Butik Otel", "hotel", "Pansiyon", "Konaklama", "Villa", "Kiralık Villa", "Hospitality"]) {
      expect(resolveCreativeSectorPolicy(sector)).toMatchObject({ key: "HOSPITALITY_STANDARD", sectorRecognized: true });
    }
    for (const sector of ["RESTAURANT", "Restoran", "restoranı", "Kafe", "CAFE", "Bar", "Pastane", "Fırın", "Beach Club", "beach club", "Beach Kulübü"]) {
      expect(resolveCreativeSectorPolicy(sector)).toMatchObject({ key: "FOOD_STRICT_AUTHENTIC", sectorRecognized: true });
    }
    for (const sector of ["Klinik", "Özel Klinik", "KLİNİK", "Diş Hekimi", "Sağlık", "Estetik Merkezi", "Eczane", "Saç Ekimi", "saç ekim merkezi", "Hair Transplant"]) {
      expect(resolveCreativeSectorPolicy(sector)).toMatchObject({ key: "HEALTH_STRICT_COMPLIANCE", sectorRecognized: true });
    }

    // Beklenen sektör örneklerinin tek tek karşılığı; bir eşleştirici düşerse bu satır söyler.
    expect(resolveCreativeSectorPolicy("Villa").key).toBe("HOSPITALITY_STANDARD");
    expect(resolveCreativeSectorPolicy("Hospitality").key).toBe("HOSPITALITY_STANDARD");
    expect(resolveCreativeSectorPolicy("Beach Club").key).toBe("FOOD_STRICT_AUTHENTIC");
    expect(resolveCreativeSectorPolicy("Beach Club").authenticityStrictness).toBe("STRICT");
    expect(resolveCreativeSectorPolicy("Saç Ekimi").key).toBe("HEALTH_STRICT_COMPLIANCE");
    expect(resolveCreativeSectorPolicy("Hair Transplant").key).toBe("HEALTH_STRICT_COMPLIANCE");
    expect(resolveCreativeSectorPolicy("Saç Ekimi").requiresExplicitAcceptance).toBe(true);

    // Kısa anahtar ("bar") başka bir sözcüğün içine düşmez.
    expect(resolveCreativeSectorPolicy("Berber").sectorRecognized).toBe(false);
    // Birden çok eşleşmede daha dar politika kazanır.
    expect(resolveCreativeSectorPolicy("Otel Restoran").key).toBe("FOOD_STRICT_AUTHENTIC");
    expect(resolveCreativeSectorPolicy("Hastane Kafeteryası").key).toBe("HEALTH_STRICT_COMPLIANCE");
    expect(resolveCreativeSectorPolicy("Villa Beach Club").key).toBe("FOOD_STRICT_AUTHENTIC");
    expect(resolveCreativeSectorPolicy("Saç Ekimi Oteli").key).toBe("HEALTH_STRICT_COMPLIANCE");
  });

  it("2) falls back to the narrowest policy for an unknown or empty sector and says the sector was not recognized", async () => {
    for (const sector of ["", "   ", "Mobilya Satışı", "Emlak", "Bilinmeyen Sektör"]) {
      const policy = resolveCreativeSectorPolicy(sector);
      expect(policy.key).toBe("HEALTH_STRICT_COMPLIANCE");
      expect(policy.sectorRecognized).toBe(false);
      expect(policy.requiresExplicitAcceptance).toBe(true);
      expect(policy.authenticityStrictness).toBe("STRICT");
    }

    // Ekranda da açıkça yazar: en dar politika uygulandı, bu bir sağlık iddiası değildir.
    const { owner, business } = await businessFixture("Mobilya Satışı");
    await instagramRules(business.id);
    const workspace = await getCreativeCampaignWorkspace(owner.id, business.id);
    expect(workspace.policy).toMatchObject({ key: "HEALTH_STRICT_COMPLIANCE", sectorRecognized: false, requiresExplicitAcceptance: true });
  });

  it("3) every policy requires confirmed facts and human review, and can only allow the existing four creative types", async () => {
    expect([...creativeSectorPolicyKeys]).toEqual(["HOSPITALITY_STANDARD", "FOOD_STRICT_AUTHENTIC", "HEALTH_STRICT_COMPLIANCE"]);
    expect([...creativePolicyPrecedence]).toEqual(["AUTHENTICITY", "CONFIRMED_FACTS", "SECTOR_POLICY", "BRAND_STYLE", "CREATIVE_FREEDOM"]);
    for (const sector of ["Otel", "Restoran", "Klinik", "bilinmeyen"]) {
      const policy = resolveCreativeSectorPolicy(sector);
      expect(policy.requiresConfirmedFacts).toBe(true);
      expect(policy.requiresHumanReview).toBe(true);
      // Politika yeni bir kreatif türü İCAT EDEMEZ; yalnızca var olan dördünden bir altküme seçer.
      expect(policy.allowedCategories.length).toBeGreaterThan(0);
      for (const category of policy.allowedCategories) expect(creativeCategories).toContain(category);
    }
    expect(resolveCreativeSectorPolicy("Klinik").allowedCategories).toEqual(["BUSINESS_INTRO", "LOCATION_INFO", "CONFIRMED_FACTS"]);
    expect(resolveCreativeSectorPolicy("Restoran").allowedCategories).toEqual([...creativeCategories]);
  });

  it("4) closes the service-promotion creative type under the health policy even when a confirmed product fact exists", async () => {
    const { owner, business } = await businessFixture("Özel Klinik");
    await instagramRules(business.id);
    await confirmedFact(business.id, "PRODUCTS_SERVICES", "Fizyoterapi ve rehabilitasyon hizmeti veriyoruz.");
    await confirmedFact(business.id, "DESCRIPTION", "2010'dan beri hizmet veren bir poliklinikiz.");

    const workspace = await getCreativeCampaignWorkspace(owner.id, business.id);
    const blocked = workspace.categories.find((category) => category.category === "PRODUCTS_SERVICES")!;
    expect(blocked).toMatchObject({ available: false, missingReason: null });
    expect(blocked.blockedReason).toContain("Sağlık politikasında hizmet veya tedavi tanıtımı");
    // Kapatılan türde onaylı bilgi önizlemesi de gösterilmez.
    expect(blocked.factPreview).toEqual([]);
    // Bilgilendirici tür açık kalır: dört kategori korunur, yalnızca bu sektörde biri kapanır.
    expect(workspace.categories.find((category) => category.category === "BUSINESS_INTRO")).toMatchObject({ available: true, blockedReason: null });

    await expect(createCreativeCampaign(owner.id, business.id, "PRODUCTS_SERVICES", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaCreativeCampaign.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("5) blocks a guarantee claim under the health policy even though the fact is canonical and CONFIRMED", async () => {
    const { owner, business } = await businessFixture("Estetik Klinik");
    await instagramRules(business.id);
    const fact = await confirmedFact(business.id, "FACT", "Uyguladığımız tedavide sonuç garantisi veriyoruz.");
    expect(await prisma.businessAttribute.findUniqueOrThrow({ where: { id: fact.id } })).toMatchObject({ isCanonical: true, verificationStatus: "CONFIRMED" });

    await expect(createCreativeCampaign(owner.id, business.id, "CONFIRMED_FACTS", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", message: creativeRestrictedClaimRules.GUARANTEE.reason });
    expect(await prisma.mediaCreativeCampaign.count({ where: { businessId: business.id } })).toBe(0);
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);
    // Business Brain'e dokunulmaz: yasaklı iddia kaydı reddedilmez, yalnızca tasarıma basılmaz.
    expect(await prisma.businessAttribute.findUniqueOrThrow({ where: { id: fact.id } })).toEqual(fact);
  });

  it("6) blocks risk-free, certain-success, success-rate, before/after and patient-proof claims under the health policy", async () => {
    const health = resolveCreativeSectorPolicy("Klinik");
    const food = resolveCreativeSectorPolicy("Restoran");
    const cases = [
      { claim: "RISK_FREE" as const, text: "İşlem tamamen risksiz uygulanır." },
      { claim: "CERTAIN_SUCCESS" as const, text: "Tedavide kesin sonuç alınır." },
      { claim: "SUCCESS_RATE" as const, text: "Başarı oranımız %98." },
      { claim: "BEFORE_AFTER" as const, text: "Öncesi ve sonrası fotoğraflarımıza bakabilirsiniz." },
      { claim: "PATIENT_PROOF" as const, text: "Hasta yorumlarımız bunu doğruluyor." },
    ];
    for (const entry of cases) {
      expect(findRestrictedClaim(health, entry.text)).toMatchObject({ claim: entry.claim });
      // Yeme-içme politikası bu iddiaları taramaz: politika sektöre özgüdür, genel bir sansür değildir.
      expect(findRestrictedClaim(food, entry.text)).toBeNull();
    }

    const { owner, business } = await businessFixture("Diş Hekimi");
    await instagramRules(business.id);
    for (const entry of cases) {
      const fact = await confirmedFact(business.id, "FACT", entry.text);
      await expect(createCreativeCampaign(owner.id, business.id, "CONFIRMED_FACTS", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
        .rejects.toMatchObject({ code: "VALIDATION_ERROR", message: creativeRestrictedClaimRules[entry.claim].reason });
      await prisma.businessAttribute.delete({ where: { id: fact.id } });
    }
    expect(await prisma.mediaCreativeCampaign.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("7) requires explicit human acceptance before a health design can be kept", async () => {
    const { owner, business } = await businessFixture("Poliklinik");
    await instagramRules(business.id);
    await confirmedFact(business.id, "LOCATION_CONTEXT", "Kadıköy'de, metro çıkışının karşısındayız.");

    const campaign = await createCreativeCampaign(owner.id, business.id, "LOCATION_INFO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(campaign).toMatchObject({ status: "SUCCEEDED", decision: null });

    // Beyan yok: hiçbir medya varlığı oluşmaz, karar yazılmaz, çıktı baytları yerinde kalır.
    await expect(keepCreativeCampaign(owner.id, campaign!.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: healthAcceptanceRequiredMessage });
    await expect(keepCreativeCampaign(owner.id, campaign!.id, { policyAcceptance: "evet" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } })).toMatchObject({ decision: null, outputAssetId: null });
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);
    expect(await storage.get(campaign!.outputStorageKey!)).not.toBeNull();

    const kept = await keepCreativeCampaign(owner.id, campaign!.id, { policyAcceptance: "HEALTH_STRICT_COMPLIANCE" });
    expect(kept).toMatchObject({ decision: "KEPT", decidedById: owner.id });
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } })).toMatchObject({ origin: "CREATIVE_CAMPAIGN", tags: ["CUSTOM_GRAPHIC"] });
  });

  it("8) refuses a generative provider in every policy so no synthetic image can substitute a real one", async () => {
    const food = await businessFixture("Restoran", "food");
    await instagramRules(food.business.id);
    await confirmedFact(food.business.id, "PRODUCTS_SERVICES", "Taze balık ve mevsim mezeleri sunuyoruz.");

    await expect(createCreativeCampaign(food.owner.id, food.business.id, "PRODUCTS_SERVICES", "INSTAGRAM", "FEED", { provider: generativeProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaCreativeCampaign.count({ where: { businessId: food.business.id } })).toBe(0);
    expect(resolveCreativeSectorPolicy("Restoran").allowsGenerativeImagery).toBe(false);
    expect(resolveCreativeSectorPolicy("Klinik").allowsGenerativeImagery).toBe(false);

    // Üretken olmayan yerel şablonla hazırlanan yemek tasarımı da yalnızca CUSTOM_GRAPHIC kalır.
    const design = await createCreativeCampaign(food.owner.id, food.business.id, "PRODUCTS_SERVICES", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    const kept = await keepCreativeCampaign(food.owner.id, design!.id);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } })).toMatchObject({ origin: "CREATIVE_CAMPAIGN", tags: ["CUSTOM_GRAPHIC"] });

    // Konaklamada da reddedilir: Ainetra çıktının ANLAMINI doğrulamıyor, bu yüzden üretken bir
    // sağlayıcının uydurduğu deniz manzarası, oda veya havuz hiçbir denetime takılmazdı.
    const hotel = await businessFixture("Butik Otel", "hotel");
    await instagramRules(hotel.business.id);
    await confirmedFact(hotel.business.id, "DESCRIPTION", "Yalıkavak'ta on odalı bir butik otel.");
    await expect(createCreativeCampaign(hotel.owner.id, hotel.business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider: generativeProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaCreativeCampaign.count({ where: { businessId: hotel.business.id } })).toBe(0);
    expect(resolveCreativeSectorPolicy("Otel").allowsGenerativeImagery).toBe(false);
    expect(resolveCreativeSectorPolicy("Villa").allowsGenerativeImagery).toBe(false);
    expect(resolveCreativeSectorPolicy("bilinmeyen").allowsGenerativeImagery).toBe(false);

    // Deterministik grafik şablonu korunur: üretken olmayan sağlayıcıyla aynı tasarım hazırlanır.
    const hotelDesign = await createCreativeCampaign(hotel.owner.id, hotel.business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(hotelDesign).toMatchObject({ status: "SUCCEEDED", provider: "development-template-local", provenance: "DEVELOPMENT" });
  });

  it("9) refuses a background whose real-photo lineage cannot be resolved under a strict-authenticity policy", async () => {
    const food = await businessFixture("Kafe", "food9");
    await instagramRules(food.business.id);
    await confirmedFact(food.business.id, "DESCRIPTION", "Sahilde küçük bir kahve dükkânı.");
    const orphan = await imageFixture(food.owner.id, food.business.id);
    // Gerçek bir durum: kaynağı silinmiş bir türev satırı (derivedFromId SetNull ile boşalır).
    await prisma.mediaAsset.update({ where: { id: orphan.id }, data: { origin: "SAFE_ENHANCE", derivedFromId: null } });

    await expect(createCreativeCampaign(food.owner.id, food.business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", {
      provider: localProvider(), skipRateLimit: true, sourceAssetId: orphan.id,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaCreativeCampaign.count({ where: { businessId: food.business.id } })).toBe(0);

    // Konaklama politikası STANDARD'dır: aynı arka planı kabul eder ama çıktı yine tasarımdır.
    const hotel = await businessFixture("Otel", "hotel9");
    await instagramRules(hotel.business.id);
    await confirmedFact(hotel.business.id, "DESCRIPTION", "Deniz kenarında aile oteli.");
    const hotelOrphan = await imageFixture(hotel.owner.id, hotel.business.id);
    await prisma.mediaAsset.update({ where: { id: hotelOrphan.id }, data: { origin: "SAFE_ENHANCE", derivedFromId: null } });
    const campaign = await createCreativeCampaign(hotel.owner.id, hotel.business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", {
      provider: localProvider(), skipRateLimit: true, sourceAssetId: hotelOrphan.id,
    });
    expect(campaign).toMatchObject({ status: "SUCCEEDED", sourceAssetId: hotelOrphan.id, rootAssetId: null });
  });

  it("10) keeps hotel claims confirmed: every printed line traces to a canonical CONFIRMED fact", async () => {
    const { owner, business } = await businessFixture("Otel");
    await instagramRules(business.id);
    const fact = await confirmedFact(business.id, "DESCRIPTION", "Marina girişinde, on iki odalı bir butik oteliz.");

    const campaign = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(campaign!.copy).toEqual({ headline: "Mimoza", lines: [fact.value], designNote: "Tasarım görseli" });
    expect(campaign!.factRefs).toEqual([
      { attributeId: fact.id, category: "DESCRIPTION", key: fact.key, value: fact.value, source: "USER", confirmedAt: fact.confirmedAt!.toISOString() },
    ]);

    // Kayda sonradan kaynağı olmayan bir satır sokulursa saklama reddedilir: iddia onaysız kalamaz.
    await prisma.mediaCreativeCampaign.update({
      where: { id: campaign!.id },
      data: { copy: { headline: "Mimoza", lines: ["Denize sıfır, beş yıldızlı bir oteliz."], designNote: "Tasarım görseli" } },
    });
    await expect(keepCreativeCampaign(owner.id, campaign!.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);
    expect(await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } })).toMatchObject({ decision: null, outputAssetId: null });
  });

  it("11) applies the layers in order: authenticity outranks confirmed facts, which outrank sector policy", async () => {
    const { owner, business } = await businessFixture("Klinik");
    await instagramRules(business.id);
    const source = await imageFixture(owner.id, business.id);
    const design = await prisma.mediaAsset.create({
      data: {
        businessId: business.id, type: "IMAGE", origin: "CREATIVE_CAMPAIGN", derivedFromId: source.id,
        originalFilename: "tasarim.png", mimeType: "image/png", size: 1024, width: 1080, height: 1350,
        storageKey: `${business.id}/creative-campaign/${crypto.randomUUID()}.png`, tags: ["CUSTOM_GRAPHIC"],
      },
    });
    const create = (options: { sourceAssetId?: string } = {}) =>
      createCreativeCampaign(owner.id, business.id, "PRODUCTS_SERVICES", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true, ...options });

    // Üç katman birlikte ihlal ediliyor (tasarım arka plan + onaylı bilgi yok + tür bu sektörde kapalı):
    // ÖZGÜNLÜK kazanır.
    await expect(create({ sourceAssetId: design.id })).rejects.toMatchObject({ message: "Bu görsel kreatif arka planı olarak kullanılamaz." });

    // Özgünlük ihlali kalkınca ONAYLI BİLGİ kapısı konuşur; sektör gerekçesi henüz görünmez.
    await expect(create()).rejects.toMatchObject({ message: creativeCategoryDefinitions.PRODUCTS_SERVICES.missingReason });

    // Onaylı bilgi gelince en son SEKTÖR POLİTİKASI konuşur.
    await confirmedFact(business.id, "PRODUCTS_SERVICES", "Cilt bakımı hizmeti veriyoruz.");
    await expect(create()).rejects.toMatchObject({ message: expect.stringContaining("Sağlık politikasında hizmet veya tedavi tanıtımı") });

    // MARKA STİLİ en alttadır: marka profili eklemek sektör politikasını gevşetmez.
    await prisma.brandProfile.create({ data: { businessId: business.id, languages: ["tr"], toneDimensions: { minimalVibrant: 95, seriousPlayful: 90 } } });
    await expect(create()).rejects.toMatchObject({ message: expect.stringContaining("Sağlık politikasında hizmet veya tedavi tanıtımı") });
    expect(await prisma.mediaCreativeCampaign.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("12) re-resolves the policy at decision time and leaves the produced record untouched when the sector narrows", async () => {
    const { owner, business } = await businessFixture("Restoran");
    await instagramRules(business.id);
    await confirmedFact(business.id, "PRODUCTS_SERVICES", "Günlük taze balık menümüz var.");

    const campaign = await createCreativeCampaign(owner.id, business.id, "PRODUCTS_SERVICES", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(campaign).toMatchObject({ status: "SUCCEEDED", decision: null });
    const snapshot = await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } });

    // İşletme sağlık olarak yeniden sınıflanıyor: bu tür artık kapalı, tasarım saklanamaz.
    await prisma.business.update({ where: { id: business.id }, data: { sector: "Özel Klinik" } });
    await expect(keepCreativeCampaign(owner.id, campaign!.id, { policyAcceptance: "HEALTH_STRICT_COMPLIANCE" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("Sağlık politikasında hizmet veya tedavi tanıtımı") });
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);

    // Üretilmiş kayıt ve çıktı hiç değişmez; politika daralması geçmişi yeniden yazmaz.
    expect(await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } })).toEqual(snapshot);
    expect(await storage.get(snapshot.outputStorageKey!)).not.toBeNull();

    // Sektör geri alındığında aynı tasarım, ek bir kabul beyanı istenmeden saklanabilir.
    await prisma.business.update({ where: { id: business.id }, data: { sector: "Restoran" } });
    const kept = await keepCreativeCampaign(owner.id, campaign!.id);
    expect(kept).toMatchObject({ decision: "KEPT" });
  });

  it("13) refuses to keep a design whose fact was revoked or changed after production, and stays idempotent once kept", async () => {
    const { owner, business } = await businessFixture("Otel", "keep13");
    await instagramRules(business.id);
    const value = "Marina girişinde, on iki odalı bir butik oteliz.";
    const fact = await confirmedFact(business.id, "DESCRIPTION", value);

    const campaign = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    const snapshot = await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } });

    // Onay geri çekiliyor (satır kanoniklikten de düşer; tablo kısıtı ikisini birlikte tutar):
    // üretimde geçen bilgi artık ONAYLI bir olgu kaynağı değil, tasarım saklanamaz.
    await prisma.businessAttribute.update({ where: { id: fact.id }, data: { isCanonical: false, verificationStatus: "NEEDS_CONFIRMATION" } });
    await expect(keepCreativeCampaign(owner.id, campaign!.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: staleFactMessage });

    // Reddedilen bilgi de aynı kapıya takılır.
    await prisma.businessAttribute.update({ where: { id: fact.id }, data: { verificationStatus: "REJECTED" } });
    await expect(keepCreativeCampaign(owner.id, campaign!.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: staleFactMessage });

    // Bilgi yeniden onaylanıyor ama DEĞERİ değişmiş: basılan metin artık güncel bilginin karşılığı değil.
    await prisma.businessAttribute.update({
      where: { id: fact.id },
      data: { isCanonical: true, verificationStatus: "CONFIRMED", value: "Marina girişinde, yirmi odalı bir butik oteliz." },
    });
    await expect(keepCreativeCampaign(owner.id, campaign!.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: staleFactMessage });

    // Hiçbir redde medya varlığı oluşmaz; üretilmiş kayıt ve çıktı baytları olduğu gibi kalır.
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);
    expect(await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } })).toEqual(snapshot);
    expect(await storage.get(snapshot.outputStorageKey!)).not.toBeNull();

    // Bilgi eski değerine döndüğünde aynı tasarım saklanır; çıktı yeniden üretilmez.
    await prisma.businessAttribute.update({ where: { id: fact.id }, data: { value } });
    const kept = await keepCreativeCampaign(owner.id, campaign!.id);
    expect(kept).toMatchObject({ decision: "KEPT", outputStorageKey: snapshot.outputStorageKey });

    // Karar verildikten sonra bilgi geri çekilse bile karar idempotenttir: ikinci varlık oluşmaz.
    await prisma.businessAttribute.update({ where: { id: fact.id }, data: { isCanonical: false, verificationStatus: "REJECTED" } });
    expect(await keepCreativeCampaign(owner.id, campaign!.id)).toMatchObject({ decision: "KEPT", outputAssetId: kept.outputAssetId });
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(1);
  });

  it("14) reads the sector and the acceptance requirement at the moment of the keep, inside the same write", async () => {
    const { owner, business } = await businessFixture("Otel", "keep14");
    await instagramRules(business.id);
    await confirmedFact(business.id, "DESCRIPTION", "Deniz kenarında on odalı bir aile oteli.");

    const campaign = await createCreativeCampaign(owner.id, business.id, "BUSINESS_INTRO", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    const snapshot = await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } });

    // İşletme sağlık olarak güncelleniyor: bu tür sağlıkta açık kalır ama artık kabul beyanı ister.
    await prisma.business.update({ where: { id: business.id }, data: { sector: "Saç Ekimi Merkezi" } });
    await expect(keepCreativeCampaign(owner.id, campaign!.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: healthAcceptanceRequiredMessage });
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);
    expect(await prisma.mediaCreativeCampaign.findUniqueOrThrow({ where: { id: campaign!.id } })).toEqual(snapshot);

    // Beyan geldiğinde saklanır ve çıktı yine yalnızca tasarım olarak işaretlenir.
    const kept = await keepCreativeCampaign(owner.id, campaign!.id, { policyAcceptance: "HEALTH_STRICT_COMPLIANCE" });
    expect(kept).toMatchObject({ decision: "KEPT", decidedById: owner.id });
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } })).toMatchObject({ origin: "CREATIVE_CAMPAIGN", tags: ["CUSTOM_GRAPHIC"] });
  });
});
