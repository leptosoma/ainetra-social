import "server-only";

import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { getActivePlatformRules } from "@/features/platform-intelligence/service";
import { brandPaletteFor } from "@/features/brand-style/palette";
import { deriveBrandVisualStyleProfile } from "@/features/brand-style/profile";
import { maxOutputBytes, supportedSourceFormats, withConflictRetry } from "@/features/safe-enhance/service";
import { getImageReframeProvider, type ImageReframeProvider } from "./providers";
import { findFormatTarget, resolveFormatTargets, type FormatTarget } from "./formats";
import { minSourceShortSide, planReframe } from "./plan";
import { SOCIAL_VARIANT_VERSION, providerOutputSchema, socialVariantFormats, type SocialVariantFormat } from "./schemas";

// P5-04 Sosyal Varyant. Kabul edilmiş özgün bir görselden, mevcut platform oran kuralına göre
// TEKNİK bir format türevi üretir. Özgünlük değişmez: kaynak gerçek bir işletme fotoğrafıysa
// kırpılmış/çerçevelenmiş sürümü de gerçek bir işletme fotoğrafıdır. Bu akış tasarım üretmez.
//
// P5-02/P5-03 altyapısı yeniden kullanılır: aynı sürümleme, aynı eşzamanlılık talebi, aynı çıktı
// doğrulama ve kurtarılabilir depolama yaşam döngüsü, aynı Sakla/At kararı. Yalnızca sağlayıcı
// sınırı farklıdır (piksel ayarı değil, geometri).
//
// Değişmezlik: kaynak satır ve baytları (orijinal, Safe Enhance ya da Brand Style türevi) hiçbir
// yolda güncellenmez veya silinmez. Medya kabulü içerik onayı, planlama ya da yayın DEĞİLDİR.

export type CreateSocialVariantOptions = {
  provider?: ImageReframeProvider;
  skipRateLimit?: boolean;
};

const maxVariantsPerHour = 30;

/** Sosyal varyanta kaynak olabilecek medya kökenleri: yüklenen orijinal ve kabul edilmiş özgün türevler. */
const variantSourceOrigins = new Set(["UPLOAD", "SAFE_ENHANCE", "BRAND_STYLE"]);

type SummarizableAsset = { id: string; type: string; origin: string; mimeType: string; width: number | null; height: number | null };

/** Neden sosyal format türevi üretilemediğini kullanıcıya anlatabilmek için tek yerde tutulan kural. */
export function socialVariantEligibility(asset: SummarizableAsset): { eligible: boolean; reason: string | null } {
  if (asset.type !== "IMAGE" || !asset.width || !asset.height) return { eligible: false, reason: "Sosyal format sürümleri yalnızca fotoğraf ve görseller için hazırlanabilir." };
  if (!supportedSourceFormats.has(asset.mimeType)) return { eligible: false, reason: "Bu dosya biçiminden sosyal format sürümü hazırlanamıyor." };
  if (asset.origin === "SOCIAL_VARIANT") return { eligible: false, reason: "Bir format sürümünden yeni bir format sürümü çıkarılamaz; kaynağından hazırlayın." };
  // Tasarım görselinin teknik türevi bu akışta üretilmez: Kreatif Kampanya hedef formatı zaten kendi seçer.
  if (asset.origin === "CREATIVE_CAMPAIGN") return { eligible: false, reason: "Tasarım kreatifleri hazırlanırken formatı zaten siz seçiyorsunuz; buradan ayrıca sürüm çıkarılmaz." };
  if (!variantSourceOrigins.has(asset.origin)) return { eligible: false, reason: "Bu görselin kaynağı sosyal format sürümüne uygun değil." };
  if (Math.min(asset.width, asset.height) < minSourceShortSide) {
    return { eligible: false, reason: `Bu görselin çözünürlüğü sosyal format sürümü için düşük (kısa kenar en az ${minSourceShortSide} piksel olmalı).` };
  }
  return { eligible: true, reason: null };
}

function parseFormat(value: string): SocialVariantFormat {
  const format = socialVariantFormats.find((entry) => entry === value);
  if (!format) throw new DomainError("Geçersiz sosyal format seçimi.", "VALIDATION_ERROR");
  return format;
}

async function requireSourceAsset(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  return asset;
}

async function requireVariant(userId: string, variantId: string) {
  const variant = await prisma.mediaSocialVariant.findUnique({ where: { id: variantId } });
  if (!variant) throw new DomainError("Format sürümü bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, variant.businessId);
  return variant;
}

async function failAttempt(id: string, status: "FAILED" | "INVALID_OUTPUT", errorCode: string) {
  // updateMany: kaynak medya bu sırada silindiyse (cascade) sessizce geçilir; kaynağa dokunulmaz.
  await prisma.mediaSocialVariant.updateMany({ where: { id, status: "PENDING" }, data: { status, errorCode, completedAt: new Date() } });
  return prisma.mediaSocialVariant.findUnique({ where: { id } });
}

const formatFilenameParts: Record<SocialVariantFormat, string> = {
  FEED: "akis",
  STORY: "hikaye",
  REEL_COVER: "reel-kapak",
  SQUARE: "kare",
};

/** urun.jpg -> urun-hikaye-s2.jpg. Kaynağın adı değişmez; türev ayrı bir ad alır. */
function derivedFilename(sourceFilename: string, format: SocialVariantFormat, version: number, extension: string) {
  const base = sourceFilename.replace(/\.[^.]+$/, "") || "gorsel";
  return `${base}-${formatFilenameParts[format]}-s${version}.${extension}`.slice(0, 255);
}

/**
 * Soy: doğrudan kaynak zaten bilinir; burada zincirin kökü (yüklenen orijinal) ve varsa kaynağı
 * üreten Safe Enhance / Brand Style kaydı çözülür. Bağlanamayan bir zincir belirsiz kalmasın diye
 * istek reddedilir.
 */
async function resolveLineage(asset: { id: string; origin: string; derivedFromId: string | null; currentAnalysisId: string | null }) {
  if (asset.origin === "UPLOAD") return { rootAssetId: asset.id, sourceEnhancementId: null, sourceBrandStyleId: null, inheritedAnalysisId: null };

  const enhancement = asset.origin === "SAFE_ENHANCE"
    ? await prisma.mediaEnhancement.findUnique({ where: { outputAssetId: asset.id }, select: { id: true, decision: true, sourceAnalysisId: true } })
    : null;
  const brandStyle = asset.origin === "BRAND_STYLE"
    ? await prisma.mediaBrandStyle.findUnique({ where: { outputAssetId: asset.id }, select: { id: true, decision: true, sourceAnalysisId: true, sourceEnhancementId: true } })
    : null;
  const producer = enhancement ?? brandStyle;
  if (!producer || producer.decision !== "KEPT") {
    throw new DomainError("Bu görselin kaynak izi bulunamadığı için sosyal format sürümü hazırlanamıyor.", "VALIDATION_ERROR");
  }

  // Kök: türev zincirini yüklenen orijinale kadar izle. Zincir kısa ve tek yönlüdür (en fazla
  // UPLOAD -> SAFE_ENHANCE -> BRAND_STYLE), yine de döngüye karşı adım sayısı sınırlıdır.
  let rootId = asset.derivedFromId;
  for (let step = 0; step < 4 && rootId; step++) {
    const parent = await prisma.mediaAsset.findUnique({ where: { id: rootId }, select: { id: true, origin: true, derivedFromId: true } });
    if (!parent) break;
    if (parent.origin === "UPLOAD" || !parent.derivedFromId) {
      rootId = parent.id;
      break;
    }
    rootId = parent.derivedFromId;
  }
  return {
    rootAssetId: rootId,
    sourceEnhancementId: enhancement?.id ?? brandStyle?.sourceEnhancementId ?? null,
    sourceBrandStyleId: brandStyle?.id ?? null,
    inheritedAnalysisId: producer.sourceAnalysisId,
  };
}

async function readFormatTargets(userId: string, businessId: string): Promise<FormatTarget[]> {
  return resolveFormatTargets(await getActivePlatformRules(userId, businessId));
}

async function readBrandPalette(businessId: string) {
  const profile = await prisma.brandProfile.findUnique({ where: { businessId }, select: { id: true, updatedAt: true, toneDimensions: true } });
  return brandPaletteFor(deriveBrandVisualStyleProfile(profile));
}

export async function createSocialVariant(
  userId: string,
  mediaAssetId: string,
  rawPlatform: string,
  rawFormat: string,
  options: CreateSocialVariantOptions = {},
) {
  const format = parseFormat(rawFormat);
  const asset = await requireSourceAsset(userId, mediaAssetId);
  const eligibility = socialVariantEligibility(asset);
  if (!eligibility.eligible) throw new DomainError(eligibility.reason!, "VALIDATION_ERROR");
  const sourceFormat = supportedSourceFormats.get(asset.mimeType)!;

  // Hedef yalnızca gerçek kural bağlamından gelir; kural yoksa istek reddedilir, oran varsayılmaz.
  const target = findFormatTarget(await readFormatTargets(userId, asset.businessId), rawPlatform, format);
  if (!target) throw new DomainError("Bu platform ve format için tanımlı bir oran kuralı yok; sürüm hazırlanmadı.", "VALIDATION_ERROR");

  if (!options.skipRateLimit) {
    const recent = await prisma.mediaSocialVariant.count({
      where: { businessId: asset.businessId, triggeredById: userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= maxVariantsPerHour) throw new DomainError(`Bir saat içinde en fazla ${maxVariantsPerHour} format sürümü hazırlayabilirsiniz.`, "VALIDATION_ERROR");
  }

  const lineage = await resolveLineage(asset);
  const palette = await readBrandPalette(asset.businessId);
  const plan = planReframe({ width: asset.width!, height: asset.height!, targetRatio: target.targetRatio, padColor: palette.background });
  const provider = options.provider ?? getImageReframeProvider();

  // 1) Aktif işi talep et ya da yeni sürüm aç. Eşzamanlı aynı istek burada mevcut denemeye düşer.
  const claim = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const active = await tx.mediaSocialVariant.findFirst({
      where: { sourceAssetId: asset.id, platform: target.platform, format, OR: [{ status: "PENDING" }, { status: "SUCCEEDED", decision: null }] },
      orderBy: { version: "desc" },
    });
    if (active) return { created: false as const, variant: active };
    const latest = await tx.mediaSocialVariant.findFirst({ where: { sourceAssetId: asset.id }, orderBy: { version: "desc" }, select: { version: true } });
    const variant = await tx.mediaSocialVariant.create({
      data: {
        businessId: asset.businessId,
        sourceAssetId: asset.id,
        rootAssetId: lineage.rootAssetId,
        sourceEnhancementId: lineage.sourceEnhancementId,
        sourceBrandStyleId: lineage.sourceBrandStyleId,
        sourceAnalysisId: asset.currentAnalysisId ?? lineage.inheritedAnalysisId,
        version: (latest?.version ?? 0) + 1,
        platform: target.platform,
        contentType: target.contentType,
        format,
        provider: provider.provider,
        model: provider.model,
        provenance: provider.provenance,
        variantVersion: SOCIAL_VARIANT_VERSION,
        ruleId: target.ruleId,
        ruleKey: target.ruleKey,
        ruleEffectiveFrom: target.ruleEffectiveFrom,
        ruleSnapshot: target.snapshot as unknown as Prisma.InputJsonValue,
        targetAspectRatio: target.targetAspectRatio,
        fit: plan.operations.fit,
        reviewNeeded: plan.reviewNeeded,
        operations: plan.operations as unknown as Prisma.InputJsonValue,
        triggeredById: userId,
      },
    });
    return { created: true as const, variant };
  }, { isolationLevel: "Serializable" }));
  if (!claim.created) return claim.variant;
  const attempt = claim.variant;

  // 2) Sağlayıcı çağrısı işlem dışında; hata yalnızca deneme kaydını işaretler, kaynağa dokunmaz.
  const object = await storage.get(asset.storageKey);
  if (!object) return failAttempt(attempt.id, "FAILED", "MEDIA_BYTES_MISSING");
  let rawOutput: unknown;
  try {
    rawOutput = await provider.reframe({ bytes: object.bytes, mimeType: asset.mimeType, width: asset.width!, height: asset.height!, operations: plan.operations });
  } catch {
    return failAttempt(attempt.id, "FAILED", "PROVIDER_FAILED");
  }
  const parsedOutput = providerOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) return failAttempt(attempt.id, "INVALID_OUTPUT", "SCHEMA_VALIDATION_FAILED");
  const bytes = parsedOutput.data.bytes;
  if (bytes.byteLength > maxOutputBytes()) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_TOO_LARGE");

  // 3) Çıktıyı çöz ve talep edilen geometriyle karşılaştır: aynı biçim, tam olarak istenen boyutlar.
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_NOT_DECODABLE");
  }
  if (metadata.format !== sourceFormat.format) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_FORMAT_MISMATCH");
  if (metadata.width !== plan.operations.output.width || metadata.height !== plan.operations.output.height) {
    return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_DIMENSIONS_UNEXPECTED");
  }

  // 4) Ayrı anahtara yaz, sonra kaydı tamamla. Kaynağın anahtarı asla üzerine yazılmaz.
  const outputStorageKey = `${asset.businessId}/social-variant/${randomUUID()}.${sourceFormat.extension}`;
  try {
    await storage.put({ key: outputStorageKey, bytes, contentType: asset.mimeType });
  } catch {
    await storage.delete(outputStorageKey).catch(() => {});
    return failAttempt(attempt.id, "FAILED", "STORAGE_FAILED");
  }
  let completed: { count: number };
  try {
    completed = await prisma.mediaSocialVariant.updateMany({
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
    // öksüz kalmamalı. Kurtarma yazısı da düşerse hatayı yükseltiriz; kaynağa dokunulmaz.
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
  return prisma.mediaSocialVariant.findUnique({ where: { id: attempt.id } });
}

/**
 * "Sakla": çıktıyı ayrı ve kullanılabilir bir MediaAsset yapar. Kaynak satırı ve baytları değişmez.
 * Etiketler kaynaktan devralınır: teknik bir format türevi kaynağı kadar özgündür. Bu adım içerik
 * onayı, planlama ya da yayın DEĞİLDİR; yalnızca medya kütüphanesine yeni bir dosya ekler.
 */
export async function keepSocialVariant(userId: string, variantId: string) {
  const variant = await requireVariant(userId, variantId);
  if (variant.status === "PENDING") throw new DomainError("Format sürümü hâlâ hazırlanıyor.", "CONFLICT");
  if (variant.status !== "SUCCEEDED" || !variant.outputStorageKey) throw new DomainError("Bu deneme için saklanabilir bir sonuç yok.", "CONFLICT");
  if (variant.decision === "DISCARDED") throw new DomainError("Bu sonuç zaten atıldı.", "CONFLICT");

  return withConflictRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.mediaSocialVariant.findUnique({ where: { id: variant.id }, include: { sourceAsset: true } });
    if (!current) throw new DomainError("Format sürümü bu sırada silindi.", "NOT_FOUND");
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
        origin: "SOCIAL_VARIANT",
        derivedFromId: source.id,
        originalFilename: derivedFilename(source.originalFilename, current.format, current.version, extension),
        mimeType: current.outputMimeType,
        size: current.outputSize,
        width: current.outputWidth,
        height: current.outputHeight,
        storageKey: current.outputStorageKey,
        tags: source.tags,
      },
    });
    return tx.mediaSocialVariant.update({
      where: { id: current.id },
      data: { decision: "KEPT", decidedById: userId, decidedAt: new Date(), outputAssetId: outputAsset.id },
    });
  }, { isolationLevel: "Serializable" }));
}

/** "At": yalnızca bu türevin baytları ve anahtarı düşer. Kaynak ve diğer türevler korunur. */
export async function discardSocialVariant(userId: string, variantId: string) {
  const variant = await requireVariant(userId, variantId);
  if (variant.status === "PENDING") throw new DomainError("Format sürümü hâlâ hazırlanıyor.", "CONFLICT");
  if (variant.decision === "KEPT") throw new DomainError("Saklanan bir sürüm buradan atılamaz; medya kütüphanesinden silebilirsiniz.", "CONFLICT");

  // Kararı yaz ama anahtarı koru: baytları bulmanın tek yolu odur. Silme başarısız olursa anahtar
  // kayıtta kalır; aynı "at" çağrısı tekrarlandığında temizlik kaldığı yerden sürer.
  const outcome = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.mediaSocialVariant.findUnique({ where: { id: variant.id } });
    if (!current) throw new DomainError("Format sürümü bu sırada silindi.", "NOT_FOUND");
    if (current.decision === "DISCARDED") return { variant: current, discardedKey: current.outputStorageKey };
    if (current.decision) throw new DomainError("Saklanan bir sürüm buradan atılamaz; medya kütüphanesinden silebilirsiniz.", "CONFLICT");
    const updated = await tx.mediaSocialVariant.update({
      where: { id: current.id },
      data: { decision: "DISCARDED", decidedById: userId, decidedAt: new Date() },
    });
    return { variant: updated, discardedKey: updated.outputStorageKey };
  }, { isolationLevel: "Serializable" }));
  if (!outcome.discardedKey) return outcome.variant;

  // Anahtar yalnızca DISCARDED kaydın üzerindedir (outputStorageKey tekil) ve saklanan bir çıktı
  // KEPT olurdu; dolayısıyla burada silinen baytlar ne kaynağa ne de saklanan bir türeve aittir.
  await storage.delete(outcome.discardedKey);
  await prisma.mediaSocialVariant.updateMany({
    where: { id: variant.id, decision: "DISCARDED", outputStorageKey: outcome.discardedKey },
    data: { outputStorageKey: null },
  });
  return (await prisma.mediaSocialVariant.findUnique({ where: { id: variant.id } })) ?? { ...outcome.variant, outputStorageKey: null };
}

const reviewSelect = {
  id: true, version: true, platform: true, contentType: true, format: true, status: true, decision: true, provider: true, provenance: true,
  variantVersion: true, ruleKey: true, targetAspectRatio: true, fit: true, reviewNeeded: true, outputStorageKey: true, outputWidth: true,
  outputHeight: true, outputSize: true, outputAssetId: true, rootAssetId: true, sourceEnhancementId: true, sourceBrandStyleId: true,
  errorCode: true, createdAt: true, completedAt: true, decidedAt: true,
} satisfies Prisma.MediaSocialVariantSelect;

type ReviewRow = Prisma.MediaSocialVariantGetPayload<{ select: typeof reviewSelect }>;

export type SocialVariantReviewItem = Omit<ReviewRow, "outputStorageKey"> & {
  /** Önizlenebilir bir çıktı dosyası hâlâ duruyor mu (atılanlarda hayır). Depolama anahtarı arayüze taşınmaz. */
  outputAvailable: boolean;
};

function toReviewItem(row: ReviewRow): SocialVariantReviewItem {
  const { outputStorageKey, ...rest } = row;
  return { ...rest, outputAvailable: Boolean(outputStorageKey) && rest.decision !== "DISCARDED" };
}

export type SocialVariantSummary = {
  mediaAssetId: string;
  eligible: boolean;
  ineligibleReason: string | null;
  awaitingReview: number;
  kept: number;
  pending: boolean;
  latestFailure: { version: number; status: "FAILED" | "INVALID_OUTPUT"; errorCode: string | null } | null;
};

function summarize(asset: SummarizableAsset, rows: ReviewRow[]): SocialVariantSummary {
  const eligibility = socialVariantEligibility(asset);
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

/** Arayüze taşınan tek bir seçenek: nerede kullanılacağı, hedef oran ve kırpmanın ne yapacağı. */
export type SocialVariantChoice = {
  platform: FormatTarget["platform"];
  contentType: FormatTarget["contentType"];
  format: SocialVariantFormat;
  targetAspectRatio: string;
  ruleKey: string;
  recommendationType: FormatTarget["snapshot"]["recommendationType"];
  ruleSource: FormatTarget["snapshot"]["source"];
  fit: "COVER" | "CONTAIN";
  reviewNeeded: boolean;
  outputWidth: number;
  outputHeight: number;
  /** Bu seçim için zaten aktif bir deneme var: tekrar istemek yeni iş açmaz. */
  active: boolean;
};

function toChoices(asset: SummarizableAsset, targets: FormatTarget[], palette: ReturnType<typeof brandPaletteFor>, rows: ReviewRow[]): SocialVariantChoice[] {
  if (!socialVariantEligibility(asset).eligible) return [];
  const active = new Set(
    rows.filter((row) => row.status === "PENDING" || (row.status === "SUCCEEDED" && row.decision === null)).map((row) => `${row.platform}:${row.format}`),
  );
  return targets.map((target) => {
    const plan = planReframe({ width: asset.width!, height: asset.height!, targetRatio: target.targetRatio, padColor: palette.background });
    return {
      platform: target.platform,
      contentType: target.contentType,
      format: target.format,
      targetAspectRatio: target.targetAspectRatio,
      ruleKey: target.ruleKey,
      recommendationType: target.snapshot.recommendationType,
      ruleSource: target.snapshot.source,
      fit: plan.operations.fit,
      reviewNeeded: plan.reviewNeeded,
      outputWidth: plan.operations.output.width,
      outputHeight: plan.operations.output.height,
      active: active.has(`${target.platform}:${target.format}`),
    };
  });
}

/** Medya kütüphanesi için kısa özet; yalnızca üyesi olunan işletmenin medyaları döner. */
export async function listSocialVariantSummaries(userId: string, businessId: string): Promise<Map<string, SocialVariantSummary>> {
  await requireMembership(userId, businessId);
  const assets = await prisma.mediaAsset.findMany({
    where: { businessId },
    select: { id: true, type: true, origin: true, mimeType: true, width: true, height: true, socialVariants: { select: reviewSelect, orderBy: { version: "desc" } } },
  });
  return new Map(assets.map((asset) => [asset.id, summarize(asset, asset.socialVariants)]));
}

/** Görsel analizi detayındaki "Bunu nerede kullanacaksınız?" deneyimi. */
export async function getSocialVariantReview(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    select: {
      id: true, businessId: true, type: true, origin: true, mimeType: true, width: true, height: true, originalFilename: true, createdAt: true,
      socialVariants: { select: reviewSelect, orderBy: { version: "desc" } },
    },
  });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  const rows = asset.socialVariants;
  const [targets, palette] = await Promise.all([readFormatTargets(userId, asset.businessId), readBrandPalette(asset.businessId)]);
  return {
    asset: {
      id: asset.id, businessId: asset.businessId, origin: asset.origin, originalFilename: asset.originalFilename,
      width: asset.width, height: asset.height, createdAt: asset.createdAt,
    },
    summary: summarize(asset, rows),
    choices: toChoices(asset, targets, palette, rows),
    awaitingReview: rows.filter((row) => row.status === "SUCCEEDED" && row.decision === null).map(toReviewItem),
    kept: rows.filter((row) => row.decision === "KEPT").map(toReviewItem),
    history: rows.map(toReviewItem),
  };
}

/** Karar öncesi önizleme için çıktı baytları. Üyelik sorgunun içinde denetlenir. */
export async function readSocialVariantOutput(userId: string, variantId: string) {
  const variant = await prisma.mediaSocialVariant.findFirst({
    where: { id: variantId, business: { memberships: { some: { userId } } } },
    select: { outputStorageKey: true, outputMimeType: true, outputSize: true, decision: true },
  });
  // Atılan bir çıktı, baytları henüz silinememiş olsa bile önizlenmez.
  if (!variant?.outputStorageKey || !variant.outputMimeType || variant.decision === "DISCARDED") return null;
  const object = await storage.get(variant.outputStorageKey);
  if (!object) return null;
  return { bytes: object.bytes, mimeType: variant.outputMimeType, size: variant.outputSize ?? object.bytes.byteLength };
}
