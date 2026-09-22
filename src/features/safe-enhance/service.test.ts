import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { uploadMedia } from "@/features/media/service";
import { analyzeMediaAsset } from "@/features/visual-analysis/service";
import type { ImageAnalysisProvider } from "@/features/visual-analysis/providers/types";
import {
  createSafeEnhancement,
  discardSafeEnhancement,
  getSafeEnhanceReview,
  keepSafeEnhancement,
  listSafeEnhanceSummaries,
  readSafeEnhancementOutput,
} from "@/features/safe-enhance/service";
import { DevelopmentSharpTransformProvider } from "@/features/safe-enhance/providers/development";
import type { ImageTransformProvider } from "@/features/safe-enhance/providers/types";
import { operationsForPreset } from "@/features/safe-enhance/presets";
import { enhancementPresets, safeEnhanceOperationsSchema } from "@/features/safe-enhance/schemas";

async function businessFixture(suffix = "") {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `se-owner-${suffix}${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: { name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul", memberships: { create: { userId: owner.id, role: "OWNER" } } },
  });
  return { owner, business };
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

async function imageFixture(userId: string, businessId: string, width = 800, height = 1000, tags: string[] = ["PHOTO_PRODUCT"]) {
  const file = new File([await jpegBytes(width, height)], "urun.jpg", { type: "image/jpeg" });
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

function analysisProvider(sensitiveKind: "PHOTO" | "GRAPHIC"): ImageAnalysisProvider {
  return {
    provider: "test-vision",
    model: "test-model",
    provenance: "REAL",
    async analyze() {
      return {
        imageKind: sensitiveKind,
        dominantSubject: sensitiveKind === "PHOTO" ? "Izgara steak tabağı" : "Kampanya afişi",
        category: sensitiveKind === "PHOTO" ? "FOOD" : "GRAPHIC",
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

describe("Ainetra P5-02 — safe enhance", () => {
  it("creates a versioned derivative for an owned image and leaves the original row and bytes untouched", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const before = await storedBytes(asset.storageKey);

    const enhancement = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    expect(enhancement?.status).toBe("SUCCEEDED");
    expect(enhancement?.version).toBe(1);
    expect(enhancement?.preset).toBe("NATURAL");
    expect(enhancement?.decision).toBeNull();
    expect(enhancement?.parameterVersion).toBe("safe-enhance-v1");
    expect(enhancement?.outputStorageKey).toBeTruthy();
    expect(enhancement?.outputStorageKey).not.toBe(asset.storageKey);
    expect(enhancement?.outputWidth).toBe(asset.width);
    expect(enhancement?.outputHeight).toBe(asset.height);
    expect(enhancement?.outputMimeType).toBe("image/jpeg");
    expect(enhancement?.sourceAssetId).toBe(asset.id);
    expect(enhancement?.businessId).toBe(business.id);
    expect(enhancement?.triggeredById).toBe(owner.id);

    const source = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(source).toEqual(asset);
    expect(source.origin).toBe("UPLOAD");
    expect(await storedBytes(asset.storageKey)).toBe(before);
    // Çıktı gerçekten ayrı ve orijinalden farklı baytlar.
    expect(await storedBytes(enhancement!.outputStorageKey!)).not.toBe(before);
  });

  it("stores only the bounded pixel-level operation set; the contract cannot express a generative operation", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const enhancement = await createSafeEnhancement(owner.id, asset.id, "WARM", { provider: passthroughProvider, skipRateLimit: true });
    expect(Object.keys(enhancement!.operations as object).sort()).toEqual(["brightness", "contrast", "denoise", "saturation", "sharpen", "warmth"]);
    expect(enhancement!.operations).toEqual(operationsForPreset("WARM"));
    expect(safeEnhanceOperationsSchema.safeParse({ ...operationsForPreset("WARM"), replaceBackground: true }).success).toBe(false);
    expect(safeEnhanceOperationsSchema.safeParse({ ...operationsForPreset("WARM"), brightness: 1.9 }).success).toBe(false);
    for (const preset of enhancementPresets) expect(safeEnhanceOperationsSchema.safeParse(operationsForPreset(preset)).success).toBe(true);
  });

  it("rejects create, read, keep and discard for a user from another tenant", async () => {
    const { owner, business } = await businessFixture("a");
    const other = await businessFixture("b");
    const asset = await imageFixture(owner.id, business.id);

    await expect(createSafeEnhancement(other.owner.id, asset.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.mediaEnhancement.count({ where: { sourceAssetId: asset.id } })).toBe(0);

    const enhancement = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    await expect(getSafeEnhanceReview(other.owner.id, asset.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listSafeEnhanceSummaries(other.owner.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(keepSafeEnhancement(other.owner.id, enhancement!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(discardSafeEnhancement(other.owner.id, enhancement!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await readSafeEnhancementOutput(other.owner.id, enhancement!.id)).toBeNull();
    expect(await readSafeEnhancementOutput(owner.id, enhancement!.id)).not.toBeNull();

    const stored = await prisma.mediaEnhancement.findUniqueOrThrow({ where: { id: enhancement!.id } });
    expect(stored.decision).toBeNull();
    expect((await listSafeEnhanceSummaries(other.owner.id, other.business.id)).has(asset.id)).toBe(false);
  });

  it("rejects unsupported media without creating any enhancement row", async () => {
    const { owner, business } = await businessFixture();
    const video = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "VIDEO", originalFilename: "teras.mp4", mimeType: "video/mp4", size: 100, storageKey: `${business.id}/${crypto.randomUUID()}.mp4`, tags: [] },
    });
    await expect(createSafeEnhancement(owner.id, video.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaEnhancement.count({ where: { sourceAssetId: video.id } })).toBe(0);
    expect((await listSafeEnhanceSummaries(owner.id, business.id)).get(video.id)?.eligible).toBe(false);

    const asset = await imageFixture(owner.id, business.id);
    await expect(createSafeEnhancement(owner.id, asset.id, "VIVID", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaEnhancement.count({ where: { sourceAssetId: asset.id } })).toBe(0);
  });

  it("marks provider failure, storage failure and invalid output without altering the original or creating a kept derivative", async () => {
    const { owner, business } = await businessFixture();
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
      const attempt = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider, skipRateLimit: true });
      expect([attempt?.status, attempt?.errorCode]).toEqual([status, errorCode]);
      expect(attempt?.outputStorageKey).toBeNull();
      expect(attempt?.outputAssetId).toBeNull();
      await expect(keepSafeEnhancement(owner.id, attempt!.id)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await prisma.mediaEnhancement.count({ where: { sourceAssetId: asset.id } })).toBe(cases.length);
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id, origin: "SAFE_ENHANCE" } })).toBe(0);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storedBytes(asset.storageKey)).toBe(before);
  });

  it("labels the built-in provider honestly as a local development transform, never as AI", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const provider = new DevelopmentSharpTransformProvider();
    expect([provider.provider, provider.model, provider.provenance]).toEqual(["development-sharp-local", "none", "DEVELOPMENT"]);

    const enhancement = await createSafeEnhancement(owner.id, asset.id, "BRIGHT", { provider, skipRateLimit: true });
    expect(enhancement?.provenance).toBe("DEVELOPMENT");
    expect(enhancement?.provider).toBe("development-sharp-local");
    const review = await getSafeEnhanceReview(owner.id, asset.id);
    expect(review.awaitingReview[0].provenance).toBe("DEVELOPMENT");

    // Enjekte edilen gerçek sağlayıcı REAL kaydedilir; provenance sağlayıcıdan gelir, çıktıdan değil.
    const real = await createSafeEnhancement(owner.id, asset.id, "CLEAN", { provider: fakeProvider((input) => ({ bytes: input.bytes, provenance: "DEVELOPMENT" })), skipRateLimit: true });
    expect(real?.provenance).toBe("REAL");
  });

  it("never exposes the raw storage key or provider payload through the review contract", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const enhancement = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    const review = await getSafeEnhanceReview(owner.id, asset.id);
    const item = review.awaitingReview[0];
    expect(item.outputAvailable).toBe(true);
    expect(Object.keys(item)).not.toContain("outputStorageKey");
    expect(JSON.stringify(review)).not.toContain(enhancement!.outputStorageKey!);
  });

  it("keeps authenticity-sensitive input sensitive and defaults to sensitive when there is no analysis", async () => {
    const { owner, business } = await businessFixture();
    const unanalyzed = await imageFixture(owner.id, business.id);
    const withoutAnalysis = await createSafeEnhancement(owner.id, unanalyzed.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    expect(withoutAnalysis?.authenticitySensitive).toBe(true);
    expect(withoutAnalysis?.sourceAnalysisId).toBeNull();

    const photo = await imageFixture(owner.id, business.id);
    const analysis = await analyzeMediaAsset(owner.id, photo.id, { provider: analysisProvider("PHOTO"), skipRateLimit: true });
    const sensitive = await createSafeEnhancement(owner.id, photo.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    expect(sensitive?.authenticitySensitive).toBe(true);
    expect(sensitive?.sourceAnalysisId).toBe(analysis!.id);

    // Özgünlük açısından hassas olmayan (gerçek sağlayıcıyla doğrulanmış saf grafik) girdi de aynı
    // dar operasyon setini kullanır; yalnızca kayıttaki hassasiyet bayrağı analizden gelir.
    const graphic = await imageFixture(owner.id, business.id, 800, 1000, ["CUSTOM_GRAPHIC"]);
    await analyzeMediaAsset(owner.id, graphic.id, { provider: analysisProvider("GRAPHIC"), skipRateLimit: true });
    const relaxed = await createSafeEnhancement(owner.id, graphic.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    expect(relaxed?.authenticitySensitive).toBe(false);
    expect(relaxed!.operations).toEqual(operationsForPreset("NATURAL"));
  });

  it("keeps a result as a separate usable derived asset while the original stays usable and unchanged", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);
    const enhancement = await createSafeEnhancement(owner.id, asset.id, "BRIGHT", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });

    const kept = await keepSafeEnhancement(owner.id, enhancement!.id);
    expect(kept.decision).toBe("KEPT");
    expect(kept.decidedById).toBe(owner.id);
    expect(kept.decidedAt).not.toBeNull();
    expect(kept.outputAssetId).toBeTruthy();

    const derived = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.outputAssetId! } });
    expect(derived.id).not.toBe(asset.id);
    expect(derived.origin).toBe("SAFE_ENHANCE");
    expect(derived.derivedFromId).toBe(asset.id);
    expect(derived.businessId).toBe(business.id);
    expect(derived.type).toBe("IMAGE");
    expect(derived.mimeType).toBe(asset.mimeType);
    expect([derived.width, derived.height]).toEqual([asset.width, asset.height]);
    expect(derived.originalFilename).toBe("urun-iyilestirilmis-s1.jpg");
    expect(derived.tags).toEqual(asset.tags);
    expect(derived.size).toBe(enhancement!.outputSize);

    // Her iki dosya da kullanılabilir durumda ve içerikleri farklı.
    const derivedBytes = await storedBytes(derived.storageKey);
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(derivedBytes).not.toBeNull();
    expect(derivedBytes).not.toBe(originalBytes);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);

    // Türevin türevi alınmaz.
    await expect(createSafeEnhancement(owner.id, derived.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await listSafeEnhanceSummaries(owner.id, business.id)).get(derived.id)?.eligible).toBe(false);
  });

  it("discards a result by deleting only the derivative bytes; the original row and file survive", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);
    const enhancement = await createSafeEnhancement(owner.id, asset.id, "CLEAN", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    const outputKey = enhancement!.outputStorageKey!;

    const discarded = await discardSafeEnhancement(owner.id, enhancement!.id);
    expect(discarded.decision).toBe("DISCARDED");
    expect(discarded.decidedById).toBe(owner.id);
    expect(discarded.outputStorageKey).toBeNull();
    expect(discarded.outputAssetId).toBeNull();
    // Sürüm/ön ayar/sağlayıcı izi geçmişte kalır.
    expect([discarded.version, discarded.preset, discarded.provider]).toEqual([1, "CLEAN", "development-sharp-local"]);

    expect(await storage.get(outputKey)).toBeNull();
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(1);
    expect(await readSafeEnhancementOutput(owner.id, enhancement!.id)).toBeNull();
  });

  it("treats a repeated decision as idempotent and refuses to flip a decision that was already made", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const first = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    const kept = await keepSafeEnhancement(owner.id, first!.id);
    const keptAgain = await keepSafeEnhancement(owner.id, first!.id);
    expect(keptAgain.outputAssetId).toBe(kept.outputAssetId);
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id, origin: "SAFE_ENHANCE" } })).toBe(1);
    await expect(discardSafeEnhancement(owner.id, first!.id)).rejects.toMatchObject({ code: "CONFLICT" });

    const second = await createSafeEnhancement(owner.id, asset.id, "WARM", { provider: passthroughProvider, skipRateLimit: true });
    await discardSafeEnhancement(owner.id, second!.id);
    expect((await discardSafeEnhancement(owner.id, second!.id)).decision).toBe("DISCARDED");
    await expect(keepSafeEnhancement(owner.id, second!.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("deduplicates concurrent identical requests into a single active job with no conflicting state", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: fakeProvider((input) => ({ bytes: input.bytes }), { delayMs: 40 }), skipRateLimit: true })),
    );
    for (const result of results) expect(result.status).toBe("fulfilled");

    const rows = await prisma.mediaEnhancement.findMany({ where: { sourceAssetId: asset.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SUCCEEDED");
    expect(rows[0].decision).toBeNull();
    const ids = new Set(results.map((result) => (result as PromiseFulfilledResult<{ id: string } | null>).value?.id));
    expect(ids).toEqual(new Set([rows[0].id]));
    // Karar bekleyen bir sonuç varken aynı ön ayar tekrar istenirse yeni iş açılmaz.
    const repeat = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: passthroughProvider, skipRateLimit: true });
    expect(repeat?.id).toBe(rows[0].id);
    expect(await prisma.mediaEnhancement.count({ where: { sourceAssetId: asset.id } })).toBe(1);

    const review = await getSafeEnhanceReview(owner.id, asset.id);
    expect(review.awaitingReview).toHaveLength(1);
    expect(review.activePresets).toEqual(["NATURAL"]);
  });

  it("keeps history and creates a distinct versioned output when a decided preset is re-run", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const provider = new DevelopmentSharpTransformProvider();
    const first = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider, skipRateLimit: true });
    await keepSafeEnhancement(owner.id, first!.id);
    const second = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider, skipRateLimit: true });
    expect(second?.id).not.toBe(first!.id);
    expect(second?.version).toBe(2);
    const third = await createSafeEnhancement(owner.id, asset.id, "WARM", { provider, skipRateLimit: true });
    expect(third?.version).toBe(3);

    const reloadedFirst = await prisma.mediaEnhancement.findUniqueOrThrow({ where: { id: first!.id } });
    expect(reloadedFirst.decision).toBe("KEPT");
    expect(reloadedFirst.outputStorageKey).not.toBe(second!.outputStorageKey);
    expect(await storage.get(reloadedFirst.outputStorageKey!)).not.toBeNull();

    const review = await getSafeEnhanceReview(owner.id, asset.id);
    expect(review.history.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(review.kept).toHaveLength(1);
    expect(review.awaitingReview.map((entry) => entry.version)).toEqual([3, 2]);
    const summary = (await listSafeEnhanceSummaries(owner.id, business.id)).get(asset.id);
    expect(summary).toMatchObject({ eligible: true, awaitingReview: 2, kept: 1, pending: false, latestFailure: null });

    await keepSafeEnhancement(owner.id, second!.id);
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id, derivedFromId: asset.id } })).toBe(2);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
  });

  it("never mutates Business Brain state or the source analysis while enhancing", async () => {
    const { owner, business } = await businessFixture();
    await prisma.brandProfile.create({ data: { businessId: business.id, description: "Bodrum'da deniz ürünleri" } });
    await prisma.businessGoal.create({ data: { businessId: business.id, type: "RESERVATIONS", priority: "PRIMARY" } });
    await prisma.businessAttribute.create({ data: { businessId: business.id, category: "FACT", key: "fact.terrace", value: "Teras var", source: "USER", verificationStatus: "CONFIRMED", isCanonical: true } });
    const asset = await imageFixture(owner.id, business.id);
    await analyzeMediaAsset(owner.id, asset.id, { provider: analysisProvider("PHOTO"), skipRateLimit: true });

    const snapshot = () => Promise.all([
      prisma.businessAttribute.findMany({ where: { businessId: business.id }, orderBy: { key: "asc" } }),
      prisma.brandProfile.findUnique({ where: { businessId: business.id } }),
      prisma.businessGoal.findMany({ where: { businessId: business.id } }),
      prisma.mediaAnalysis.findMany({ where: { businessId: business.id }, orderBy: { version: "asc" } }),
    ]);
    const before = await snapshot();
    const enhancement = await createSafeEnhancement(owner.id, asset.id, "WARM", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    const kept = await keepSafeEnhancement(owner.id, enhancement!.id);
    expect(await snapshot()).toEqual(before);
    expect(await prisma.businessAnalysisRun.count({ where: { businessId: business.id } })).toBe(0);
    // Türev için otomatik analiz üretilmez; analiz yalnızca kullanıcı isteğiyle çalışır.
    expect(await prisma.mediaAnalysis.count({ where: { mediaAssetId: kept.outputAssetId! } })).toBe(0);
  });

  it("surfaces a user-friendly review state for pending decisions and failed attempts", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const empty = await getSafeEnhanceReview(owner.id, asset.id);
    expect(empty.summary).toMatchObject({ eligible: true, ineligibleReason: null, awaitingReview: 0, kept: 0, pending: false, latestFailure: null });
    expect(empty.presets).toEqual(["NATURAL", "BRIGHT", "CLEAN", "WARM"]);
    expect(empty.activePresets).toEqual([]);

    const ready = await createSafeEnhancement(owner.id, asset.id, "BRIGHT", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    const failed = await createSafeEnhancement(owner.id, asset.id, "CLEAN", { provider: fakeProvider(() => { throw new Error("down"); }), skipRateLimit: true });
    const review = await getSafeEnhanceReview(owner.id, asset.id);
    expect(review.asset.originalFilename).toBe("urun.jpg");
    expect(review.awaitingReview.map((entry) => entry.id)).toEqual([ready!.id]);
    expect(review.awaitingReview[0]).toMatchObject({ preset: "BRIGHT", status: "SUCCEEDED", decision: null, outputAvailable: true, authenticitySensitive: true });
    expect(review.summary.latestFailure).toMatchObject({ version: failed!.version, status: "FAILED", errorCode: "PROVIDER_FAILED" });
    expect(review.activePresets).toEqual(["BRIGHT"]);
  });

  it("cleans up the written derivative and leaves a recoverable failed attempt when the completion write fails", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);

    const writtenKeys: string[] = [];
    const originalPut = storage.put.bind(storage);
    const putSpy = vi.spyOn(storage, "put").mockImplementation(async (input) => {
      writtenKeys.push(input.key);
      return originalPut(input);
    });
    // Tamamlama yazımı düşer; kurtarma yazısı (failAttempt) gerçek istemciye gider.
    const delegate = prisma.mediaEnhancement as unknown as { updateMany: (...args: unknown[]) => Promise<{ count: number }> };
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
      attempt = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    } finally {
      putSpy.mockRestore();
      updateSpy.mockRestore();
    }

    expect(attempt?.status).toBe("FAILED");
    expect(attempt?.errorCode).toBe("COMPLETION_PERSIST_FAILED");
    expect(attempt?.outputStorageKey).toBeNull();
    expect(attempt?.outputAssetId).toBeNull();
    // Yazılan türev baytları öksüz kalmadı.
    expect(writtenKeys).toHaveLength(1);
    expect(writtenKeys[0]).not.toBe(asset.storageKey);
    expect(await storage.get(writtenKeys[0])).toBeNull();
    // Kaynak satır ve dosya el değmeden duruyor; saklanmış bir türev oluşmadı.
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(1);
    await expect(keepSafeEnhancement(owner.id, attempt!.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readSafeEnhancementOutput(owner.id, attempt!.id)).toBeNull();

    // PENDING'de asılı kalmadığı için aynı ön ayar yeniden çalıştırılabilir.
    const retry = await createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    expect(retry?.id).not.toBe(attempt!.id);
    expect([retry?.status, retry?.version]).toEqual(["SUCCEEDED", 2]);
    expect(await storage.get(retry!.outputStorageKey!)).not.toBeNull();
  });

  it("keeps the discarded output key until deletion succeeds and finishes the cleanup on a repeated discard", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const originalBytes = await storedBytes(asset.storageKey);
    const kept = await createSafeEnhancement(owner.id, asset.id, "BRIGHT", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    await keepSafeEnhancement(owner.id, kept!.id);
    const enhancement = await createSafeEnhancement(owner.id, asset.id, "CLEAN", { provider: new DevelopmentSharpTransformProvider(), skipRateLimit: true });
    const outputKey = enhancement!.outputStorageKey!;

    const deleteSpy = vi.spyOn(storage, "delete").mockRejectedValue(new Error("STORAGE_DOWN"));
    try {
      await expect(discardSafeEnhancement(owner.id, enhancement!.id)).rejects.toThrow("STORAGE_DOWN");
    } finally {
      deleteSpy.mockRestore();
    }

    // Karar yazıldı ama baytların tek bulucusu kayıtta duruyor: öksüz dosya oluşmadı.
    const stranded = await prisma.mediaEnhancement.findUniqueOrThrow({ where: { id: enhancement!.id } });
    expect(stranded.decision).toBe("DISCARDED");
    expect(stranded.outputStorageKey).toBe(outputKey);
    expect(await storage.get(outputKey)).not.toBeNull();
    // Atılmış sayıldığı için ne önizlenir ne de saklanabilir.
    expect(await readSafeEnhancementOutput(owner.id, enhancement!.id)).toBeNull();
    const strandedReview = await getSafeEnhanceReview(owner.id, asset.id);
    expect(strandedReview.history.find((entry) => entry.id === enhancement!.id)?.outputAvailable).toBe(false);
    expect(strandedReview.awaitingReview).toHaveLength(0);
    await expect(keepSafeEnhancement(owner.id, enhancement!.id)).rejects.toMatchObject({ code: "CONFLICT" });

    // Aynı "at" çağrısı tekrarlanınca temizlik kaldığı yerden sürer ve anahtar düşer.
    const discarded = await discardSafeEnhancement(owner.id, enhancement!.id);
    expect(discarded.decision).toBe("DISCARDED");
    expect(discarded.outputStorageKey).toBeNull();
    expect(discarded.decidedAt).toEqual(stranded.decidedAt);
    expect(await storage.get(outputKey)).toBeNull();
    // Üçüncü çağrı da güvenli: silecek bir şey kalmadı.
    expect((await discardSafeEnhancement(owner.id, enhancement!.id)).outputStorageKey).toBeNull();

    // Kaynak ve saklanan türev baytları hiçbir adımda silinmedi.
    expect(await storedBytes(asset.storageKey)).toBe(originalBytes);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toEqual(asset);
    const keptRow = await prisma.mediaEnhancement.findUniqueOrThrow({ where: { id: kept!.id } });
    expect(await storage.get(keptRow.outputStorageKey!)).not.toBeNull();
  });

  it("enforces the hourly safe enhance rate limit per user and business", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    await prisma.mediaEnhancement.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        businessId: business.id, sourceAssetId: asset.id, version: index + 1, preset: "NATURAL" as const, status: "FAILED" as const,
        provider: "t", model: "t", provenance: "REAL" as const, parameterVersion: "safe-enhance-v1", triggeredById: owner.id,
      })),
    });
    await expect(createSafeEnhancement(owner.id, asset.id, "NATURAL", { provider: passthroughProvider })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
