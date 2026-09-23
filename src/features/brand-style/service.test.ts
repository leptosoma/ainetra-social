import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { uploadMedia } from "@/features/media/service";
import { analyzeMediaAsset, getMediaAnalysisDetail, readVisualAnalysisResult } from "@/features/visual-analysis/service";
import { DevelopmentImageAnalysisProvider } from "@/features/visual-analysis/providers/development";
import type { ImageAnalysisProvider } from "@/features/visual-analysis/providers/types";
import type { VisualAnalysisResult } from "@/features/visual-analysis/schemas";
import type { Prisma } from "../../../generated/prisma/client";
import { createSafeEnhancement, keepSafeEnhancement } from "@/features/safe-enhance/service";
import { DevelopmentSharpTransformProvider } from "@/features/safe-enhance/providers/development";
import type { ImageTransformProvider } from "@/features/safe-enhance/providers/types";
import {
  createBrandStyle,
  discardBrandStyle,
  getBrandStyleRecommendation,
  getBrandStyleReview,
  keepBrandStyle,
  listBrandStyleSummaries,
  readBrandStyleOutput,
} from "@/features/brand-style/service";
import { buildBrandStyleOperations } from "@/features/brand-style/styles";
import { brandStyleBounds, type BrandStyleOperations } from "@/features/brand-style/schemas";
import { deriveBrandVisualStyleProfile } from "@/features/brand-style/profile";

const premiumTones = { corporateFriendly: 40, minimalVibrant: 25, luxuryAccessible: 15, modernNatural: 35, seriousPlayful: 20 };
const vibrantTones = { corporateFriendly: 80, minimalVibrant: 85, luxuryAccessible: 80, modernNatural: 60, seriousPlayful: 75 };

async function businessFixture(suffix = "") {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `bs-owner-${suffix}${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: { name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul", memberships: { create: { userId: owner.id, role: "OWNER" } } },
  });
  return { owner, business };
}

async function brandProfileFixture(businessId: string, toneDimensions: Record<string, number> = premiumTones) {
  return prisma.brandProfile.create({ data: { businessId, description: "Bodrum'da deniz ürünleri", toneDimensions } });
}

/** Düz renk değil: gerçek fotoğraf gibi ton geçişi olan bir kaynak, ayarların ölçülebilir etkisi olsun diye. */
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
  const file = new File([await jpegBytes(800, 1000)], "urun.jpg", { type: "image/jpeg" });
  return uploadMedia(userId, businessId, file, tags);
}

async function storedBytes(key: string) {
  const object = await storage.get(key);
  return object ? createHash("sha256").update(object.bytes).digest("hex") : null;
}

function fakeProvider(transform: (input: { bytes: Uint8Array }) => Promise<unknown> | unknown, options: { provenance?: "REAL" | "DEVELOPMENT"; delayMs?: number } = {}): ImageTransformProvider {
  return {
    provider: "test-transform",
    model: "test-model",
    provenance: options.provenance ?? "REAL",
    async transform(input) {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return transform(input);
    },
  };
}

/** Kaynağın baytlarını aynen geri veren sağlayıcı: geçerli çıktı üretir ama görseli değiştirmez. */
const passthroughProvider = fakeProvider((input) => ({ bytes: input.bytes }));

function analysisProvider(category: VisualAnalysisResult["category"]): ImageAnalysisProvider {
  const graphic = category === "GRAPHIC";
  return {
    provider: "test-vision",
    model: "test-model",
    provenance: "REAL",
    async analyze() {
      return {
        imageKind: graphic ? "GRAPHIC" : "PHOTO",
        dominantSubject: graphic ? "Kampanya afişi" : "Izgara steak tabağı",
        category,
        confidence: 0.9,
        lighting: "BALANCED",
        framing: "BALANCED",
        background: "CLEAN",
        sharpness: "SHARP",
        peopleVisible: false,
        notes: [],
      };
    },
  };
}

/** Yüklemeden → güvenli iyileştirme → "Sakla" ile oluşan türev medya. */
async function keptEnhancementFixture(userId: string, businessId: string) {
  const source = await imageFixture(userId, businessId);
  const enhancement = await createSafeEnhancement(userId, source.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
  const kept = await keepSafeEnhancement(userId, enhancement!.id);
  const derived = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });
  return { source, enhancement: kept, derived };
}

describe("Ainetra P5-03 — brand style", () => {
  it("creates a versioned derivative from the owning business's brand profile and leaves the source row and bytes untouched", async () => {
    const { owner, business } = await businessFixture();
    const brand = await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const before = await storedBytes(asset.storageKey);

    const brandStyle = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    expect(brandStyle?.status).toBe("SUCCEEDED");
    expect(brandStyle?.version).toBe(1);
    expect(brandStyle?.choice).toBe("BRAND_RECOMMENDED");
    expect(brandStyle?.decision).toBeNull();
    expect(brandStyle?.styleVersion).toBe("brand-style-v1");
    expect(brandStyle?.profileVersion).toBe("brand-style-profile-v1");
    expect(brandStyle?.businessId).toBe(business.id);
    expect(brandStyle?.sourceAssetId).toBe(asset.id);
    expect(brandStyle?.sourceEnhancementId).toBeNull();
    expect(brandStyle?.triggeredById).toBe(owner.id);
    expect(brandStyle?.outputStorageKey).toBeTruthy();
    expect(brandStyle?.outputStorageKey).not.toBe(asset.storageKey);
    expect([brandStyle?.outputWidth, brandStyle?.outputHeight]).toEqual([asset.width, asset.height]);
    expect(brandStyle?.outputMimeType).toBe("image/jpeg");

    // Marka bağlamı kayda geçti: kimlik, güncellenme zamanı ve kullanılan anlık görüntü.
    expect(brandStyle?.brandProfileId).toBe(brand.id);
    expect(brandStyle?.brandProfileUpdatedAt).toEqual(brand.updatedAt);
    expect(brandStyle?.styleProfile).toMatchObject({ profileVersion: "brand-style-profile-v1", available: true, complete: true, nearestStyle: "PREMIUM" });
    expect(brandStyle?.operations).toEqual(buildBrandStyleOperations("BRAND_RECOMMENDED", deriveBrandVisualStyleProfile(brand), "STRICT"));

    const source = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(source).toEqual(asset);
    expect(source.origin).toBe("UPLOAD");
    expect(await storedBytes(asset.storageKey)).toBe(before);
    expect(await storedBytes(brandStyle!.outputStorageKey!)).not.toBe(before);
  });

  it("uses the only authoritative brand profile and never creates or updates Business Brain state", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id, vibrantTones);
    await prisma.businessGoal.create({ data: { businessId: business.id, type: "RESERVATIONS", priority: "PRIMARY" } });
    await prisma.businessAttribute.create({ data: { businessId: business.id, category: "FACT", key: "fact.terrace", value: "Teras var", source: "USER", verificationStatus: "CONFIRMED", isCanonical: true } });
    const asset = await imageFixture(owner.id, business.id);
    await analyzeMediaAsset(owner.id, asset.id, { provider: analysisProvider("FOOD"), skipRateLimit: true });

    const snapshot = () => Promise.all([
      prisma.brandProfile.findMany({ orderBy: { id: "asc" } }),
      prisma.businessAttribute.findMany({ where: { businessId: business.id }, orderBy: { key: "asc" } }),
      prisma.businessGoal.findMany({ where: { businessId: business.id } }),
      prisma.mediaAnalysis.findMany({ where: { businessId: business.id }, orderBy: { version: "asc" } }),
    ]);
    const before = await snapshot();
    const brandStyle = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    const kept = await keepBrandStyle(owner.id, brandStyle!.id);
    expect(await snapshot()).toEqual(before);
    expect(await prisma.businessAnalysisRun.count({ where: { businessId: business.id } })).toBe(0);
    // Türev için otomatik analiz üretilmez; analiz yalnızca kullanıcı isteğiyle çalışır.
    expect(await prisma.mediaAnalysis.count({ where: { mediaAssetId: kept.outputAssetId! } })).toBe(0);

    // Marka profili hiç yokken de hiçbir kayıt oluşturulmaz; davranış açıkça nötrdür.
    const other = await businessFixture("neutral");
    const otherAsset = await imageFixture(other.owner.id, other.business.id);
    const neutral = await createBrandStyle(other.owner.id, otherAsset.id, "BRAND_RECOMMENDED", { provider: passthroughProvider, skipRateLimit: true });
    expect(neutral?.status).toBe("SUCCEEDED");
    expect(neutral?.brandProfileId).toBeNull();
    expect(neutral?.styleProfile).toMatchObject({ available: false, complete: false, nearestStyle: "NATURAL" });
    expect(await prisma.brandProfile.count({ where: { businessId: other.business.id } })).toBe(0);
  });

  it("rejects create, read, recommend, keep, discard and preview for a user from another tenant", async () => {
    const { owner, business } = await businessFixture("a");
    const other = await businessFixture("b");
    await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);

    await expect(createBrandStyle(other.owner.id, asset.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.mediaBrandStyle.count({ where: { sourceAssetId: asset.id } })).toBe(0);

    const brandStyle = await createBrandStyle(owner.id, asset.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    await expect(getBrandStyleReview(other.owner.id, asset.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getBrandStyleRecommendation(other.owner.id, asset.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listBrandStyleSummaries(other.owner.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(keepBrandStyle(other.owner.id, brandStyle!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(discardBrandStyle(other.owner.id, brandStyle!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await readBrandStyleOutput(other.owner.id, brandStyle!.id)).toBeNull();
    expect(await readBrandStyleOutput(owner.id, brandStyle!.id)).not.toBeNull();

    expect((await prisma.mediaBrandStyle.findUniqueOrThrow({ where: { id: brandStyle!.id } })).decision).toBeNull();
    expect((await listBrandStyleSummaries(other.owner.id, other.business.id)).has(asset.id)).toBe(false);
  });

  it("rejects unsupported media and unknown style choices without creating any row", async () => {
    const { owner, business } = await businessFixture();
    const video = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "VIDEO", originalFilename: "teras.mp4", mimeType: "video/mp4", size: 100, storageKey: `${business.id}/${crypto.randomUUID()}.mp4`, tags: [] },
    });
    await expect(createBrandStyle(owner.id, video.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await listBrandStyleSummaries(owner.id, business.id)).get(video.id)?.eligible).toBe(false);

    const asset = await imageFixture(owner.id, business.id);
    await expect(createBrandStyle(owner.id, asset.id, "CAMPAIGN", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createBrandStyle(owner.id, "missing-media", "NATURAL", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.mediaBrandStyle.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("records explicit lineage from a kept safe enhance derivative and keeps every source row and byte immutable", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id, vibrantTones);
    const { source, enhancement, derived } = await keptEnhancementFixture(owner.id, business.id);
    const originalBytes = await storedBytes(source.storageKey);
    const enhancedBytes = await storedBytes(derived.storageKey);

    const brandStyle = await createBrandStyle(owner.id, derived.id, "BRAND_RECOMMENDED", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    expect(brandStyle?.status).toBe("SUCCEEDED");
    expect(brandStyle?.sourceAssetId).toBe(derived.id);
    expect(brandStyle?.sourceEnhancementId).toBe(enhancement.id);

    const kept = await keepBrandStyle(owner.id, brandStyle!.id);
    const styled = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });
    expect(styled.origin).toBe("BRAND_STYLE");
    expect(styled.derivedFromId).toBe(derived.id);
    expect(styled.originalFilename).toBe("urun-iyilestirilmis-s1-marka-stili-s1.jpg");
    expect(styled.tags).toEqual(derived.tags);

    // Ne yüklenen orijinal ne de saklanan iyileştirme çıktısı değişti; üçü de kullanılabilir durumda.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: derived.id } })).toEqual(derived);
    expect(await storedBytes(source.storageKey)).toBe(originalBytes);
    expect(await storedBytes(derived.storageKey)).toBe(enhancedBytes);
    expect(await storedBytes(styled.storageKey)).not.toBe(enhancedBytes);
    expect(await prisma.mediaEnhancement.findUniqueOrThrow({ where: { id: enhancement.id } })).toEqual(enhancement);

    // Bir marka stili çıktısı yeniden stillendirilemez: zincir belirsizleşmez.
    await expect(createBrandStyle(owner.id, styled.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await listBrandStyleSummaries(owner.id, business.id)).get(styled.id)?.eligible).toBe(false);
  });

  it("derives stricter bounded operations for authenticity-sensitive results and never lets style widen them", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id, vibrantTones);

    // Gerçek ürün fotoğrafı: en dar katman.
    const food = await imageFixture(owner.id, business.id);
    await analyzeMediaAsset(owner.id, food.id, { provider: analysisProvider("FOOD"), skipRateLimit: true });
    const strict = await createBrandStyle(owner.id, food.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect(strict?.authenticityTier).toBe("STRICT");
    expect(strict?.authenticitySensitive).toBe(true);

    // Hassas ama ürün rengi kritik olmayan gerçek mekân fotoğrafı.
    const interior = await imageFixture(owner.id, business.id, ["PHOTO_ATMOSPHERE"]);
    await analyzeMediaAsset(owner.id, interior.id, { provider: analysisProvider("INTERIOR"), skipRateLimit: true });
    const standard = await createBrandStyle(owner.id, interior.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect(standard?.authenticityTier).toBe("STANDARD");
    expect(standard?.authenticitySensitive).toBe(true);

    // Gerçek sağlayıcıyla doğrulanmış saf tasarım görseli: normal sınır.
    const graphic = await imageFixture(owner.id, business.id, ["CUSTOM_GRAPHIC"]);
    await analyzeMediaAsset(owner.id, graphic.id, { provider: analysisProvider("GRAPHIC"), skipRateLimit: true });
    const relaxed = await createBrandStyle(owner.id, graphic.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect(relaxed?.authenticityTier).toBe("RELAXED");
    expect(relaxed?.authenticitySensitive).toBe(false);

    const saturation = (row: typeof strict) => (row!.operations as { saturation: number }).saturation;
    expect(saturation(strict)).toBeLessThan(saturation(standard));
    expect(saturation(standard)).toBeLessThan(saturation(relaxed));
    for (const row of [strict, standard, relaxed]) {
      expect(Object.keys(row!.operations as object).sort()).toEqual(["brightness", "contrast", "denoise", "saturation", "sharpen", "warmth"]);
    }

    // Analiz hiç yoksa ihtiyatla en dar katman uygulanır.
    const unanalyzed = await imageFixture(owner.id, business.id);
    const cautious = await createBrandStyle(owner.id, unanalyzed.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect([cautious?.authenticityTier, cautious?.authenticitySensitive]).toEqual(["STRICT", true]);
    expect(cautious?.operations).toEqual(strict?.operations);
  });

  it("keeps unverified content at the strictest tier: an unrecognized or planning-tag-derived class never unlocks the wider standard bounds", async () => {
    const { owner, business } = await businessFixture();
    const brand = await brandProfileFixture(business.id, vibrantTones);
    const profile = deriveBrandVisualStyleProfile(brand);
    const strictOperations = buildBrandStyleOperations("VIBRANT", profile, "STRICT");
    const standardOperations = buildBrandStyleOperations("VIBRANT", profile, "STANDARD");
    // Karşılaştırma anlamlı olsun: aynı stil isteği STANDARD'da gerçekten daha serbesttir.
    expect(standardOperations.saturation).toBeGreaterThan(strictOperations.saturation);

    // Gerçek sağlayıcı içeriği tanıyamadı: görselde tanınmamış gerçek bir ürün, mekân veya kişi olabilir.
    const unknown = await imageFixture(owner.id, business.id);
    await analyzeMediaAsset(owner.id, unknown.id, { provider: analysisProvider("UNKNOWN"), skipRateLimit: true });
    const detail = await getMediaAnalysisDetail(owner.id, unknown.id);
    expect(detail.current?.result.category).toBe("UNKNOWN");
    expect(detail.current?.result.authenticity.sensitive).toBe(true);

    const styled = await createBrandStyle(owner.id, unknown.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect([styled?.authenticityTier, styled?.authenticitySensitive]).toEqual(["STRICT", true]);
    expect(styled?.operations).toEqual(strictOperations);
    expect(styled?.operations).not.toEqual(standardOperations);

    // Ayarlar en dar katmanın sınırları içinde: renk ve sıcaklık neredeyse nötr, medyan filtre kapalı.
    const bounds = brandStyleBounds("STRICT");
    const operations = styled!.operations as BrandStyleOperations;
    expect(operations.saturation).toBeLessThanOrEqual(bounds.saturation[1]);
    expect(operations.saturation).toBeGreaterThanOrEqual(bounds.saturation[0]);
    expect(Math.abs(operations.warmth)).toBeLessThanOrEqual(bounds.warmth[1]);
    expect(operations.denoise).toBe(false);

    // Kategorisi yalnızca planlama etiketinden türeyen (görsel olarak doğrulanmamış) sonuç da dar kalır.
    const tagged = await imageFixture(owner.id, business.id, ["PHOTO_ATMOSPHERE"]);
    await analyzeMediaAsset(owner.id, tagged.id, { provider: new DevelopmentImageAnalysisProvider(), skipRateLimit: true });
    const taggedDetail = await getMediaAnalysisDetail(owner.id, tagged.id);
    expect([taggedDetail.current?.provenance, taggedDetail.current?.result.category]).toEqual(["DEVELOPMENT", "INTERIOR"]);
    const taggedStyle = await createBrandStyle(owner.id, tagged.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect([taggedStyle?.authenticityTier, taggedStyle?.authenticitySensitive]).toEqual(["STRICT", true]);
    expect(taggedStyle?.operations).toEqual(strictOperations);

    // Görsel olarak doğrulanmış saf tasarım görseli bundan etkilenmez: normal sınır korunur.
    const graphic = await imageFixture(owner.id, business.id, ["CUSTOM_GRAPHIC"]);
    await analyzeMediaAsset(owner.id, graphic.id, { provider: analysisProvider("GRAPHIC"), skipRateLimit: true });
    const relaxed = await createBrandStyle(owner.id, graphic.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect([relaxed?.authenticityTier, relaxed?.authenticitySensitive]).toEqual(["RELAXED", false]);
  });

  it("never lets a stored non-sensitive flag on a development graphic result unlock the widest bounds", async () => {
    const { owner, business } = await businessFixture();
    const brand = await brandProfileFixture(business.id, vibrantTones);
    const profile = deriveBrandVisualStyleProfile(brand);
    const strictOperations = buildBrandStyleOperations("VIBRANT", profile, "STRICT");
    const relaxedOperations = buildBrandStyleOperations("VIBRANT", profile, "RELAXED");
    // Karşılaştırma anlamlı olsun: aynı stil isteği RELAXED'te gerçekten daha serbesttir.
    expect(relaxedOperations.saturation).toBeGreaterThan(strictOperations.saturation);

    // P5-01'in özgünlük düzeltmesinden önce yazılmış ve geri doldurulmamış bir satırı birebir kur:
    // sınıfı yalnızca CUSTOM_GRAPHIC planlama etiketinden türeyen DEVELOPMENT sonucu, `sensitive: false`
    // olarak saklanmış. Bugün böyle bir kayıt hâlâ okunabilir ve tek başına gevşemeyi açmamalıdır.
    const legacy = await imageFixture(owner.id, business.id, ["CUSTOM_GRAPHIC"]);
    await analyzeMediaAsset(owner.id, legacy.id, { provider: new DevelopmentImageAnalysisProvider(), skipRateLimit: true });
    const analysis = await prisma.mediaAnalysis.findFirstOrThrow({ where: { mediaAssetId: legacy.id }, orderBy: { version: "desc" } });
    const current = readVisualAnalysisResult(analysis.result)!;
    expect([analysis.provenance, current.imageKind, current.category]).toEqual(["DEVELOPMENT", "GRAPHIC", "GRAPHIC"]);
    const legacyResult: VisualAnalysisResult = { ...current, authenticity: { ...current.authenticity, sensitive: false } };
    await prisma.mediaAnalysis.update({ where: { id: analysis.id }, data: { result: legacyResult as unknown as Prisma.InputJsonValue } });
    const stored = await getMediaAnalysisDetail(owner.id, legacy.id);
    expect([stored.current?.provenance, stored.current?.result.authenticity.sensitive]).toEqual(["DEVELOPMENT", false]);

    const styled = await createBrandStyle(owner.id, legacy.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect([styled?.authenticityTier, styled?.authenticitySensitive]).toEqual(["STRICT", true]);
    expect(styled?.operations).toEqual(strictOperations);
    expect(styled?.operations).not.toEqual(relaxedOperations);

    // Gevşeme yalnızca görsel olarak doğrulanmış (REAL) saf tasarım görselinde açık kalır.
    const verified = await imageFixture(owner.id, business.id, ["CUSTOM_GRAPHIC"]);
    await analyzeMediaAsset(owner.id, verified.id, { provider: analysisProvider("GRAPHIC"), skipRateLimit: true });
    const relaxedStyle = await createBrandStyle(owner.id, verified.id, "VIBRANT", { provider: passthroughProvider, skipRateLimit: true });
    expect([relaxedStyle?.authenticityTier, relaxedStyle?.authenticitySensitive]).toEqual(["RELAXED", false]);
    expect(relaxedStyle?.operations).toEqual(relaxedOperations);
  });

  it("marks provider failure, storage failure and invalid output without altering the source or creating a kept derivative", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const before = await storedBytes(asset.storageKey);
    const cases: Array<[ImageTransformProvider, "FAILED" | "INVALID_OUTPUT", string]> = [
      [fakeProvider(() => { throw new Error("PROVIDER_DOWN"); }), "FAILED", "PROVIDER_FAILED"],
      [fakeProvider(() => ({ bytes: new Uint8Array(0) })), "INVALID_OUTPUT", "SCHEMA_VALIDATION_FAILED"],
      [fakeProvider(() => ({ url: "https://vendor.example/out.jpg" })), "INVALID_OUTPUT", "SCHEMA_VALIDATION_FAILED"],
      [fakeProvider(() => ({ bytes: new Uint8Array([1, 2, 3, 4]) })), "INVALID_OUTPUT", "OUTPUT_NOT_DECODABLE"],
      [fakeProvider(async (input) => ({ bytes: new Uint8Array(await sharp(input.bytes).png().toBuffer()) })), "INVALID_OUTPUT", "OUTPUT_FORMAT_MISMATCH"],
      [fakeProvider(async (input) => ({ bytes: new Uint8Array(await sharp(input.bytes).resize(400, 500).jpeg().toBuffer()) })), "INVALID_OUTPUT", "OUTPUT_DIMENSIONS_CHANGED"],
    ];
    for (const [provider, status, errorCode] of cases) {
      const attempt = await createBrandStyle(owner.id, asset.id, "NATURAL", { provider, skipRateLimit: true });
      expect([attempt?.status, attempt?.errorCode]).toEqual([status, errorCode]);
      expect(attempt?.outputStorageKey).toBeNull();
      expect(attempt?.outputAssetId).toBeNull();
      await expect(keepBrandStyle(owner.id, attempt!.id)).rejects.toMatchObject({ code: "CONFLICT" });
    }

    const putSpy = vi.spyOn(storage, "put").mockRejectedValue(new Error("STORAGE_DOWN"));
    let storageFailure;
    try {
      storageFailure = await createBrandStyle(owner.id, asset.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    } finally {
      putSpy.mockRestore();
    }
    expect([storageFailure?.status, storageFailure?.errorCode]).toEqual(["FAILED", "STORAGE_FAILED"]);

    expect(await prisma.mediaBrandStyle.count({ where: { sourceAssetId: asset.id } })).toBe(cases.length + 1);
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id, origin: "BRAND_STYLE" } })).toBe(0);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storedBytes(asset.storageKey)).toBe(before);
  });

  it("labels the built-in provider honestly as a local development transform, never as AI", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const provider = new DevelopmentSharpTransformProvider();
    expect([provider.provider, provider.model, provider.provenance]).toEqual(["development-sharp-local", "none", "DEVELOPMENT"]);

    const brandStyle = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider, skipRateLimit: true });
    expect(brandStyle?.provenance).toBe("DEVELOPMENT");
    expect(brandStyle?.provider).toBe("development-sharp-local");
    const review = await getBrandStyleReview(owner.id, asset.id);
    expect(review.awaitingReview[0].provenance).toBe("DEVELOPMENT");

    // Enjekte edilen gerçek sağlayıcı REAL kaydedilir; provenance sağlayıcıdan gelir, çıktıdan değil.
    const real = await createBrandStyle(owner.id, asset.id, "NATURAL", { provider: fakeProvider((input) => ({ bytes: input.bytes, provenance: "DEVELOPMENT" })), skipRateLimit: true });
    expect(real?.provenance).toBe("REAL");
  });

  it("surfaces an understandable recommendation without exposing raw preferences, parameters or storage keys", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);

    const empty = await getBrandStyleReview(owner.id, asset.id);
    expect(empty.summary).toMatchObject({ eligible: true, ineligibleReason: null, awaitingReview: 0, kept: 0, pending: false, latestFailure: null });
    expect(empty.recommendation).toMatchObject({ recommended: "BRAND_RECOMMENDED", headline: "Sade ve seçkin", profileState: "COMPLETE" });
    expect(empty.recommendation.choices).toEqual(["BRAND_RECOMMENDED", "NATURAL", "VIBRANT"]);
    expect(empty.activeChoices).toEqual([]);
    expect(await getBrandStyleRecommendation(owner.id, asset.id)).toEqual(empty.recommendation);

    const brandStyle = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: passthroughProvider, skipRateLimit: true });
    const review = await getBrandStyleReview(owner.id, asset.id);
    expect(review.awaitingReview[0]).toMatchObject({ choice: "BRAND_RECOMMENDED", status: "SUCCEEDED", decision: null, outputAvailable: true, authenticityTier: "STRICT" });
    expect(review.activeChoices).toEqual(["BRAND_RECOMMENDED"]);
    expect(Object.keys(review.awaitingReview[0])).not.toContain("outputStorageKey");

    // Ham tercih değerleri, iç alan adları, parametreler ve depolama anahtarı arayüz sözleşmesinde yok.
    const serialized = JSON.stringify(review);
    for (const internal of ["corporateFriendly", "minimalVibrant", "luxuryAccessible", "modernNatural", "seriousPlayful", "toneDimensions", "brightness", "saturation", "warmth", "denoise", "styleProfile"]) {
      expect(serialized).not.toContain(internal);
    }
    expect(serialized).not.toContain(brandStyle!.outputStorageKey!);
  });

  it("offers a neutral recommendation and alternatives when the brand profile is missing or incomplete", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);

    const missing = await getBrandStyleReview(owner.id, asset.id);
    expect(missing.recommendation).toMatchObject({ profileState: "MISSING", headline: "Nötr ve doğal" });
    expect(missing.recommendation.choices).toEqual(["BRAND_RECOMMENDED", "VIBRANT", "PREMIUM"]);
    expect(missing.recommendation.rationale).toContain("Marka profiliniz henüz doldurulmadığı");
    expect(missing.summary.eligible).toBe(true);

    await brandProfileFixture(business.id, { minimalVibrant: 90 });
    const incomplete = await getBrandStyleReview(owner.id, asset.id);
    expect(incomplete.recommendation).toMatchObject({ profileState: "INCOMPLETE", headline: "Canlı ve sıcak" });
    expect(incomplete.recommendation.rationale).toContain("dengede kabul edildi");

    const brandStyle = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: passthroughProvider, skipRateLimit: true });
    expect(brandStyle?.status).toBe("SUCCEEDED");
    expect(brandStyle?.styleProfile).toMatchObject({ available: true, complete: false, nearestStyle: "VIBRANT" });
  });

  it("keeps a result as a separate usable asset and discards one without touching the source", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);

    const keepable = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    const kept = await keepBrandStyle(owner.id, keepable!.id);
    expect(kept.decision).toBe("KEPT");
    expect(kept.decidedById).toBe(owner.id);
    expect(kept.decidedAt).not.toBeNull();
    const styled = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });
    expect(styled.originalFilename).toBe("urun-marka-stili-s1.jpg");
    expect([styled.width, styled.height]).toEqual([asset.width, asset.height]);
    expect(styled.size).toBe(kept.outputSize);
    // Hem kaynak hem kabul edilen çıktı kullanılabilir; kaynağın silinmesi gerekmedi.
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(await storedBytes(styled.storageKey)).not.toBeNull();
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    // Tekrar "Sakla" aynı türevi döndürür; karar çevrilemez.
    expect((await keepBrandStyle(owner.id, keepable!.id)).outputAssetId).toBe(kept.outputAssetId);
    await expect(discardBrandStyle(owner.id, keepable!.id)).rejects.toMatchObject({ code: "CONFLICT" });

    const discardable = await createBrandStyle(owner.id, asset.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    const outputKey = discardable!.outputStorageKey!;
    const discarded = await discardBrandStyle(owner.id, discardable!.id);
    expect(discarded.decision).toBe("DISCARDED");
    expect(discarded.outputStorageKey).toBeNull();
    expect(await storage.get(outputKey)).toBeNull();
    expect(await readBrandStyleOutput(owner.id, discardable!.id)).toBeNull();
    await expect(keepBrandStyle(owner.id, discardable!.id)).rejects.toMatchObject({ code: "CONFLICT" });

    // Atma yalnızca türev baytları düşürdü: kaynak ve saklanan çıktı yerinde.
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storage.get(styled.storageKey)).not.toBeNull();
  });

  it("deduplicates concurrent identical requests and creates a new version for a decided re-run", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: fakeProvider((input) => ({ bytes: input.bytes }), { delayMs: 40 }), skipRateLimit: true })),
    );
    for (const result of results) expect(result.status).toBe("fulfilled");

    const rows = await prisma.mediaBrandStyle.findMany({ where: { sourceAssetId: asset.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SUCCEEDED");
    const ids = new Set(results.map((result) => (result as PromiseFulfilledResult<{ id: string } | null>).value?.id));
    expect(ids).toEqual(new Set([rows[0].id]));
    // Karar bekleyen bir sonuç varken aynı seçim tekrar istenirse yeni iş açılmaz.
    expect((await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: passthroughProvider, skipRateLimit: true }))?.id).toBe(rows[0].id);

    await keepBrandStyle(owner.id, rows[0].id);
    const rerun = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    expect(rerun?.id).not.toBe(rows[0].id);
    expect(rerun?.version).toBe(2);
    const other = await createBrandStyle(owner.id, asset.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    expect(other?.version).toBe(3);

    // Geçmiş korunur: ilk sürüm kararıyla ve çıktısıyla olduğu gibi durur.
    const first = await prisma.mediaBrandStyle.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(first.decision).toBe("KEPT");
    expect(await storage.get(first.outputStorageKey!)).not.toBeNull();
    const review = await getBrandStyleReview(owner.id, asset.id);
    expect(review.history.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(review.kept).toHaveLength(1);
    expect(review.awaitingReview.map((entry) => entry.version)).toEqual([3, 2]);
    expect((await listBrandStyleSummaries(owner.id, business.id)).get(asset.id)).toMatchObject({ eligible: true, awaitingReview: 2, kept: 1, pending: false, latestFailure: null });
  });

  it("keeps a historical run unchanged when the brand profile changes later", async () => {
    const { owner, business } = await businessFixture();
    const brand = await brandProfileFixture(business.id, premiumTones);
    const asset = await imageFixture(owner.id, business.id);
    const historical = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    await keepBrandStyle(owner.id, historical!.id);
    const keptOutputBytes = await storedBytes((await prisma.mediaBrandStyle.findUniqueOrThrow({ where: { id: historical!.id } })).outputStorageKey!);

    const updated = await prisma.brandProfile.update({ where: { id: brand.id }, data: { toneDimensions: vibrantTones } });
    expect(updated.updatedAt).not.toEqual(brand.updatedAt);

    const reloaded = await prisma.mediaBrandStyle.findUniqueOrThrow({ where: { id: historical!.id } });
    expect(reloaded.styleProfile).toMatchObject({ nearestStyle: "PREMIUM" });
    expect(reloaded.brandProfileUpdatedAt).toEqual(brand.updatedAt);
    expect(reloaded.operations).toEqual(historical!.operations);
    expect(await storedBytes(reloaded.outputStorageKey!)).toBe(keptOutputBytes);

    // Yeni çalıştırma güncel tercihleri kullanır; öneri de değişir.
    const fresh = await createBrandStyle(owner.id, asset.id, "BRAND_RECOMMENDED", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    expect(fresh?.styleProfile).toMatchObject({ nearestStyle: "VIBRANT" });
    expect(fresh?.brandProfileUpdatedAt).toEqual(updated.updatedAt);
    expect(fresh?.operations).not.toEqual(reloaded.operations);
    expect((await getBrandStyleReview(owner.id, asset.id)).recommendation.headline).toBe("Canlı ve sıcak");
  });

  it("cleans up the written derivative and leaves a recoverable failed attempt when the completion write fails", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);

    const writtenKeys: string[] = [];
    const originalPut = storage.put.bind(storage);
    const putSpy = vi.spyOn(storage, "put").mockImplementation(async (input) => {
      writtenKeys.push(input.key);
      return originalPut(input);
    });
    // Tamamlama yazımı düşer; kurtarma yazısı (failAttempt) gerçek istemciye gider.
    const delegate = prisma.mediaBrandStyle as unknown as { updateMany: (...args: unknown[]) => Promise<{ count: number }> };
    const originalUpdateMany = delegate.updateMany.bind(delegate);
    let failCompletion = true;
    const updateSpy = vi.spyOn(delegate, "updateMany").mockImplementation(async (...args) => {
      if (failCompletion) {
        failCompletion = false;
        throw new Error("DB_WRITE_LOST");
      }
      return originalUpdateMany(...args);
    });

    let attempt;
    try {
      attempt = await createBrandStyle(owner.id, asset.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    } finally {
      putSpy.mockRestore();
      updateSpy.mockRestore();
    }

    expect([attempt?.status, attempt?.errorCode]).toEqual(["FAILED", "COMPLETION_PERSIST_FAILED"]);
    expect(attempt?.outputStorageKey).toBeNull();
    expect(writtenKeys).toHaveLength(1);
    expect(writtenKeys[0]).not.toBe(asset.storageKey);
    expect(await storage.get(writtenKeys[0])).toBeNull();
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(1);

    // PENDING'de asılı kalmadığı için aynı seçim yeniden çalıştırılabilir.
    const retry = await createBrandStyle(owner.id, asset.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    expect([retry?.status, retry?.version]).toEqual(["SUCCEEDED", 2]);
  });

  it("enforces the hourly brand style rate limit per user and business", async () => {
    const { owner, business } = await businessFixture();
    await brandProfileFixture(business.id);
    const asset = await imageFixture(owner.id, business.id);
    await prisma.mediaBrandStyle.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        businessId: business.id, sourceAssetId: asset.id, version: index + 1, choice: "NATURAL" as const, status: "FAILED" as const,
        provider: "t", model: "t", provenance: "REAL" as const, styleVersion: "brand-style-v1", profileVersion: "brand-style-profile-v1", triggeredById: owner.id,
      })),
    });
    await expect(createBrandStyle(owner.id, asset.id, "NATURAL", { provider: passthroughProvider })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
