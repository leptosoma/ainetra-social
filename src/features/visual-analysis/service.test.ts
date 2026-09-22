import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { deleteMedia, uploadMedia } from "@/features/media/service";
import { analyzeMediaAsset, getMediaAnalysisDetail, listMediaAnalysisSummaries } from "@/features/visual-analysis/service";
import { DevelopmentImageAnalysisProvider } from "@/features/visual-analysis/providers/development";
import type { ImageAnalysisProvider } from "@/features/visual-analysis/providers/types";
import { buildVisualAnalysisResult } from "@/features/visual-analysis/normalize";
import { visualAnalysisResultSchema, type ProviderOutput } from "@/features/visual-analysis/schemas";

async function businessFixture(suffix = "") {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `va-owner-${suffix}${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: { name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul", memberships: { create: { userId: owner.id, role: "OWNER" } } },
  });
  return { owner, business };
}

async function jpegBytes(width: number, height: number, background = { r: 200, g: 30, b: 30 }) {
  const buffer = await sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

async function imageFixture(userId: string, businessId: string, width = 1200, height = 1500, tags: string[] = ["PHOTO_PRODUCT"], background?: { r: number; g: number; b: number }) {
  const file = new File([await jpegBytes(width, height, background)], "urun.jpg", { type: "image/jpeg" });
  return uploadMedia(userId, businessId, file, tags);
}

const validOutput: ProviderOutput = {
  imageKind: "PHOTO",
  dominantSubject: "Izgara steak tabağı",
  category: "FOOD",
  confidence: 0.91,
  lighting: "BALANCED",
  framing: "BALANCED",
  background: "CLEAN",
  sharpness: "SHARP",
  peopleVisible: false,
  notes: [],
};

function fakeProvider(output: unknown, options: { provenance?: "REAL" | "DEVELOPMENT"; fail?: boolean; delayMs?: number } = {}): ImageAnalysisProvider {
  return {
    provider: "test-vision",
    model: "test-model",
    provenance: options.provenance ?? "REAL",
    async analyze() {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.fail) throw new Error("PROVIDER_DOWN");
      return output;
    },
  };
}

async function aspectRule(businessId: string | null, platform: "INSTAGRAM" | "FACEBOOK" | "TIKTOK", contentType: "POST" | "REEL" | "STORY" | "CAROUSEL" | null, recommended: string, supported: string[] = []) {
  return prisma.platformRule.create({
    data: {
      businessId, platform, contentType, category: "ASPECT_RATIO", ruleKey: `test.aspect.${platform.toLowerCase()}.${(contentType ?? "all").toLowerCase()}`,
      value: { recommended, ...(supported.length ? { supported } : {}) }, recommendationType: "BEST_PRACTICE", source: "MANUAL_ADMIN_RULE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), reviewedAt: new Date("2026-01-01T00:00:00.000Z"), confidence: 0.9, sectorScope: [], active: true,
    },
  });
}

describe("Ainetra P5-01 — visual analysis foundation", () => {
  it("analyzes an owned image, persists a validated normalized result, and makes it current", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const analysis = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(validOutput), skipRateLimit: true });
    expect(analysis?.status).toBe("SUCCEEDED");
    expect(analysis?.version).toBe(1);
    expect(analysis?.category).toBe("FOOD");
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.currentAnalysisId).toBe(analysis?.id);
    const detail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(detail.current?.result.category).toBe("FOOD");
    expect(detail.current?.result.dominantSubject).toBe("Izgara steak tabağı");
    expect(detail.current?.result.schemaVersion).toBe("visual-analysis-v1");
    expect(detail.current?.result.recommendedAction).toBe("USE_AS_IS");
  });

  it("rejects analyze and read for a user from another tenant", async () => {
    const { owner, business } = await businessFixture("a");
    const other = await businessFixture("b");
    const asset = await imageFixture(owner.id, business.id);
    await expect(analyzeMediaAsset(other.owner.id, asset.id, { provider: fakeProvider(validOutput), skipRateLimit: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getMediaAnalysisDetail(other.owner.id, asset.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listMediaAnalysisSummaries(other.owner.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.mediaAnalysis.count({ where: { mediaAssetId: asset.id } })).toBe(0);
    // Kendi işletmesinin özetinde başka kiracının medyası yer almaz.
    const summaries = await listMediaAnalysisSummaries(other.owner.id, other.business.id);
    expect(summaries.has(asset.id)).toBe(false);
  });

  it("rejects unsupported media (video) without creating any analysis row", async () => {
    const { owner, business } = await businessFixture();
    const video = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "VIDEO", originalFilename: "teras.mp4", mimeType: "video/mp4", size: 100, storageKey: `${business.id}/${crypto.randomUUID()}.mp4`, tags: [] },
    });
    await expect(analyzeMediaAsset(owner.id, video.id, { provider: fakeProvider(validOutput), skipRateLimit: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.mediaAnalysis.count({ where: { mediaAssetId: video.id } })).toBe(0);
    const summaries = await listMediaAnalysisSummaries(owner.id, business.id);
    expect(summaries.get(video.id)?.supported).toBe(false);
  });

  it("records provider failure as FAILED and never touches the MediaAsset or an existing current analysis", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const failedFirst = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(null, { fail: true }), skipRateLimit: true });
    expect(failedFirst?.status).toBe("FAILED");
    expect(failedFirst?.errorCode).toBe("PROVIDER_FAILED");
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).currentAnalysisId).toBeNull();

    const good = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(validOutput), skipRateLimit: true });
    const failedAgain = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(null, { fail: true }), skipRateLimit: true });
    expect(failedAgain?.version).toBe(3);
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.currentAnalysisId).toBe(good?.id);
    expect(stored.tags).toEqual(["PHOTO_PRODUCT"]);
    const summary = (await listMediaAnalysisSummaries(owner.id, business.id)).get(asset.id);
    expect(summary?.current?.version).toBe(2);
    expect(summary?.latestFailure).toMatchObject({ version: 3, status: "FAILED", errorCode: "PROVIDER_FAILED" });
  });

  it("marks schema-invalid provider output as INVALID_OUTPUT without a current analysis", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const invalid = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ category: "STEAK", confidence: 5 }), skipRateLimit: true });
    expect(invalid?.status).toBe("INVALID_OUTPUT");
    expect(invalid?.errorCode).toBe("SCHEMA_VALIDATION_FAILED");
    expect(invalid?.result).toBeNull();
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).currentAnalysisId).toBeNull();
    const detail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(detail.current).toBeNull();
    expect(detail.summary.latestFailure?.status).toBe("INVALID_OUTPUT");
  });

  it("accepts UNKNOWN category as a valid but low-value result that asks for manual review", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const analysis = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ ...validOutput, imageKind: "UNKNOWN", category: "UNKNOWN", dominantSubject: "Belirlenemedi", confidence: 0 }), skipRateLimit: true });
    expect(analysis?.status).toBe("SUCCEEDED");
    const detail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(detail.current?.result.category).toBe("UNKNOWN");
    expect(detail.current?.result.recommendedAction).toBe("REVIEW_MANUALLY");
    expect(detail.current?.result.authenticity.sensitive).toBe(true);
  });

  it("derives orientation, aspect label, dimensions and resolution from the real image, not the provider", async () => {
    const { owner, business } = await businessFixture();
    const portrait = await imageFixture(owner.id, business.id, 1200, 1500);
    const landscape = await imageFixture(owner.id, business.id, 1600, 900);
    const square = await imageFixture(owner.id, business.id, 800, 800);
    const provider = fakeProvider(validOutput);
    await Promise.all([portrait, landscape, square].map((asset) => analyzeMediaAsset(owner.id, asset.id, { provider, skipRateLimit: true })));
    const [p, l, s] = await Promise.all([portrait, landscape, square].map((asset) => getMediaAnalysisDetail(owner.id, asset.id)));
    expect(p.current?.result).toMatchObject({ orientation: "PORTRAIT", aspectRatio: { label: "4:5" }, dimensions: { width: 1200, height: 1500 }, quality: { resolution: "HIGH" } });
    expect(l.current?.result).toMatchObject({ orientation: "LANDSCAPE", aspectRatio: { label: "16:9" }, dimensions: { width: 1600, height: 900 }, quality: { resolution: "MEDIUM" } });
    expect(s.current?.result).toMatchObject({ orientation: "SQUARE", aspectRatio: { label: "1:1" }, dimensions: { width: 800, height: 800 }, quality: { resolution: "MEDIUM" } });
  });

  it("evaluates platform fit from existing platform rules only (no duplicated rules, no crop)", async () => {
    const { owner, business } = await businessFixture();
    await aspectRule(business.id, "INSTAGRAM", "POST", "4:5", ["1:1"]);
    await aspectRule(business.id, "INSTAGRAM", "STORY", "9:16");
    const asset = await imageFixture(owner.id, business.id, 1200, 1500);
    await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(validOutput), skipRateLimit: true });
    const detail = await getMediaAnalysisDetail(owner.id, asset.id);
    const fit = detail.current!.result.platformFit;
    expect(fit).toHaveLength(2);
    expect(fit.find((entry) => entry.contentType === "POST")).toMatchObject({ platform: "INSTAGRAM", fit: "FIT", recommendedAspectRatio: "4:5" });
    expect(fit.find((entry) => entry.contentType === "STORY")).toMatchObject({ platform: "INSTAGRAM", fit: "CROP_NEEDED", recommendedAspectRatio: "9:16" });
    // Görsel dönüştürülmez: boyutlar ve dosya aynı kalır.
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect([stored.width, stored.height, stored.size]).toEqual([asset.width, asset.height, asset.size]);
  });

  it("does not evaluate platform fit for another tenant's business-scoped rule", async () => {
    const { owner, business } = await businessFixture("x");
    const other = await businessFixture("y");
    await aspectRule(other.business.id, "FACEBOOK", "POST", "1:1");
    const asset = await imageFixture(owner.id, business.id, 1200, 1500);
    await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(validOutput), skipRateLimit: true });
    const detail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(detail.current?.result.platformFit.some((entry) => entry.platform === "FACEBOOK")).toBe(false);
  });

  it("applies authenticity policy by domain rule: real photos are sensitive, visually verified pure graphics are not", async () => {
    const rules: never[] = [];
    const food = buildVisualAnalysisResult({ output: validOutput, width: 1200, height: 1500, rules, provenance: "REAL" });
    expect(food.authenticity.sensitive).toBe(true);
    expect(food.authenticity.reason).toContain("porsiyon");
    const graphic = buildVisualAnalysisResult({ output: { ...validOutput, imageKind: "GRAPHIC", category: "GRAPHIC" }, width: 1200, height: 1500, rules, provenance: "REAL" });
    expect(graphic.authenticity.sensitive).toBe(false);
    const graphicWithPeople = buildVisualAnalysisResult({ output: { ...validOutput, imageKind: "GRAPHIC", category: "GRAPHIC", peopleVisible: true }, width: 1200, height: 1500, rules, provenance: "REAL" });
    expect(graphicWithPeople.authenticity.sensitive).toBe(true);
    const interiorWithPeople = buildVisualAnalysisResult({ output: { ...validOutput, category: "INTERIOR", peopleVisible: true }, width: 1200, height: 1500, rules, provenance: "REAL" });
    expect(interiorWithPeople.authenticity.reason).toContain("kişiler");
  });

  it("recommends the next action deterministically from quality, lighting and platform fit", async () => {
    const rules: never[] = [];
    expect(buildVisualAnalysisResult({ output: validOutput, width: 600, height: 750, rules, provenance: "REAL" }).recommendedAction).toBe("RECAPTURE");
    expect(buildVisualAnalysisResult({ output: { ...validOutput, lighting: "DARK" }, width: 1200, height: 1500, rules, provenance: "REAL" }).recommendedAction).toBe("SAFE_ENHANCE_CANDIDATE");
    expect(buildVisualAnalysisResult({ output: { ...validOutput, sharpness: "SOFT" }, width: 1200, height: 1500, rules, provenance: "REAL" }).quality.overall).toBe("LOW");
    const rule = { category: "ASPECT_RATIO", platform: "INSTAGRAM", contentType: "STORY", ruleKey: "r", recommendationType: "BEST_PRACTICE", value: { recommended: "9:16" } } as never;
    expect(buildVisualAnalysisResult({ output: validOutput, width: 1600, height: 900, rules: [rule], provenance: "REAL" }).recommendedAction).toBe("CROP_FOR_PLATFORM");
    expect(buildVisualAnalysisResult({ output: validOutput, width: 1200, height: 1500, rules, provenance: "REAL" }).recommendedAction).toBe("USE_AS_IS");
  });

  it("keeps provenance honest: development provider is DEVELOPMENT, injected real provider is REAL, and the output cannot override it", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id, 1200, 1500, ["PHOTO_PRODUCT"]);
    const dev = await analyzeMediaAsset(owner.id, asset.id, { provider: new DevelopmentImageAnalysisProvider(), skipRateLimit: true });
    expect(dev?.status).toBe("SUCCEEDED");
    expect(dev?.provenance).toBe("DEVELOPMENT");
    expect(dev?.provider).toBe("development-pixel-stats");
    const devDetail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(devDetail.current?.provenance).toBe("DEVELOPMENT");
    expect(devDetail.current?.result.category).toBe("PRODUCT");
    expect(devDetail.current?.result.categoryConfidence).toBeLessThan(0.5);
    expect(devDetail.current?.result.observations.notes.join(" ")).toContain("planlama etiketinden");

    const real = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ ...validOutput, provenance: "DEVELOPMENT", provider: "spoof" }), skipRateLimit: true });
    expect(real?.provenance).toBe("REAL");
    const realDetail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(realDetail.current?.provenance).toBe("REAL");
    expect(realDetail.summary.current?.provenance).toBe("REAL");
  });

  it("development provider yields UNKNOWN and stays authenticity-sensitive when planning tags give no context, even for low-entropy images", async () => {
    const { owner, business } = await businessFixture();
    // Düz, tek tonlu karanlık görsel: düşük ton çeşitliliği bir "tasarım görseli" kanıtı DEĞİLDİR
    // (düz arka planlı gerçek bir ürün fotoğrafı da böyle görünür). İçerik tanınmadığı için UNKNOWN
    // kalmalı, otantiklik korunmalı ve manuel inceleme istenmeli; ölçülebilir ışık gözlemi yine verilir.
    const asset = await imageFixture(owner.id, business.id, 1200, 1500, [], { r: 20, g: 20, b: 25 });
    const analysis = await analyzeMediaAsset(owner.id, asset.id, { skipRateLimit: true });
    expect(analysis?.status).toBe("SUCCEEDED");
    expect(analysis?.provenance).toBe("DEVELOPMENT");
    const detail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(detail.current?.result.imageKind).toBe("UNKNOWN");
    expect(detail.current?.result.category).toBe("UNKNOWN");
    expect(detail.current?.result.categoryConfidence).toBe(0);
    expect(detail.current?.result.authenticity.sensitive).toBe(true);
    expect(detail.current?.result.recommendedAction).toBe("REVIEW_MANUALLY");
    expect(detail.current?.result.observations.lighting).toBe("DARK");
    expect(detail.current?.result.observations.notes.join(" ")).toContain("Planlama etiketi yok");
  });

  it("development provider infers GRAPHIC only from an explicit CUSTOM_GRAPHIC planning tag but never relaxes authenticity", async () => {
    const { owner, business } = await businessFixture();
    // CUSTOM_GRAPHIC bir planlama/kullanım etiketidir; piksellerde gerçek ürün, mekân veya kişi
    // olmadığının kanıtı değildir. Geliştirme sağlayıcısı görsel doğrulama yapamadığı için sınıf
    // GRAPHIC olabilir ama otantiklik hassas kalmalı ve manuel inceleme istenmelidir.
    const asset = await imageFixture(owner.id, business.id, 1200, 1500, ["CUSTOM_GRAPHIC"], { r: 20, g: 20, b: 25 });
    await analyzeMediaAsset(owner.id, asset.id, { provider: new DevelopmentImageAnalysisProvider(), skipRateLimit: true });
    const detail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(detail.current?.provenance).toBe("DEVELOPMENT");
    expect(detail.current?.result.imageKind).toBe("GRAPHIC");
    expect(detail.current?.result.category).toBe("GRAPHIC");
    expect(detail.current?.result.observations.notes.join(" ")).toContain("planlama etiketinden");
    expect(detail.current?.result.authenticity.sensitive).toBe(true);
    expect(detail.current?.result.authenticity.reason).toContain("doğrulanmadı");
    expect(detail.current?.result.recommendedAction).toBe("REVIEW_MANUALLY");
    expect(detail.summary.current?.recommendedAction).toBe("REVIEW_MANUALLY");
  });

  it("every development-provenance result stays authenticity-sensitive regardless of planning tag", async () => {
    const { owner, business } = await businessFixture();
    for (const tags of [["PHOTO_PRODUCT"], ["PHOTO_ATMOSPHERE"], ["PHOTO_PEOPLE"], ["CUSTOM_GRAPHIC"], ["CUSTOM_GRAPHIC", "PHOTO_PRODUCT"], []]) {
      const asset = await imageFixture(owner.id, business.id, 1200, 1500, tags, { r: 120, g: 120, b: 120 });
      const analysis = await analyzeMediaAsset(owner.id, asset.id, { provider: new DevelopmentImageAnalysisProvider(), skipRateLimit: true });
      expect(analysis?.status).toBe("SUCCEEDED");
      const detail = await getMediaAnalysisDetail(owner.id, asset.id);
      expect(detail.current?.provenance).toBe("DEVELOPMENT");
      expect(detail.current?.result.authenticity.sensitive).toBe(true);
    }
  });

  it("normalization refuses to relax authenticity for a pure-graphic claim unless provenance is REAL", async () => {
    const rules: never[] = [];
    const pureGraphic: ProviderOutput = { ...validOutput, imageKind: "GRAPHIC", category: "GRAPHIC", peopleVisible: false };
    const real = buildVisualAnalysisResult({ output: pureGraphic, width: 1200, height: 1500, rules, provenance: "REAL" });
    expect(real.authenticity.sensitive).toBe(false);
    expect(real.recommendedAction).toBe("USE_AS_IS");
    const development = buildVisualAnalysisResult({ output: pureGraphic, width: 1200, height: 1500, rules, provenance: "DEVELOPMENT" });
    expect(development.category).toBe("GRAPHIC");
    expect(development.authenticity.sensitive).toBe(true);
    expect(development.recommendedAction).toBe("REVIEW_MANUALLY");
    // Fotoğraf sınıfı için geliştirme provenance'ı var olan hassas politikayı değiştirmez.
    const developmentPhoto = buildVisualAnalysisResult({ output: validOutput, width: 1200, height: 1500, rules, provenance: "DEVELOPMENT" });
    expect(developmentPhoto.authenticity.sensitive).toBe(true);
    expect(developmentPhoto.authenticity.reason).toContain("porsiyon");
  });

  it("never mutates Business Brain state (attributes, brand profile, goals) even when the provider output carries business-like claims", async () => {
    const { owner, business } = await businessFixture();
    await prisma.brandProfile.create({ data: { businessId: business.id, description: "Bodrum'da deniz ürünleri" } });
    await prisma.businessGoal.create({ data: { businessId: business.id, type: "RESERVATIONS", priority: "PRIMARY" } });
    await prisma.businessAttribute.create({ data: { businessId: business.id, category: "FACT", key: "fact.terrace", value: "Teras var", source: "USER", verificationStatus: "CONFIRMED", isCanonical: true } });
    const before = await Promise.all([prisma.businessAttribute.findMany({ where: { businessId: business.id } }), prisma.brandProfile.findUnique({ where: { businessId: business.id } }), prisma.businessGoal.findMany({ where: { businessId: business.id } })]);
    const asset = await imageFixture(owner.id, business.id);
    await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ ...validOutput, productsServices: ["Steak 950 TL"], facts: ["Deniz manzarası"], brandTone: "lüks" }), skipRateLimit: true });
    const after = await Promise.all([prisma.businessAttribute.findMany({ where: { businessId: business.id } }), prisma.brandProfile.findUnique({ where: { businessId: business.id } }), prisma.businessGoal.findMany({ where: { businessId: business.id } })]);
    expect(after).toEqual(before);
    expect(await prisma.businessAnalysisRun.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("stores only the normalized contract: unknown provider fields are stripped and the result re-validates", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const analysis = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ ...validOutput, rawVendorBlob: { tokens: 1234 }, embedding: [0.1, 0.2] }), skipRateLimit: true });
    const stored = await prisma.mediaAnalysis.findUniqueOrThrow({ where: { id: analysis!.id } });
    const json = JSON.stringify(stored.result);
    expect(json).not.toContain("rawVendorBlob");
    expect(json).not.toContain("embedding");
    expect(visualAnalysisResultSchema.safeParse(stored.result).success).toBe(true);
    expect(Object.keys(stored.result as object).sort()).toEqual(["aspectRatio", "authenticity", "categoryConfidence", "category", "dimensions", "dominantSubject", "imageKind", "observations", "orientation", "platformFit", "quality", "recommendedAction", "recommendedActionReason", "schemaVersion"].sort());
  });

  it("re-analysis creates a higher version, supersedes the previous current, and keeps history", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const first = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(validOutput), skipRateLimit: true });
    const second = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ ...validOutput, category: "DRINK", dominantSubject: "Kokteyl" }), skipRateLimit: true });
    expect(second?.version).toBe(2);
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.currentAnalysisId).toBe(second?.id);
    const previous = await prisma.mediaAnalysis.findUniqueOrThrow({ where: { id: first!.id } });
    expect(previous.supersededAt).not.toBeNull();
    expect(previous.status).toBe("SUCCEEDED");
    const detail = await getMediaAnalysisDetail(owner.id, asset.id);
    expect(detail.current?.result.category).toBe("DRINK");
    expect(detail.history.map((entry) => entry.version)).toEqual([2, 1]);
    expect(await prisma.mediaAnalysis.count({ where: { mediaAssetId: asset.id, status: "SUCCEEDED", supersededAt: null } })).toBe(1);
  });

  it("concurrent re-analysis never leaves two current analyses; the highest version wins", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const results = await Promise.allSettled([
      analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ ...validOutput, category: "FOOD" }, { delayMs: 120 }), skipRateLimit: true }),
      analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ ...validOutput, category: "DRINK" }, { delayMs: 10 }), skipRateLimit: true }),
      analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider({ ...validOutput, category: "INTERIOR" }, { delayMs: 60 }), skipRateLimit: true }),
    ]);
    const succeeded = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof analyzeMediaAsset>>> => result.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThan(0);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "CONFLICT" });
    const rows = await prisma.mediaAnalysis.findMany({ where: { mediaAssetId: asset.id }, orderBy: { version: "asc" } });
    expect(new Set(rows.map((row) => row.version)).size).toBe(rows.length);
    expect(rows.every((row) => row.status === "SUCCEEDED")).toBe(true);
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, include: { currentAnalysis: true } });
    const highest = Math.max(...rows.map((row) => row.version));
    expect(stored.currentAnalysis?.version).toBe(highest);
    expect(rows.filter((row) => row.supersededAt === null)).toHaveLength(1);
    expect(rows.find((row) => row.supersededAt === null)?.id).toBe(stored.currentAnalysisId);
  });

  it("enforces the hourly analysis rate limit per user and business", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    await prisma.mediaAnalysis.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({ businessId: business.id, mediaAssetId: asset.id, version: index + 1, status: "FAILED" as const, provider: "t", model: "t", provenance: "REAL" as const, analysisVersion: "visual-analysis-v1", triggeredById: owner.id })),
    });
    await expect(analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(validOutput) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("deleting an analyzed media asset removes its analyses without breaking the current pointer", async () => {
    const { owner, business } = await businessFixture();
    const asset = await imageFixture(owner.id, business.id);
    const analysis = await analyzeMediaAsset(owner.id, asset.id, { provider: fakeProvider(validOutput), skipRateLimit: true });
    await deleteMedia(owner.id, asset.id);
    expect(await prisma.mediaAnalysis.findUnique({ where: { id: analysis!.id } })).toBeNull();
    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).toBeNull();
  });
});
