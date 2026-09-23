import "server-only";

import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { readVisualAnalysisResult } from "@/features/visual-analysis/service";
import { operationsForPreset } from "./presets";
import { getImageTransformProvider, type ImageTransformProvider } from "./providers";
import { SAFE_ENHANCE_PARAMETER_VERSION, enhancementPresets, providerOutputSchema, type EnhancementPreset } from "./schemas";

// P5-02 Safe Enhance. Yüklenen bir görselden, özgünlüğü koruyan bir türev üretir.
//
// Değişmezlik kuralı: kaynak MediaAsset satırı ve baytları hiçbir yolda güncellenmez veya silinmez.
// Çıktı ayrı bir depolama anahtarına yazılır; yalnızca kullanıcı "Sakla" dediğinde ayrı bir
// MediaAsset (origin SAFE_ENHANCE, derivedFromId = kaynak) olur. "At" yalnızca türev baytları siler.
//
// Aktif iş kuralı: aynı (kaynak, ön ayar) için aynı anda tek bir aktif deneme olabilir — süren
// (PENDING) ya da karar bekleyen (SUCCEEDED, decision null). Eşzamanlı aynı istek yeni iş açmaz,
// mevcut denemeyi döndürür. Karar verilmiş bir ön ayar yeniden çalıştırıldığında yeni bir sürüm açılır.

export type CreateSafeEnhancementOptions = {
  provider?: ImageTransformProvider;
  skipRateLimit?: boolean;
};

/** Türev üretiminin desteklediği kaynak biçimleri. P5-03 Marka Stili aynı listeyi kullanır. */
export const supportedSourceFormats = new Map([
  ["image/jpeg", { extension: "jpg", format: "jpeg" }],
  ["image/png", { extension: "png", format: "png" }],
  ["image/webp", { extension: "webp", format: "webp" }],
]);

const maxEnhancementsPerHour = 20;
const maxConflictRetries = 3;

export function maxOutputBytes() {
  return Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024);
}

/** Serializable çakışması (P2034 / 40001) ya da sürüm yarışında unique ihlali (P2002). */
function isRetryableConflict(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 2) return false;
  const candidate = error as { code?: unknown; kind?: unknown; originalCode?: unknown; cause?: unknown };
  if (["P2034", "P2002"].includes(String(candidate.code)) || candidate.kind === "TransactionWriteConflict" || String(candidate.originalCode) === "40001") return true;
  return isRetryableConflict(candidate.cause, depth + 1);
}

/** Aynı eşzamanlılık semantiğini paylaşan türev akışları (P5-03 dahil) bu yeniden deneme sarmalını kullanır. */
export async function withConflictRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableConflict(error) || attempt >= maxConflictRetries) throw error;
    }
  }
}

/** Neden iyileştirilemediğini kullanıcıya anlatabilmek için tek yerde tutulan uygunluk kuralı. */
export function safeEnhanceEligibility(asset: { type: string; origin: string; mimeType: string; width: number | null; height: number | null }): { eligible: boolean; reason: string | null } {
  if (asset.type !== "IMAGE" || !asset.width || !asset.height) return { eligible: false, reason: "Güvenli iyileştirme yalnızca fotoğraf ve görseller için kullanılabilir." };
  if (!supportedSourceFormats.has(asset.mimeType)) return { eligible: false, reason: "Bu dosya biçimi güvenli iyileştirme için desteklenmiyor." };
  // Türevin türevi alınmaz: ard arda uygulanan ayarlar birikerek gerçek görünümü kaydırabilir.
  if (asset.origin !== "UPLOAD") return { eligible: false, reason: "İyileştirilmiş bir görsel yeniden iyileştirilemez; orijinalden yeni bir sürüm oluşturun." };
  return { eligible: true, reason: null };
}

function parsePreset(value: string): EnhancementPreset {
  const preset = enhancementPresets.find((entry) => entry === value);
  if (!preset) throw new DomainError("Geçersiz iyileştirme ön ayarı.", "VALIDATION_ERROR");
  return preset;
}

async function requireSourceAsset(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  return asset;
}

async function requireEnhancement(userId: string, enhancementId: string) {
  const enhancement = await prisma.mediaEnhancement.findUnique({ where: { id: enhancementId } });
  if (!enhancement) throw new DomainError("İyileştirme bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, enhancement.businessId);
  return enhancement;
}

async function failAttempt(id: string, status: "FAILED" | "INVALID_OUTPUT", errorCode: string) {
  // updateMany: kaynak medya bu sırada silindiyse (cascade) sessizce geçilir; MediaAsset'e dokunulmaz.
  await prisma.mediaEnhancement.updateMany({ where: { id, status: "PENDING" }, data: { status, errorCode, completedAt: new Date() } });
  return prisma.mediaEnhancement.findUnique({ where: { id } });
}

/** `urun.jpg` → `urun-iyilestirilmis-s3.jpg`. Kaynağın adı değişmez; türev ayrı bir ad alır. */
function derivedFilename(sourceFilename: string, version: number, extension: string) {
  const base = sourceFilename.replace(/\.[^.]+$/, "") || "gorsel";
  return `${base}-iyilestirilmis-s${version}.${extension}`.slice(0, 255);
}

export async function createSafeEnhancement(userId: string, mediaAssetId: string, rawPreset: string, options: CreateSafeEnhancementOptions = {}) {
  const preset = parsePreset(rawPreset);
  const asset = await requireSourceAsset(userId, mediaAssetId);
  const eligibility = safeEnhanceEligibility(asset);
  if (!eligibility.eligible) throw new DomainError(eligibility.reason!, "VALIDATION_ERROR");
  const sourceFormat = supportedSourceFormats.get(asset.mimeType)!;

  if (!options.skipRateLimit) {
    const recent = await prisma.mediaEnhancement.count({
      where: { businessId: asset.businessId, triggeredById: userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= maxEnhancementsPerHour) throw new DomainError(`Bir saat içinde en fazla ${maxEnhancementsPerHour} güvenli iyileştirme çalıştırabilirsiniz.`, "VALIDATION_ERROR");
  }

  const provider = options.provider ?? getImageTransformProvider();
  const operations = operationsForPreset(preset);
  // P5-01 özgünlük meta verisi: güncel analiz hassas diyorsa hassas kalır; analiz yoksa ihtiyatla hassas kabul edilir.
  const analysis = asset.currentAnalysisId
    ? await prisma.mediaAnalysis.findUnique({ where: { id: asset.currentAnalysisId }, select: { id: true, result: true } })
    : null;
  const analysisResult = analysis ? readVisualAnalysisResult(analysis.result) : null;
  const authenticitySensitive = analysisResult ? analysisResult.authenticity.sensitive : true;

  // 1) Aktif işi talep et ya da yeni sürüm aç. Eşzamanlı aynı istek burada mevcut denemeye düşer.
  const claim = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const active = await tx.mediaEnhancement.findFirst({
      where: { sourceAssetId: asset.id, preset, OR: [{ status: "PENDING" }, { status: "SUCCEEDED", decision: null }] },
      orderBy: { version: "desc" },
    });
    if (active) return { created: false as const, enhancement: active };
    const latest = await tx.mediaEnhancement.findFirst({ where: { sourceAssetId: asset.id }, orderBy: { version: "desc" }, select: { version: true } });
    const enhancement = await tx.mediaEnhancement.create({
      data: {
        businessId: asset.businessId,
        sourceAssetId: asset.id,
        version: (latest?.version ?? 0) + 1,
        preset,
        provider: provider.provider,
        model: provider.model,
        provenance: provider.provenance,
        parameterVersion: SAFE_ENHANCE_PARAMETER_VERSION,
        operations: operations as Prisma.InputJsonValue,
        authenticitySensitive,
        sourceAnalysisId: analysis?.id ?? null,
        triggeredById: userId,
      },
    });
    return { created: true as const, enhancement };
  }, { isolationLevel: "Serializable" }));
  if (!claim.created) return claim.enhancement;
  const attempt = claim.enhancement;

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

  // 3) Çıktıyı çöz ve kaynakla karşılaştır: aynı biçim, aynı boyut. Kırpma/yeniden boyutlandırma reddedilir.
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_NOT_DECODABLE");
  }
  if (metadata.format !== sourceFormat.format) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_FORMAT_MISMATCH");
  if (metadata.width !== asset.width || metadata.height !== asset.height) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_DIMENSIONS_CHANGED");

  // 4) Ayrı anahtara yaz, sonra kaydı tamamla. Kaynağın anahtarı asla üzerine yazılmaz.
  const outputStorageKey = `${asset.businessId}/enhanced/${randomUUID()}.${sourceFormat.extension}`;
  try {
    await storage.put({ key: outputStorageKey, bytes, contentType: asset.mimeType });
  } catch {
    await storage.delete(outputStorageKey).catch(() => {});
    return failAttempt(attempt.id, "FAILED", "STORAGE_FAILED");
  }
  let completed: { count: number };
  try {
    completed = await prisma.mediaEnhancement.updateMany({
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
    // Tamamlama yazımı düştü. Deneme PENDING kalmamalı, yazılan türev baytları da öksüz kalmamalı.
    // Önce kaydı kurtarılabilir bir hata durumuna alırız; bu yazı da düşerse baytların kayıtta
    // görünüp görünmediğini bilemeyiz, silmek yerine hatayı yükseltiriz. Kaynağa hiçbir yolda dokunulmaz.
    let recovered: Awaited<ReturnType<typeof failAttempt>>;
    try {
      recovered = await failAttempt(attempt.id, "FAILED", "COMPLETION_PERSIST_FAILED");
    } catch {
      throw persistError;
    }
    // Tamamlama aslında işlenmişse (yanıt dönerken kopan bağlantı) baytlar o kaydındır; dokunulmaz.
    if (recovered?.outputStorageKey !== outputStorageKey) await storage.delete(outputStorageKey).catch(() => {});
    return recovered;
  }
  // Kayıt bu sırada kaybolduysa (kaynak silindi) yazılan baytlar öksüz kalmasın.
  if (!completed.count) await storage.delete(outputStorageKey).catch(() => {});
  return prisma.mediaEnhancement.findUnique({ where: { id: attempt.id } });
}

/** "Sakla": çıktıyı ayrı ve kullanılabilir bir MediaAsset yapar. Kaynak satırı ve baytları değişmez. */
export async function keepSafeEnhancement(userId: string, enhancementId: string) {
  const enhancement = await requireEnhancement(userId, enhancementId);
  if (enhancement.status === "PENDING") throw new DomainError("İyileştirme hâlâ sürüyor.", "CONFLICT");
  if (enhancement.status !== "SUCCEEDED" || !enhancement.outputStorageKey) throw new DomainError("Bu deneme için saklanabilir bir sonuç yok.", "CONFLICT");
  if (enhancement.decision === "DISCARDED") throw new DomainError("Bu sonuç zaten atıldı.", "CONFLICT");

  return withConflictRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.mediaEnhancement.findUnique({ where: { id: enhancement.id }, include: { sourceAsset: true } });
    if (!current) throw new DomainError("İyileştirme bu sırada silindi.", "NOT_FOUND");
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
        origin: "SAFE_ENHANCE",
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
    return tx.mediaEnhancement.update({
      where: { id: current.id },
      data: { decision: "KEPT", decidedById: userId, decidedAt: new Date(), outputAssetId: outputAsset.id },
    });
  }, { isolationLevel: "Serializable" }));
}

/** "At": yalnızca türev baytlar ve anahtar düşer. Kaynak MediaAsset satırı ve dosyası korunur. */
export async function discardSafeEnhancement(userId: string, enhancementId: string) {
  const enhancement = await requireEnhancement(userId, enhancementId);
  if (enhancement.status === "PENDING") throw new DomainError("İyileştirme hâlâ sürüyor.", "CONFLICT");
  if (enhancement.decision === "KEPT") throw new DomainError("Saklanan bir sonuç buradan atılamaz; medya kütüphanesinden silebilirsiniz.", "CONFLICT");

  // Kararı yaz ama anahtarı koru: baytları bulmanın tek yolu odur. Silme başarısız olursa anahtar
  // kayıtta kalır; aynı "at" çağrısı tekrarlandığında temizlik kaldığı yerden sürer.
  const outcome = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.mediaEnhancement.findUnique({ where: { id: enhancement.id } });
    if (!current) throw new DomainError("İyileştirme bu sırada silindi.", "NOT_FOUND");
    if (current.decision === "DISCARDED") return { enhancement: current, discardedKey: current.outputStorageKey };
    if (current.decision) throw new DomainError("Saklanan bir sonuç buradan atılamaz; medya kütüphanesinden silebilirsiniz.", "CONFLICT");
    const updated = await tx.mediaEnhancement.update({
      where: { id: current.id },
      data: { decision: "DISCARDED", decidedById: userId, decidedAt: new Date() },
    });
    return { enhancement: updated, discardedKey: updated.outputStorageKey };
  }, { isolationLevel: "Serializable" }));
  if (!outcome.discardedKey) return outcome.enhancement;

  // Anahtar yalnızca DISCARDED kaydın üzerindedir (outputStorageKey tekil) ve saklanan bir çıktı
  // KEPT olurdu; dolayısıyla burada silinen baytlar ne kaynağa ne de saklanan bir türeve aittir.
  await storage.delete(outcome.discardedKey);
  await prisma.mediaEnhancement.updateMany({
    where: { id: enhancement.id, decision: "DISCARDED", outputStorageKey: outcome.discardedKey },
    data: { outputStorageKey: null },
  });
  return (await prisma.mediaEnhancement.findUnique({ where: { id: enhancement.id } })) ?? { ...outcome.enhancement, outputStorageKey: null };
}

const reviewSelect = {
  id: true, version: true, preset: true, status: true, decision: true, provider: true, provenance: true, parameterVersion: true,
  authenticitySensitive: true, outputStorageKey: true, outputWidth: true, outputHeight: true, outputSize: true, outputAssetId: true,
  errorCode: true, createdAt: true, completedAt: true, decidedAt: true,
} satisfies Prisma.MediaEnhancementSelect;

type ReviewRow = Prisma.MediaEnhancementGetPayload<{ select: typeof reviewSelect }>;

export type SafeEnhancementReviewItem = Omit<ReviewRow, "outputStorageKey"> & {
  /** Önizlenebilir bir çıktı dosyası hâlâ duruyor mu (atılanlarda hayır). Depolama anahtarı arayüze taşınmaz. */
  outputAvailable: boolean;
};

function toReviewItem(row: ReviewRow): SafeEnhancementReviewItem {
  const { outputStorageKey, ...rest } = row;
  // Atılan bir kayıtta anahtar, silme kesinleşene kadar duruyor olabilir; çıktı yine de yok sayılır.
  return { ...rest, outputAvailable: Boolean(outputStorageKey) && rest.decision !== "DISCARDED" };
}

export type SafeEnhanceSummary = {
  mediaAssetId: string;
  eligible: boolean;
  ineligibleReason: string | null;
  awaitingReview: number;
  kept: number;
  pending: boolean;
  latestFailure: { version: number; status: "FAILED" | "INVALID_OUTPUT"; errorCode: string | null } | null;
};

type SummarizableAsset = { id: string; type: string; origin: string; mimeType: string; width: number | null; height: number | null };

function summarize(asset: SummarizableAsset, rows: ReviewRow[]): SafeEnhanceSummary {
  const eligibility = safeEnhanceEligibility(asset);
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

/** Medya kütüphanesi için kısa özet; yalnızca üyesi olunan işletmenin medyaları döner. */
export async function listSafeEnhanceSummaries(userId: string, businessId: string): Promise<Map<string, SafeEnhanceSummary>> {
  await requireMembership(userId, businessId);
  const assets = await prisma.mediaAsset.findMany({
    where: { businessId },
    select: { id: true, type: true, origin: true, mimeType: true, width: true, height: true, enhancements: { select: reviewSelect, orderBy: { version: "desc" } } },
  });
  return new Map(assets.map((asset) => [asset.id, summarize(asset, asset.enhancements)]));
}

/** Görsel analizi detayındaki inceleme deneyimi: karar bekleyenler, saklananlar ve deneme geçmişi. */
export async function getSafeEnhanceReview(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    select: {
      id: true, businessId: true, type: true, origin: true, mimeType: true, width: true, height: true, originalFilename: true, createdAt: true,
      enhancements: { select: reviewSelect, orderBy: { version: "desc" } },
    },
  });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  const rows = asset.enhancements;
  const active = rows.filter((row) => row.status === "PENDING" || (row.status === "SUCCEEDED" && row.decision === null));
  return {
    asset: { id: asset.id, businessId: asset.businessId, originalFilename: asset.originalFilename, width: asset.width, height: asset.height, createdAt: asset.createdAt },
    summary: summarize(asset, rows),
    presets: enhancementPresets,
    /** Bu ön ayar için zaten aktif bir deneme var: tekrar istemek yeni iş açmaz, aynı denemeye düşer. */
    activePresets: [...new Set(active.map((row) => row.preset))],
    awaitingReview: rows.filter((row) => row.status === "SUCCEEDED" && row.decision === null).map(toReviewItem),
    kept: rows.filter((row) => row.decision === "KEPT").map(toReviewItem),
    history: rows.map(toReviewItem),
  };
}

/** Karar öncesi önizleme için çıktı baytları. Üyelik sorgunun içinde denetlenir. */
export async function readSafeEnhancementOutput(userId: string, enhancementId: string) {
  const enhancement = await prisma.mediaEnhancement.findFirst({
    where: { id: enhancementId, business: { memberships: { some: { userId } } } },
    select: { outputStorageKey: true, outputMimeType: true, outputSize: true, decision: true },
  });
  // Atılan bir çıktı, baytları henüz silinememiş olsa bile önizlenmez.
  if (!enhancement?.outputStorageKey || !enhancement.outputMimeType || enhancement.decision === "DISCARDED") return null;
  const object = await storage.get(enhancement.outputStorageKey);
  if (!object) return null;
  return { bytes: object.bytes, mimeType: enhancement.outputMimeType, size: enhancement.outputSize ?? object.bytes.byteLength };
}
