import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { uploadMedia } from "@/features/media/service";
import { createSafeEnhancement, keepSafeEnhancement } from "@/features/safe-enhance/service";
import { DevelopmentSharpTransformProvider } from "@/features/safe-enhance/providers/development";
import {
  createSocialVariant,
  discardSocialVariant,
  getSocialVariantReview,
  keepSocialVariant,
  listSocialVariantSummaries,
  readSocialVariantOutput,
} from "@/features/social-variant/service";
import { DevelopmentSharpReframeProvider } from "@/features/social-variant/providers/development";
import type { ImageReframeProvider } from "@/features/social-variant/providers/types";
import { maxSafeCropLoss, planReframe } from "@/features/social-variant/plan";

// P5-04A Sosyal Varyant testleri. Odak: kuralın gerçekten var olduğu yerde format sunmak, güvenli
// olmayan kırpmayı sessizce yapmamak, kaynağı hiçbir yolda değiştirmemek, soy/provenans kaydetmek,
// kiracı sınırını korumak ve Sakla/At kararını eşzamanlılık altında tutarlı tutmak.

async function businessFixture(suffix = "") {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `sv-owner-${suffix}${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: { name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul", memberships: { create: { userId: owner.id, role: "OWNER" } } },
  });
  return { owner, business };
}

/** Ton geçişi olan bir kaynak: kırpmanın gerçekten uygulandığı piksellerden görülebilsin. */
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

async function imageFixture(userId: string, businessId: string, width = 900, height = 1000, tags: string[] = ["PHOTO_PRODUCT"]) {
  const file = new File([await jpegBytes(width, height)], "urun.jpg", { type: "image/jpeg" });
  return uploadMedia(userId, businessId, file, tags);
}

async function storedBytes(key: string) {
  const object = await storage.get(key);
  return object ? createHash("sha256").update(object.bytes).digest("hex") : null;
}

/**
 * Gerçek bir ASPECT_RATIO kuralı. Sosyal Varyant hedef oranı yalnızca buradan okur; testler de
 * kuralı kurmadan hiçbir format beklemez.
 */
async function aspectRule(
  businessId: string | null,
  platform: "INSTAGRAM" | "FACEBOOK" | "TIKTOK",
  contentType: "POST" | "REEL" | "STORY" | "CAROUSEL" | null,
  recommended: string,
  supported: string[] = [],
) {
  return prisma.platformRule.create({
    data: {
      businessId, platform, contentType, category: "ASPECT_RATIO",
      ruleKey: `test.aspect.${platform.toLowerCase()}.${(contentType ?? "all").toLowerCase()}`,
      value: { recommended, ...(supported.length ? { supported } : {}) },
      recommendationType: "BEST_PRACTICE", source: "MANUAL_ADMIN_RULE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
      confidence: 0.9, sectorScope: [], active: true,
    },
  });
}

/** Instagram için Akış (4:5, 1:1 destekli), Hikâye ve Reel (9:16) kuralları. */
async function instagramRules(businessId: string | null) {
  const post = await aspectRule(businessId, "INSTAGRAM", "POST", "4:5", ["1:1"]);
  const story = await aspectRule(businessId, "INSTAGRAM", "STORY", "9:16");
  const reel = await aspectRule(businessId, "INSTAGRAM", "REEL", "9:16");
  return { post, story, reel };
}

function fakeProvider(
  reframe: (input: { bytes: Uint8Array }) => Promise<unknown> | unknown,
  options: { provenance?: "REAL" | "DEVELOPMENT"; delayMs?: number } = {},
): ImageReframeProvider {
  return {
    provider: "test-reframe",
    model: "test-model",
    provenance: options.provenance ?? "REAL",
    async reframe(input) {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return reframe(input);
    },
  };
}

const localProvider = () => new DevelopmentSharpReframeProvider();

/**
 * Gerçekten yeniden çerçeveleyen ama etiketi/gecikmesi testten gelen sağlayıcı. Baytları olduğu gibi
 * geri veren bir sağlayıcı burada kullanılamaz: çıktı boyutu hedefle uyuşmaz ve doğrulama onu
 * haklı olarak reddeder.
 */
function reframingProvider(options: { provenance?: "REAL" | "DEVELOPMENT"; delayMs?: number } = {}): ImageReframeProvider {
  const inner = new DevelopmentSharpReframeProvider();
  return {
    provider: options.provenance === "REAL" ? "test-reframe" : inner.provider,
    model: options.provenance === "REAL" ? "test-model" : inner.model,
    provenance: options.provenance ?? inner.provenance,
    async reframe(input) {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return inner.reframe(input);
    },
  };
}

/** Yüklemeden → güvenli iyileştirme → "Sakla" ile oluşan özgün türev medya. */
async function keptEnhancementFixture(userId: string, businessId: string) {
  const source = await imageFixture(userId, businessId);
  const enhancement = await createSafeEnhancement(userId, source.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
  const kept = await keepSafeEnhancement(userId, enhancement!.id);
  const derived = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });
  return { source, enhancement: kept, derived };
}

describe("Ainetra P5-04A — social variants", () => {
  it("creates a versioned technical derivative from a real platform rule, records provenance and lineage, and leaves the source untouched", async () => {
    const { owner, business } = await businessFixture();
    const { post } = await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);

    const variant = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(variant?.status).toBe("SUCCEEDED");
    expect(variant?.version).toBe(1);
    expect(variant?.platform).toBe("INSTAGRAM");
    expect(variant?.contentType).toBe("POST");
    expect(variant?.format).toBe("FEED");

    // Kural provenansı: hangi kuraldan, hangi yürürlük tarihiyle ve hangi anlık görüntüyle.
    expect(variant?.ruleId).toBe(post.id);
    expect(variant?.ruleKey).toBe(post.ruleKey);
    expect(variant?.ruleEffectiveFrom).toEqual(post.effectiveFrom);
    expect(variant?.targetAspectRatio).toBe("4:5");
    expect(variant?.variantVersion).toBe("social-variant-v1");
    const snapshot = variant?.ruleSnapshot as { recommendedAspectRatio: string; supportedAspectRatios: string[]; recommendationType: string };
    expect(snapshot.recommendedAspectRatio).toBe("4:5");
    expect(snapshot.supportedAspectRatios).toEqual(["1:1"]);
    expect(snapshot.recommendationType).toBe("BEST_PRACTICE");

    // 900×1000 kaynak 4:5'e küçük bir kayıpla oturuyor: güvenli merkez kırpma uygulanır.
    expect(variant?.fit).toBe("COVER");
    expect(variant?.reviewNeeded).toBe(false);
    expect(variant?.outputWidth).toBe(800);
    expect(variant?.outputHeight).toBe(1000);
    expect(variant?.outputMimeType).toBe("image/jpeg");

    // Soy: doğrudan kaynak ve zincirin kökü yüklenen orijinaldir.
    expect(variant?.sourceAssetId).toBe(asset.id);
    expect(variant?.rootAssetId).toBe(asset.id);
    expect(variant?.sourceEnhancementId).toBeNull();
    expect(variant?.sourceBrandStyleId).toBeNull();
    expect(variant?.triggeredById).toBe(owner.id);

    // Kaynak satırı da baytları da hiçbir yolda değişmedi; çıktı ayrı bir anahtarda.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(variant?.outputStorageKey).not.toBe(asset.storageKey);
    expect(await storage.get(variant!.outputStorageKey!)).not.toBeNull();
  });

  it("offers Feed, Story and Reel cover only where a real aspect ratio rule exists and refuses a format without one", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);

    const review = await getSocialVariantReview(owner.id, asset.id);
    const offered = review.choices.map((choice) => `${choice.platform}:${choice.format}`);
    expect(offered).toContain("INSTAGRAM:FEED");
    expect(offered).toContain("INSTAGRAM:STORY");
    expect(offered).toContain("INSTAGRAM:REEL_COVER");
    // Kuralı olmayan platform için hiçbir seçenek üretilmez; oran varsayılmaz.
    expect(offered.some((entry) => entry.startsWith("FACEBOOK") || entry.startsWith("TIKTOK"))).toBe(false);
    expect(review.choices.find((choice) => choice.format === "FEED")?.targetAspectRatio).toBe("4:5");
    expect(review.choices.find((choice) => choice.format === "STORY")?.targetAspectRatio).toBe("9:16");
    expect(review.choices.find((choice) => choice.format === "REEL_COVER")?.targetAspectRatio).toBe("9:16");
    expect(review.choices.find((choice) => choice.format === "REEL_COVER")?.contentType).toBe("REEL");
    // Kare yalnızca kuralın 1:1'i gerçekten desteklediği yerde sunulur.
    expect(offered).toContain("INSTAGRAM:SQUARE");

    await expect(createSocialVariant(owner.id, asset.id, "FACEBOOK", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createSocialVariant(owner.id, asset.id, "INSTAGRAM", "BANNER", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaSocialVariant.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("does not offer the square action when the rule itself does not support 1:1", async () => {
    const { owner, business } = await businessFixture();
    await aspectRule(business.id, "INSTAGRAM", "POST", "4:5");
    const asset = await imageFixture(owner.id, business.id);

    const review = await getSocialVariantReview(owner.id, asset.id);
    expect(review.choices.map((choice) => choice.format)).toEqual(["FEED"]);
    await expect(createSocialVariant(owner.id, asset.id, "INSTAGRAM", "SQUARE", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("protects the photo with a full-frame contain result and flags it for review when no safe crop exists", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);

    // Seçenek, kullanıcı istemeden önce ne olacağını zaten söylüyor.
    const before = await getSocialVariantReview(owner.id, asset.id);
    const storyChoice = before.choices.find((choice) => choice.format === "STORY");
    expect(storyChoice?.fit).toBe("CONTAIN");
    expect(storyChoice?.reviewNeeded).toBe(true);

    const variant = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "STORY", { provider: localProvider(), skipRateLimit: true });
    expect(variant?.status).toBe("SUCCEEDED");
    expect(variant?.fit).toBe("CONTAIN");
    expect(variant?.reviewNeeded).toBe(true);
    // 900×1000 fotoğraf 9:16 tuvale tamamen sığdırıldı: hiçbir kenar kesilmedi.
    expect(variant?.outputWidth).toBe(900);
    expect(variant?.outputHeight).toBe(1600);
    const operations = variant?.operations as { fit: string; crop: { left: number; top: number; width: number; height: number } };
    expect(operations.fit).toBe("CONTAIN");
    expect(operations.crop).toEqual({ left: 0, top: 0, width: 900, height: 1000 });

    // Boşluk marka tercihlerinden türetilen düz renkle dolduruldu (profil yok → nötr küme).
    const output = await storage.get(variant!.outputStorageKey!);
    const { data } = await sharp(output!.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(238);
    expect(data[1]).toBeGreaterThan(235);
    expect(data[2]).toBeGreaterThan(228);

    // Kırpma eşiği bir iddia değil, ölçülen bir sınır: eşiğin altında kırpılır, üstünde korunur.
    expect(planReframe({ width: 900, height: 1000, targetRatio: 4 / 5, padColor: { r: 0, g: 0, b: 0 } }).cropLoss).toBeLessThanOrEqual(maxSafeCropLoss);
    expect(planReframe({ width: 900, height: 1000, targetRatio: 9 / 16, padColor: { r: 0, g: 0, b: 0 } }).cropLoss).toBeGreaterThan(maxSafeCropLoss);
  });

  it("keeps a decided variant as a separate usable media asset without approving, planning or publishing content", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);
    const variant = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });

    const kept = await keepSocialVariant(owner.id, variant!.id);
    expect(kept.decision).toBe("KEPT");
    expect(kept.decidedById).toBe(owner.id);
    expect(kept.decidedAt).not.toBeNull();

    const output = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });
    expect(output.origin).toBe("SOCIAL_VARIANT");
    expect(output.derivedFromId).toBe(asset.id);
    expect(output.originalFilename).toBe("urun-akis-s1.jpg");
    expect(output.width).toBe(800);
    expect(output.height).toBe(1000);
    // Teknik türev kaynağı kadar özgündür: planlama etiketleri olduğu gibi devralınır.
    expect(output.tags).toEqual(asset.tags);
    expect(output.storageKey).toBe(variant?.outputStorageKey);

    // Kaynak değişmedi ve saklama hiçbir içeriği onaylamadı, planlamadı veya yayınlamadı.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(await prisma.contentPlanItem.count({ where: { plan: { businessId: business.id } } })).toBe(0);
    expect(await prisma.contentVariant.count()).toBe(0);
    expect(await prisma.mediaUsage.count({ where: { businessId: business.id } })).toBe(0);

    // Saklanan sürümden yeni bir sürüm çıkarılmaz: zincir belirsizleşmez.
    await expect(createSocialVariant(owner.id, output.id, "INSTAGRAM", "STORY", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await listSocialVariantSummaries(owner.id, business.id)).get(output.id)?.eligible).toBe(false);
    expect((await listSocialVariantSummaries(owner.id, business.id)).get(asset.id)?.kept).toBe(1);
  });

  it("discards only its own derivative and leaves the source and other kept variants intact", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);

    const keepable = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    const kept = await keepSocialVariant(owner.id, keepable!.id);
    const keptAsset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });

    const discardable = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "STORY", { provider: localProvider(), skipRateLimit: true });
    const discardedKey = discardable!.outputStorageKey!;
    const discarded = await discardSocialVariant(owner.id, discardable!.id);
    expect(discarded.decision).toBe("DISCARDED");
    expect(discarded.outputStorageKey).toBeNull();
    expect(await storage.get(discardedKey)).toBeNull();
    // Atılan bir çıktı artık önizlenmez.
    expect(await readSocialVariantOutput(owner.id, discardable!.id)).toBeNull();

    // Yalnızca o türev düştü: kaynak ve saklanan sürüm yerinde.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(await storage.get(keptAsset.storageKey)).not.toBeNull();

    // Karar verilmiş bir sonuç bir daha karara açılmaz.
    await expect(keepSocialVariant(owner.id, discardable!.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(discardSocialVariant(owner.id, keepable!.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects create, read, keep, discard and preview for a user from another tenant", async () => {
    const { owner, business } = await businessFixture("a");
    const other = await businessFixture("b");
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const variant = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });

    await expect(createSocialVariant(other.owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getSocialVariantReview(other.owner.id, asset.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listSocialVariantSummaries(other.owner.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(keepSocialVariant(other.owner.id, variant!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(discardSocialVariant(other.owner.id, variant!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await readSocialVariantOutput(other.owner.id, variant!.id)).toBeNull();

    // Reddedilen istekler hiçbir şey yazmadı ya da silmedi.
    expect(await prisma.mediaSocialVariant.count({ where: { businessId: business.id } })).toBe(1);
    expect(await prisma.mediaSocialVariant.findUniqueOrThrow({ where: { id: variant!.id } })).toEqual(variant);
    expect((await listSocialVariantSummaries(other.owner.id, other.business.id)).size).toBe(0);
  });

  it("rejects unsupported media without creating a row and explains why in the summary", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);

    const video = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "VIDEO", originalFilename: "teras.mp4", mimeType: "video/mp4", size: 100, storageKey: `${business.id}/${crypto.randomUUID()}.mp4`, tags: [] },
    });
    await expect(createSocialVariant(owner.id, video.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Kısa kenarı yetersiz bir kaynaktan format sürümü üretilmez.
    const small = await imageFixture(owner.id, business.id, 240, 300);
    await expect(createSocialVariant(owner.id, small.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(createSocialVariant(owner.id, "missing-media", "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    const summaries = await listSocialVariantSummaries(owner.id, business.id);
    expect(summaries.get(video.id)?.eligible).toBe(false);
    expect(summaries.get(video.id)?.ineligibleReason).toBeTruthy();
    expect(summaries.get(small.id)?.eligible).toBe(false);
    expect((await getSocialVariantReview(owner.id, video.id)).choices).toEqual([]);
    expect(await prisma.mediaSocialVariant.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("records honest development provenance for the local deterministic reframe", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);

    const variant = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(variant?.provenance).toBe("DEVELOPMENT");
    expect(variant?.provider).toBe("development-sharp-local");
    expect(variant?.model).toBe("none");

    // Provenans sağlayıcıdan gelir; yerel işlem kendini gerçek bir servis olarak sunamaz.
    const real = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "STORY", { provider: reframingProvider({ provenance: "REAL" }), skipRateLimit: true });
    expect(real?.status).toBe("SUCCEEDED");
    expect(real?.provenance).toBe("REAL");
    expect(real?.provider).toBe("test-reframe");
  });

  it("marks provider failure and every invalid output without persisting an output or touching the source", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);

    const failing = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", {
      provider: fakeProvider(() => { throw new Error("PROVIDER_DOWN"); }), skipRateLimit: true,
    });
    expect(failing?.status).toBe("FAILED");
    expect(failing?.errorCode).toBe("PROVIDER_FAILED");

    const notDecodable = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", {
      provider: fakeProvider(() => ({ bytes: new Uint8Array([1, 2, 3, 4]) })), skipRateLimit: true,
    });
    expect(notDecodable?.status).toBe("INVALID_OUTPUT");
    expect(notDecodable?.errorCode).toBe("OUTPUT_NOT_DECODABLE");

    const wrongShape = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", {
      provider: fakeProvider(() => ({ bytes: "not-bytes" })), skipRateLimit: true,
    });
    expect(wrongShape?.status).toBe("INVALID_OUTPUT");
    expect(wrongShape?.errorCode).toBe("SCHEMA_VALIDATION_FAILED");

    // Kaynak JPEG; PNG çıktı kabul edilmez.
    const wrongFormat = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", {
      provider: fakeProvider(async (input) => ({ bytes: new Uint8Array(await sharp(input.bytes).png().toBuffer()) })), skipRateLimit: true,
    });
    expect(wrongFormat?.status).toBe("INVALID_OUTPUT");
    expect(wrongFormat?.errorCode).toBe("OUTPUT_FORMAT_MISMATCH");

    // İstenen geometriye uymayan bir çıktı da kaydedilmez.
    const wrongSize = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", {
      provider: fakeProvider(async (input) => ({ bytes: new Uint8Array(await sharp(input.bytes).resize({ width: 123, height: 456, fit: "fill" }).jpeg().toBuffer()) })), skipRateLimit: true,
    });
    expect(wrongSize?.status).toBe("INVALID_OUTPUT");
    expect(wrongSize?.errorCode).toBe("OUTPUT_DIMENSIONS_UNEXPECTED");

    // Hiçbir başarısız deneme çıktı yazmadı ve kaynağa dokunmadı.
    const rows = await prisma.mediaSocialVariant.findMany({ where: { sourceAssetId: asset.id } });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.outputStorageKey).toBeNull();
      expect(row.outputAssetId).toBeNull();
      expect(row.completedAt).not.toBeNull();
      await expect(keepSocialVariant(owner.id, row.id)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
  });

  it("deduplicates concurrent identical requests and versions decided re-runs while preserving history", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", {
        provider: reframingProvider({ delayMs: 40 }), skipRateLimit: true,
      })),
    );
    for (const result of results) expect(result.status).toBe("fulfilled");

    const rows = await prisma.mediaSocialVariant.findMany({ where: { sourceAssetId: asset.id, format: "FEED" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SUCCEEDED");
    const ids = new Set(results.map((result) => (result as PromiseFulfilledResult<{ id: string } | null>).value?.id));
    expect(ids).toEqual(new Set([rows[0].id]));

    // Karar bekleyen bir sonuç varken aynı seçim tekrar istenirse yeni iş açılmaz.
    expect((await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true }))?.id).toBe(rows[0].id);
    // Farklı bir format ayrı bir sürümdür.
    const story = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "STORY", { provider: localProvider(), skipRateLimit: true });
    expect(story?.version).toBe(2);

    await keepSocialVariant(owner.id, rows[0].id);
    const rerun = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(rerun?.id).not.toBe(rows[0].id);
    expect(rerun?.version).toBe(3);

    // Geçmiş korunur: ilk sürüm kararıyla ve çıktısıyla olduğu gibi durur.
    const first = await prisma.mediaSocialVariant.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(first.decision).toBe("KEPT");
    expect(await storage.get(first.outputStorageKey!)).not.toBeNull();
    const review = await getSocialVariantReview(owner.id, asset.id);
    expect(review.history.map((entry) => entry.version)).toEqual([3, 2, 1]);
  });

  it("settles concurrent keep and discard on one decision without orphaning or deleting the wrong bytes", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const variant = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    const outputKey = variant!.outputStorageKey!;

    const results = await Promise.allSettled([
      keepSocialVariant(owner.id, variant!.id),
      discardSocialVariant(owner.id, variant!.id),
      keepSocialVariant(owner.id, variant!.id),
      discardSocialVariant(owner.id, variant!.id),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);

    const settled = await prisma.mediaSocialVariant.findUniqueOrThrow({ where: { id: variant!.id } });
    expect(settled.decidedById).toBe(owner.id);
    if (settled.decision === "KEPT") {
      // Saklandıysa çıktı ayrı bir medya olarak kütüphanededir ve baytları silinmemiştir.
      const output = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: settled.outputAssetId! } });
      expect(output.storageKey).toBe(outputKey);
      expect(await storage.get(outputKey)).not.toBeNull();
    } else {
      expect(settled.decision).toBe("DISCARDED");
      expect(settled.outputAssetId).toBeNull();
      expect(await prisma.mediaAsset.count({ where: { businessId: business.id, origin: "SOCIAL_VARIANT" } })).toBe(0);
    }
    // Kaynak her iki sonuçta da yerinde.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
  });

  it("records lineage through a kept safe enhance derivative and keeps every source row and byte immutable", async () => {
    const { owner, business } = await businessFixture();
    await instagramRules(business.id);
    const { source, enhancement, derived } = await keptEnhancementFixture(owner.id, business.id);
    const originalBytes = await storedBytes(source.storageKey);
    const enhancedBytes = await storedBytes(derived.storageKey);

    const variant = await createSocialVariant(owner.id, derived.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });
    expect(variant?.status).toBe("SUCCEEDED");
    // Doğrudan kaynak iyileştirme çıktısı, kök ise yüklenen orijinaldir.
    expect(variant?.sourceAssetId).toBe(derived.id);
    expect(variant?.rootAssetId).toBe(source.id);
    expect(variant?.sourceEnhancementId).toBe(enhancement.id);
    expect(variant?.sourceBrandStyleId).toBeNull();

    const kept = await keepSocialVariant(owner.id, variant!.id);
    const output = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });
    expect(output.origin).toBe("SOCIAL_VARIANT");
    expect(output.derivedFromId).toBe(derived.id);
    expect(output.originalFilename).toBe("urun-iyilestirilmis-s1-akis-s1.jpg");

    // Zincirdeki hiçbir kaynak satırı ya da baytı değişmedi; üçü de kullanılabilir durumda.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: derived.id } })).toEqual(derived);
    expect(await storedBytes(source.storageKey)).toBe(originalBytes);
    expect(await storedBytes(derived.storageKey)).toBe(enhancedBytes);
    expect(await prisma.mediaEnhancement.findUniqueOrThrow({ where: { id: enhancement.id } })).toEqual(enhancement);
  });

  it("previews an undecided output only for a member of the owning tenant", async () => {
    const { owner, business } = await businessFixture("p");
    const other = await businessFixture("q");
    await instagramRules(business.id);
    const asset = await imageFixture(owner.id, business.id);
    const variant = await createSocialVariant(owner.id, asset.id, "INSTAGRAM", "FEED", { provider: localProvider(), skipRateLimit: true });

    const preview = await readSocialVariantOutput(owner.id, variant!.id);
    expect(preview?.mimeType).toBe("image/jpeg");
    expect((await sharp(preview!.bytes).metadata()).width).toBe(800);
    expect(await readSocialVariantOutput(other.owner.id, variant!.id)).toBeNull();

    // İnceleme listesi depolama anahtarını arayüze taşımaz.
    const review = await getSocialVariantReview(owner.id, asset.id);
    expect(review.awaitingReview).toHaveLength(1);
    expect(review.awaitingReview[0].outputAvailable).toBe(true);
    expect(review.awaitingReview[0]).not.toHaveProperty("outputStorageKey");
  });
});
