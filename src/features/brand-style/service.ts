import "server-only";

import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import type { Prisma } from "../../../generated/prisma/client";
import type { MediaAnalysisProvenance } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { readVisualAnalysisResult } from "@/features/visual-analysis/service";
import type { VisualAnalysisResult } from "@/features/visual-analysis/schemas";
import { getImageTransformProvider, type ImageTransformProvider } from "@/features/safe-enhance/providers";
import { providerOutputSchema } from "@/features/safe-enhance/schemas";
import { maxOutputBytes, supportedSourceFormats, withConflictRetry } from "@/features/safe-enhance/service";
import { BRAND_STYLE_PROFILE_VERSION, brandStyleProfileSnapshot, deriveBrandVisualStyleProfile, type BrandVisualStyleProfile } from "./profile";
import { buildBrandStyleOperations } from "./styles";
import { BRAND_STYLE_VERSION, brandStyleChoices, type BrandStyleAuthenticityTier, type BrandStyleChoice } from "./schemas";

// P5-03 Marka Stili. Kaynağı (yüklenen orijinal ya da saklanmış bir Safe Enhance türevi) markanın
// karakterine göre ölçülü biçimde düzenleyip ayrı, izlenebilir bir türev üretir.
//
// P5-02 altyapısı yeniden kullanılır: aynı sağlayıcı sınırı (ImageTransformProvider), aynı kapalı
// piksel sözleşmesi, aynı çıktı doğrulaması ve aynı kurtarılabilir depolama yaşam döngüsü. Marka Stili
// bunların üzerine yalnızca marka önerisini ve daha dar özgünlük sınırlarını ekler.
//
// Değişmezlik: kaynak satır ve baytları (orijinal ya da saklanan iyileştirme çıktısı) hiçbir yolda
// güncellenmez veya silinmez. Bir marka stili çıktısı yeniden stillendirilemez; zincir tek yönlüdür.
//
// Aktif iş kuralı: aynı (kaynak, seçim) için aynı anda tek aktif deneme olabilir. Karar verilmiş bir
// seçim yeniden çalıştırıldığında yeni bir sürüm açılır, geçmiş olduğu gibi kalır.

export type CreateBrandStyleOptions = {
  provider?: ImageTransformProvider;
  skipRateLimit?: boolean;
};

const maxBrandStylesPerHour = 20;

/**
 * Bir adım gevşemeye yalnızca bu kategoriler açıktır: gerçek sahne görsel olarak tanınmıştır ve
 * rengi kendi başına olgusal bir iddia taşımaz. Liste kapalıdır ve varsayılan en dar katmandır:
 * tanınamamış (UNKNOWN/OTHER), yalnızca planlama etiketine dayandığı için görsel olarak
 * doğrulanmamış ya da ileride eklenecek bir kategori, gerçek ürün/mekân/kişi içerebileceği için
 * STANDARD'a düşmez. Ürün/kişi rengi olgusal olan kategoriler (FOOD, DRINK, PRODUCT, PEOPLE, TEAM)
 * da bu listede değildir; onlar zaten en dar katmanda kalır.
 */
const standardCategories = new Set<VisualAnalysisResult["category"]>(["INTERIOR", "EXTERIOR", "SERVICE", "EVENT"]);

type SummarizableAsset = { id: string; type: string; origin: string; mimeType: string; width: number | null; height: number | null };

/** Neden markaya göre düzenlenemediğini kullanıcıya anlatabilmek için tek yerde tutulan uygunluk kuralı. */
export function brandStyleEligibility(asset: SummarizableAsset): { eligible: boolean; reason: string | null } {
  if (asset.type !== "IMAGE" || !asset.width || !asset.height) return { eligible: false, reason: "Markaya göre düzenleme yalnızca fotoğraf ve görseller için kullanılabilir." };
  if (!supportedSourceFormats.has(asset.mimeType)) return { eligible: false, reason: "Bu dosya biçimi markaya göre düzenleme için desteklenmiyor." };
  // Belirsiz zincir oluşmasın: stil üstüne stil, ayarları biriktirerek gerçek görünümü kaydırabilir.
  if (asset.origin === "BRAND_STYLE") return { eligible: false, reason: "Markaya göre düzenlenmiş bir görsel yeniden düzenlenemez; kaynağından yeni bir sürüm oluşturun." };
  if (asset.origin !== "UPLOAD" && asset.origin !== "SAFE_ENHANCE") return { eligible: false, reason: "Bu görselin kaynağı markaya göre düzenlemeye uygun değil." };
  return { eligible: true, reason: null };
}

function parseChoice(value: string): BrandStyleChoice {
  const choice = brandStyleChoices.find((entry) => entry === value);
  if (!choice) throw new DomainError("Geçersiz marka stili seçimi.", "VALIDATION_ERROR");
  return choice;
}

/**
 * Analiz bağlamı → özgünlük katmanı. Analiz yoksa ihtiyatla en dar katman uygulanır.
 *
 * Gevşeme (RELAXED) saklanmış `sensitive` bayrağına teslim edilmez; katman burada bağlamdan yeniden
 * kurulur. Bayrak tek başına yeterli olsaydı, P5-01'in özgünlük düzeltmesinden önce yazılmış ve geri
 * doldurulmamış DEVELOPMENT sonuçları (sınıfı yalnızca CUSTOM_GRAPHIC planlama etiketinden türeyen,
 * `sensitive: false` saklanmış satırlar) bugün hâlâ gevşemeyi açardı. Bu yüzden gevşeme iki koşulu
 * birlikte ister: REAL provenance ve sonucun kendisinde duran saf tasarım görseli iddiası
 * (imageKind ve category GRAPHIC). DEVELOPMENT bir sonuç, saklanmış bayrağı ne olursa olsun en dar
 * katmanda ve hassas kalır: geliştirme sağlayıcısı pikselleri tanımaz, etiket ise görselde gerçek
 * ürün/mekân/kişi olmadığının kanıtı değildir.
 *
 * REAL bir sonuçta `sensitive: false` ile tutarsız (saf tasarım olmayan) bir sınıf birlikte geliyorsa
 * sonuç kendi içinde çelişiktir; ihtiyatla en dar katman uygulanır ve hassas sayılır.
 *
 * Hassas kalmış bir sonuçta bir adım gevşeme (STANDARD) ise sınıfın kendisine güvenmeyi gerektirir:
 * sınıf görsel olarak doğrulanmamışsa (türü çözülememiş görsel ya da kategorisi planlama etiketinden
 * türeyen DEVELOPMENT sonucu) görselde tanınmamış gerçek bir ürün, mekân veya kişi olabilir. Böyle
 * bir bağlamda renk ve sıcaklık kaydırması tanınmış bir sahneden daha serbest olamaz.
 */
export function authenticityTierFor(
  result: VisualAnalysisResult | null,
  provenance: MediaAnalysisProvenance | null = null,
): { tier: BrandStyleAuthenticityTier; sensitive: boolean } {
  if (!result) return { tier: "STRICT", sensitive: true };
  const verifiedClass = provenance === "REAL" && result.imageKind !== "UNKNOWN";
  const verifiedPureGraphic = verifiedClass && result.imageKind === "GRAPHIC" && result.category === "GRAPHIC";
  if (!result.authenticity.sensitive) {
    return verifiedPureGraphic ? { tier: "RELAXED", sensitive: false } : { tier: "STRICT", sensitive: true };
  }
  return { tier: verifiedClass && standardCategories.has(result.category) ? "STANDARD" : "STRICT", sensitive: true };
}

async function requireSourceAsset(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  return asset;
}

async function requireBrandStyle(userId: string, brandStyleId: string) {
  const brandStyle = await prisma.mediaBrandStyle.findUnique({ where: { id: brandStyleId } });
  if (!brandStyle) throw new DomainError("Marka stili sonucu bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, brandStyle.businessId);
  return brandStyle;
}

async function failAttempt(id: string, status: "FAILED" | "INVALID_OUTPUT", errorCode: string) {
  // updateMany: kaynak medya bu sırada silindiyse (cascade) sessizce geçilir; kaynağa dokunulmaz.
  await prisma.mediaBrandStyle.updateMany({ where: { id, status: "PENDING" }, data: { status, errorCode, completedAt: new Date() } });
  return prisma.mediaBrandStyle.findUnique({ where: { id } });
}

/** urun.jpg -> urun-marka-stili-s3.jpg. Kaynağın adı değişmez; türev ayrı bir ad alır. */
function derivedFilename(sourceFilename: string, version: number, extension: string) {
  const base = sourceFilename.replace(/\.[^.]+$/, "") || "gorsel";
  return `${base}-marka-stili-s${version}.${extension}`.slice(0, 255);
}

async function readBrandVisualStyleProfile(businessId: string): Promise<BrandVisualStyleProfile> {
  // Yalnızca kullanıcının kendi doldurduğu BrandProfile yetkilidir; burada okuma dışında işlem yapılmaz.
  const profile = await prisma.brandProfile.findUnique({ where: { businessId }, select: { id: true, updatedAt: true, toneDimensions: true } });
  return deriveBrandVisualStyleProfile(profile);
}

/**
 * Kaynağın soyu. Saklanmış bir Safe Enhance çıktısından gelindiğinde o kayıt açıkça bağlanır;
 * bağlanamıyorsa zincir belirsiz kalmasın diye istek reddedilir.
 */
async function resolveLineage(asset: { id: string; origin: string }) {
  if (asset.origin !== "SAFE_ENHANCE") return { sourceEnhancementId: null, inheritedAnalysisId: null };
  const enhancement = await prisma.mediaEnhancement.findUnique({
    where: { outputAssetId: asset.id },
    select: { id: true, decision: true, sourceAnalysisId: true },
  });
  if (!enhancement || enhancement.decision !== "KEPT") throw new DomainError("Bu görselin kaynak izi bulunamadığı için markaya göre düzenlenemez.", "VALIDATION_ERROR");
  return { sourceEnhancementId: enhancement.id, inheritedAnalysisId: enhancement.sourceAnalysisId };
}

export async function createBrandStyle(userId: string, mediaAssetId: string, rawChoice: string, options: CreateBrandStyleOptions = {}) {
  const choice = parseChoice(rawChoice);
  const asset = await requireSourceAsset(userId, mediaAssetId);
  const eligibility = brandStyleEligibility(asset);
  if (!eligibility.eligible) throw new DomainError(eligibility.reason!, "VALIDATION_ERROR");
  const sourceFormat = supportedSourceFormats.get(asset.mimeType)!;

  if (!options.skipRateLimit) {
    const recent = await prisma.mediaBrandStyle.count({
      where: { businessId: asset.businessId, triggeredById: userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= maxBrandStylesPerHour) throw new DomainError(`Bir saat içinde en fazla ${maxBrandStylesPerHour} marka stili çalıştırabilirsiniz.`, "VALIDATION_ERROR");
  }

  const lineage = await resolveLineage(asset);
  // Analiz bağlamı: önce kaynağın kendi güncel analizi, yoksa kaynak iyileştirmenin analiz bağlamı.
  const analysisId = asset.currentAnalysisId ?? lineage.inheritedAnalysisId;
  const analysis = analysisId ? await prisma.mediaAnalysis.findUnique({ where: { id: analysisId }, select: { id: true, result: true, provenance: true } }) : null;
  const analysisResult = analysis ? readVisualAnalysisResult(analysis.result) : null;
  const { tier, sensitive } = authenticityTierFor(analysisResult, analysis?.provenance ?? null);

  const profile = await readBrandVisualStyleProfile(asset.businessId);
  // Özgünlük stilin üstündedir: türetilen ayarlar katman sınırına kısılır ve sözleşmeye göre doğrulanır.
  const operations = buildBrandStyleOperations(choice, profile, tier);
  const provider = options.provider ?? getImageTransformProvider();

  // 1) Aktif işi talep et ya da yeni sürüm aç. Eşzamanlı aynı istek burada mevcut denemeye düşer.
  const claim = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const active = await tx.mediaBrandStyle.findFirst({
      where: { sourceAssetId: asset.id, choice, OR: [{ status: "PENDING" }, { status: "SUCCEEDED", decision: null }] },
      orderBy: { version: "desc" },
    });
    if (active) return { created: false as const, brandStyle: active };
    const latest = await tx.mediaBrandStyle.findFirst({ where: { sourceAssetId: asset.id }, orderBy: { version: "desc" }, select: { version: true } });
    const brandStyle = await tx.mediaBrandStyle.create({
      data: {
        businessId: asset.businessId,
        sourceAssetId: asset.id,
        sourceEnhancementId: lineage.sourceEnhancementId,
        version: (latest?.version ?? 0) + 1,
        choice,
        provider: provider.provider,
        model: provider.model,
        provenance: provider.provenance,
        styleVersion: BRAND_STYLE_VERSION,
        profileVersion: BRAND_STYLE_PROFILE_VERSION,
        brandProfileId: profile.profileId,
        brandProfileUpdatedAt: profile.profileUpdatedAt,
        styleProfile: brandStyleProfileSnapshot(profile) as unknown as Prisma.InputJsonValue,
        operations: operations as Prisma.InputJsonValue,
        authenticityTier: tier,
        authenticitySensitive: sensitive,
        sourceAnalysisId: analysis?.id ?? null,
        triggeredById: userId,
      },
    });
    return { created: true as const, brandStyle };
  }, { isolationLevel: "Serializable" }));
  if (!claim.created) return claim.brandStyle;
  const attempt = claim.brandStyle;

  // 2) Sağlayıcı çağrısı işlem dışında; hata yalnızca deneme kaydını işaretler, kaynağa dokunmaz.
  const object = await storage.get(asset.storageKey);
  if (!object) return failAttempt(attempt.id, "FAILED", "MEDIA_BYTES_MISSING");
  let rawOutput: unknown;
  try {
    rawOutput = await provider.transform({ bytes: object.bytes, mimeType: asset.mimeType, width: asset.width!, height: asset.height!, operations });
  } catch {
    return failAttempt(attempt.id, "FAILED", "PROVIDER_FAILED");
  }
  const parsedOutput = providerOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) return failAttempt(attempt.id, "INVALID_OUTPUT", "SCHEMA_VALIDATION_FAILED");
  const bytes = parsedOutput.data.bytes;
  if (bytes.byteLength > maxOutputBytes()) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_TOO_LARGE");

  // 3) Çıktıyı çöz ve kaynakla karşılaştır: aynı biçim, aynı boyut. Kırpma/yeniden çerçeveleme reddedilir.
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_NOT_DECODABLE");
  }
  if (metadata.format !== sourceFormat.format) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_FORMAT_MISMATCH");
  if (metadata.width !== asset.width || metadata.height !== asset.height) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_DIMENSIONS_CHANGED");

  // 4) Ayrı anahtara yaz, sonra kaydı tamamla. Kaynağın anahtarı asla üzerine yazılmaz.
  const outputStorageKey = `${asset.businessId}/brand-style/${randomUUID()}.${sourceFormat.extension}`;
  try {
    await storage.put({ key: outputStorageKey, bytes, contentType: asset.mimeType });
  } catch {
    await storage.delete(outputStorageKey).catch(() => {});
    return failAttempt(attempt.id, "FAILED", "STORAGE_FAILED");
  }
  let completed: { count: number };
  try {
    completed = await prisma.mediaBrandStyle.updateMany({
      where: { id: attempt.id, status: "PENDING" },
      data: {
        status: "SUCCEEDED",
        outputStorageKey,
        outputMimeType: asset.mimeType,
        outputSize: bytes.byteLength,
        outputWidth: metadata.width,
        outputHeight: metadata.height,
        completedAt: new Date(),
      },
    });
  } catch (persistError) {
    // P5-02'deki kurtarılabilir yaşam döngüsü: kayıt PENDING'de asılı kalmamalı, yazılan baytlar da
    // öksüz kalmamalı. Kurtarma yazısı da düşerse baytların kayıtta görünüp görünmediğini bilemeyiz;
    // silmek yerine hatayı yükseltiriz. Kaynağa hiçbir yolda dokunulmaz.
    let recovered: Awaited<ReturnType<typeof failAttempt>>;
    try {
      recovered = await failAttempt(attempt.id, "FAILED", "COMPLETION_PERSIST_FAILED");
    } catch {
      throw persistError;
    }
    if (recovered?.outputStorageKey !== outputStorageKey) await storage.delete(outputStorageKey).catch(() => {});
    return recovered;
  }
  // Kayıt bu sırada kaybolduysa (kaynak silindi) yazılan baytlar öksüz kalmasın.
  if (!completed.count) await storage.delete(outputStorageKey).catch(() => {});
  return prisma.mediaBrandStyle.findUnique({ where: { id: attempt.id } });
}

/** "Sakla": çıktıyı ayrı ve kullanılabilir bir MediaAsset yapar. Kaynak satırı ve baytları değişmez. */
export async function keepBrandStyle(userId: string, brandStyleId: string) {
  const brandStyle = await requireBrandStyle(userId, brandStyleId);
  if (brandStyle.status === "PENDING") throw new DomainError("Marka stili hâlâ sürüyor.", "CONFLICT");
  if (brandStyle.status !== "SUCCEEDED" || !brandStyle.outputStorageKey) throw new DomainError("Bu deneme için saklanabilir bir sonuç yok.", "CONFLICT");
  if (brandStyle.decision === "DISCARDED") throw new DomainError("Bu sonuç zaten atıldı.", "CONFLICT");

  return withConflictRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.mediaBrandStyle.findUnique({ where: { id: brandStyle.id }, include: { sourceAsset: true } });
    if (!current) throw new DomainError("Marka stili bu sırada silindi.", "NOT_FOUND");
    if (current.decision === "KEPT") return current;
    if (current.decision) throw new DomainError("Bu sonuç zaten atıldı.", "CONFLICT");
    if (current.status !== "SUCCEEDED" || !current.outputStorageKey || !current.outputMimeType || current.outputSize === null) {
      throw new DomainError("Bu deneme için saklanabilir bir sonuç yok.", "CONFLICT");
    }
    const source = current.sourceAsset;
    const extension = supportedSourceFormats.get(current.outputMimeType)?.extension ?? "jpg";
    const outputAsset = await tx.mediaAsset.create({
      data: {
        businessId: current.businessId,
        type: "IMAGE",
        origin: "BRAND_STYLE",
        // Zincir tek yönlü ve açık: türev doğrudan kendi kaynağını gösterir.
        derivedFromId: source.id,
        originalFilename: derivedFilename(source.originalFilename, current.version, extension),
        mimeType: current.outputMimeType,
        size: current.outputSize,
        width: current.outputWidth,
        height: current.outputHeight,
        storageKey: current.outputStorageKey,
        tags: source.tags,
      },
    });
    return tx.mediaBrandStyle.update({
      where: { id: current.id },
      data: { decision: "KEPT", decidedById: userId, decidedAt: new Date(), outputAssetId: outputAsset.id },
    });
  }, { isolationLevel: "Serializable" }));
}

/** "At": yalnızca türev baytlar ve anahtar düşer. Kaynak MediaAsset satırı ve dosyası korunur. */
export async function discardBrandStyle(userId: string, brandStyleId: string) {
  const brandStyle = await requireBrandStyle(userId, brandStyleId);
  if (brandStyle.status === "PENDING") throw new DomainError("Marka stili hâlâ sürüyor.", "CONFLICT");
  if (brandStyle.decision === "KEPT") throw new DomainError("Saklanan bir sonuç buradan atılamaz; medya kütüphanesinden silebilirsiniz.", "CONFLICT");

  // Kararı yaz ama anahtarı koru: baytları bulmanın tek yolu odur. Silme başarısız olursa anahtar
  // kayıtta kalır; aynı "at" çağrısı tekrarlandığında temizlik kaldığı yerden sürer.
  const outcome = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.mediaBrandStyle.findUnique({ where: { id: brandStyle.id } });
    if (!current) throw new DomainError("Marka stili bu sırada silindi.", "NOT_FOUND");
    if (current.decision === "DISCARDED") return { brandStyle: current, discardedKey: current.outputStorageKey };
    if (current.decision) throw new DomainError("Saklanan bir sonuç buradan atılamaz; medya kütüphanesinden silebilirsiniz.", "CONFLICT");
    const updated = await tx.mediaBrandStyle.update({
      where: { id: current.id },
      data: { decision: "DISCARDED", decidedById: userId, decidedAt: new Date() },
    });
    return { brandStyle: updated, discardedKey: updated.outputStorageKey };
  }, { isolationLevel: "Serializable" }));
  if (!outcome.discardedKey) return outcome.brandStyle;

  // Anahtar yalnızca DISCARDED kaydın üzerindedir (outputStorageKey tekil) ve saklanan bir çıktı
  // KEPT olurdu; dolayısıyla burada silinen baytlar ne kaynağa ne de saklanan bir türeve aittir.
  await storage.delete(outcome.discardedKey);
  await prisma.mediaBrandStyle.updateMany({
    where: { id: brandStyle.id, decision: "DISCARDED", outputStorageKey: outcome.discardedKey },
    data: { outputStorageKey: null },
  });
  return (await prisma.mediaBrandStyle.findUnique({ where: { id: brandStyle.id } })) ?? { ...outcome.brandStyle, outputStorageKey: null };
}

const reviewSelect = {
  id: true, version: true, choice: true, status: true, decision: true, provider: true, provenance: true, styleVersion: true, profileVersion: true,
  authenticityTier: true, authenticitySensitive: true, outputStorageKey: true, outputWidth: true, outputHeight: true, outputSize: true,
  outputAssetId: true, sourceEnhancementId: true, errorCode: true, createdAt: true, completedAt: true, decidedAt: true,
} satisfies Prisma.MediaBrandStyleSelect;

type ReviewRow = Prisma.MediaBrandStyleGetPayload<{ select: typeof reviewSelect }>;

export type BrandStyleReviewItem = Omit<ReviewRow, "outputStorageKey"> & {
  /** Önizlenebilir bir çıktı dosyası hâlâ duruyor mu (atılanlarda hayır). Depolama anahtarı arayüze taşınmaz. */
  outputAvailable: boolean;
};

function toReviewItem(row: ReviewRow): BrandStyleReviewItem {
  const { outputStorageKey, ...rest } = row;
  // Atılan bir kayıtta anahtar, silme kesinleşene kadar duruyor olabilir; çıktı yine de yok sayılır.
  return { ...rest, outputAvailable: Boolean(outputStorageKey) && rest.decision !== "DISCARDED" };
}

export type BrandStyleSummary = {
  mediaAssetId: string;
  eligible: boolean;
  ineligibleReason: string | null;
  awaitingReview: number;
  kept: number;
  pending: boolean;
  latestFailure: { version: number; status: "FAILED" | "INVALID_OUTPUT"; errorCode: string | null } | null;
};

function summarize(asset: SummarizableAsset, rows: ReviewRow[]): BrandStyleSummary {
  const eligibility = brandStyleEligibility(asset);
  const latest = rows[0] ?? null;
  return {
    mediaAssetId: asset.id,
    eligible: eligibility.eligible,
    ineligibleReason: eligibility.reason,
    awaitingReview: rows.filter((row) => row.status === "SUCCEEDED" && row.decision === null).length,
    kept: rows.filter((row) => row.decision === "KEPT").length,
    pending: rows.some((row) => row.status === "PENDING"),
    latestFailure: latest && (latest.status === "FAILED" || latest.status === "INVALID_OUTPUT") && latest.decision === null
      ? { version: latest.version, status: latest.status, errorCode: latest.errorCode }
      : null,
  };
}

/** Arayüze taşınan öneri: yalnızca anlaşılır başlık, gerekçe ve seçenekler; ham tercih değeri yok. */
export type BrandStyleRecommendation = {
  recommended: BrandStyleChoice;
  choices: BrandStyleChoice[];
  headline: string;
  rationale: string;
  profileState: BrandVisualStyleProfile["state"];
};

function toRecommendation(profile: BrandVisualStyleProfile): BrandStyleRecommendation {
  return {
    recommended: "BRAND_RECOMMENDED",
    choices: ["BRAND_RECOMMENDED", ...profile.alternatives],
    headline: profile.headline,
    rationale: profile.rationale,
    profileState: profile.state,
  };
}

/** Öneri tek başına da okunabilir; üyelik burada da denetlenir. */
export async function getBrandStyleRecommendation(userId: string, mediaAssetId: string): Promise<BrandStyleRecommendation> {
  const asset = await requireSourceAsset(userId, mediaAssetId);
  return toRecommendation(await readBrandVisualStyleProfile(asset.businessId));
}

/** Medya kütüphanesi için kısa özet; yalnızca üyesi olunan işletmenin medyaları döner. */
export async function listBrandStyleSummaries(userId: string, businessId: string): Promise<Map<string, BrandStyleSummary>> {
  await requireMembership(userId, businessId);
  const assets = await prisma.mediaAsset.findMany({
    where: { businessId },
    select: { id: true, type: true, origin: true, mimeType: true, width: true, height: true, brandStyles: { select: reviewSelect, orderBy: { version: "desc" } } },
  });
  return new Map(assets.map((asset) => [asset.id, summarize(asset, asset.brandStyles)]));
}

/** Görsel analizi detayındaki "Markama göre düzenle" deneyimi. */
export async function getBrandStyleReview(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    select: {
      id: true, businessId: true, type: true, origin: true, mimeType: true, width: true, height: true, originalFilename: true, createdAt: true,
      brandStyles: { select: reviewSelect, orderBy: { version: "desc" } },
    },
  });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  const rows = asset.brandStyles;
  const active = rows.filter((row) => row.status === "PENDING" || (row.status === "SUCCEEDED" && row.decision === null));
  const profile = await readBrandVisualStyleProfile(asset.businessId);
  return {
    asset: { id: asset.id, businessId: asset.businessId, origin: asset.origin, originalFilename: asset.originalFilename, width: asset.width, height: asset.height, createdAt: asset.createdAt },
    summary: summarize(asset, rows),
    recommendation: toRecommendation(profile),
    /** Bu seçim için zaten aktif bir deneme var: tekrar istemek yeni iş açmaz, aynı denemeye düşer. */
    activeChoices: [...new Set(active.map((row) => row.choice))],
    awaitingReview: rows.filter((row) => row.status === "SUCCEEDED" && row.decision === null).map(toReviewItem),
    kept: rows.filter((row) => row.decision === "KEPT").map(toReviewItem),
    history: rows.map(toReviewItem),
  };
}

/** Karar öncesi önizleme için çıktı baytları. Üyelik sorgunun içinde denetlenir. */
export async function readBrandStyleOutput(userId: string, brandStyleId: string) {
  const brandStyle = await prisma.mediaBrandStyle.findFirst({
    where: { id: brandStyleId, business: { memberships: { some: { userId } } } },
    select: { outputStorageKey: true, outputMimeType: true, outputSize: true, decision: true },
  });
  // Atılan bir çıktı, baytları henüz silinememiş olsa bile önizlenmez.
  if (!brandStyle?.outputStorageKey || !brandStyle.outputMimeType || brandStyle.decision === "DISCARDED") return null;
  const object = await storage.get(brandStyle.outputStorageKey);
  if (!object) return null;
  return { bytes: object.bytes, mimeType: brandStyle.outputMimeType, size: brandStyle.outputSize ?? object.bytes.byteLength };
}
