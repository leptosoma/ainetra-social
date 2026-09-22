import "server-only";

import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { getActivePlatformRules } from "@/features/platform-intelligence/service";
import { buildVisualAnalysisResult } from "./normalize";
import { getImageAnalysisProvider, type ImageAnalysisProvider } from "./providers";
import { VISUAL_ANALYSIS_VERSION, providerOutputSchema, visualAnalysisResultSchema, type VisualAnalysisResult } from "./schemas";

// P5-01 Görsel Analiz Temeli. Görseli dönüştürmez; yalnızca doğrulanmış, açıklanabilir medya
// meta verisi üretir. Bu modül BusinessAttribute, BrandProfile veya hedeflere asla yazmaz.
//
// Sürüm/güncellik kuralı: her deneme (mediaAssetId, version) ile sürümlenir. Yalnızca SUCCEEDED
// bir deneme MediaAsset.currentAnalysisId'ye yazılır ve yalnızca mevcut güncelden daha yüksek
// sürümlüyse güncel olur; böylece iki eşzamanlı yeniden analizde geç biten eski sürüm güncel
// analizi geri alamaz. Başarısız/geçersiz denemeler MediaAsset'e dokunmaz.

export type AnalyzeMediaOptions = {
  provider?: ImageAnalysisProvider;
  skipRateLimit?: boolean;
};

const maxAnalysesPerHour = 30;
const maxConflictRetries = 3;

/** Serializable çakışması (P2034 / 40001) ya da sürüm yarışında unique ihlali (P2002). */
function isRetryableConflict(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 2) return false;
  const candidate = error as { code?: unknown; kind?: unknown; originalCode?: unknown; cause?: unknown };
  if (["P2034", "P2002"].includes(String(candidate.code)) || candidate.kind === "TransactionWriteConflict" || String(candidate.originalCode) === "40001") return true;
  return isRetryableConflict(candidate.cause, depth + 1);
}

async function withConflictRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableConflict(error) || attempt >= maxConflictRetries) throw error;
    }
  }
}

async function requireImageAsset(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  return asset;
}

async function markAttempt(id: string, status: "FAILED" | "INVALID_OUTPUT", errorCode: string) {
  // updateMany: medya bu sırada silindiyse (cascade) sessizce geçilir; MediaAsset'e dokunulmaz.
  await prisma.mediaAnalysis.updateMany({ where: { id }, data: { status, errorCode, completedAt: new Date() } });
  return prisma.mediaAnalysis.findUnique({ where: { id } });
}

export async function analyzeMediaAsset(userId: string, mediaAssetId: string, options: AnalyzeMediaOptions = {}) {
  const asset = await requireImageAsset(userId, mediaAssetId);
  if (asset.type !== "IMAGE" || !asset.width || !asset.height) {
    throw new DomainError("Görsel analizi yalnızca fotoğraf ve görseller için kullanılabilir.", "VALIDATION_ERROR");
  }
  if (!options.skipRateLimit) {
    const recent = await prisma.mediaAnalysis.count({
      where: { businessId: asset.businessId, triggeredById: userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= maxAnalysesPerHour) throw new DomainError(`Bir saat içinde en fazla ${maxAnalysesPerHour} görsel analizi çalıştırabilirsiniz.`, "VALIDATION_ERROR");
  }
  const provider = options.provider ?? getImageAnalysisProvider();

  // 1) Sürüm ayır: PENDING kayıt. Eşzamanlı yarışta unique/serializable çakışması yeniden denenir.
  const attempt = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const latest = await tx.mediaAnalysis.findFirst({ where: { mediaAssetId: asset.id }, orderBy: { version: "desc" }, select: { version: true } });
    return tx.mediaAnalysis.create({
      data: {
        businessId: asset.businessId,
        mediaAssetId: asset.id,
        version: (latest?.version ?? 0) + 1,
        provider: provider.provider,
        model: provider.model,
        provenance: provider.provenance,
        analysisVersion: VISUAL_ANALYSIS_VERSION,
        triggeredById: userId,
      },
    });
  }, { isolationLevel: "Serializable" }));

  // 2) Sağlayıcı çağrısı işlem dışında; hata durumunda yalnızca deneme kaydı işaretlenir.
  const object = await storage.get(asset.storageKey);
  if (!object) return markAttempt(attempt.id, "FAILED", "MEDIA_BYTES_MISSING");
  let rawOutput: unknown;
  try {
    rawOutput = await provider.analyze({ bytes: object.bytes, mimeType: asset.mimeType, width: asset.width, height: asset.height, originalFilename: asset.originalFilename, planningTags: asset.tags });
  } catch {
    return markAttempt(attempt.id, "FAILED", "PROVIDER_FAILED");
  }
  const parsedOutput = providerOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) return markAttempt(attempt.id, "INVALID_OUTPUT", "SCHEMA_VALIDATION_FAILED");

  // 3) Normalize et ve saklamadan önce yeniden doğrula (ham yük asla saklanmaz).
  const rules = await getActivePlatformRules(userId, asset.businessId);
  const built = visualAnalysisResultSchema.safeParse(buildVisualAnalysisResult({ output: parsedOutput.data, width: asset.width, height: asset.height, rules, provenance: provider.provenance }));
  if (!built.success) return markAttempt(attempt.id, "INVALID_OUTPUT", "RESULT_VALIDATION_FAILED");
  const result = built.data;

  // 4) Güncel işaretçiyi işlem içinde, sürüm karşılaştırarak güncelle.
  return withConflictRetry(() => prisma.$transaction(async (tx) => {
    const now = new Date();
    const owner = await tx.mediaAsset.findUnique({ where: { id: asset.id }, select: { currentAnalysis: { select: { id: true, version: true } } } });
    if (!owner) throw new DomainError("Medya bu sırada silindi.", "NOT_FOUND");
    const becomesCurrent = !owner.currentAnalysis || owner.currentAnalysis.version < attempt.version;
    const completed = await tx.mediaAnalysis.update({
      where: { id: attempt.id },
      data: { status: "SUCCEEDED", category: result.category, result: result as Prisma.InputJsonValue, completedAt: now, supersededAt: becomesCurrent ? null : now },
    });
    if (becomesCurrent) {
      if (owner.currentAnalysis) await tx.mediaAnalysis.update({ where: { id: owner.currentAnalysis.id }, data: { supersededAt: now } });
      await tx.mediaAsset.update({ where: { id: asset.id }, data: { currentAnalysisId: attempt.id } });
    }
    return completed;
  }, { isolationLevel: "Serializable" }));
}

/** Saklanan JSON'u sözleşmeye göre okur; uyumsuz kayıt (ör. eski şema) null döner, asla ham yük sızmaz. */
export function readVisualAnalysisResult(value: unknown): VisualAnalysisResult | null {
  const parsed = visualAnalysisResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const summarySelect = { id: true, version: true, status: true, provenance: true, category: true, errorCode: true, completedAt: true, createdAt: true, result: true } satisfies Prisma.MediaAnalysisSelect;

export type MediaAnalysisSummary = {
  mediaAssetId: string;
  supported: boolean;
  current: { id: string; version: number; provenance: "REAL" | "DEVELOPMENT"; category: VisualAnalysisResult["category"]; recommendedAction: VisualAnalysisResult["recommendedAction"]; completedAt: Date | null } | null;
  /** Güncel analizden sonra yapılan ve başarısız/geçersiz kalan son deneme; kullanıcıya nedenini göstermek için. */
  latestFailure: { version: number; status: "FAILED" | "INVALID_OUTPUT"; errorCode: string | null } | null;
  pending: boolean;
};

function summarize(asset: { id: string; type: string; currentAnalysis: Prisma.MediaAnalysisGetPayload<{ select: typeof summarySelect }> | null; analyses: Prisma.MediaAnalysisGetPayload<{ select: typeof summarySelect }>[] }): MediaAnalysisSummary {
  const latest = asset.analyses[0] ?? null;
  const result = asset.currentAnalysis ? readVisualAnalysisResult(asset.currentAnalysis.result) : null;
  const current = asset.currentAnalysis && result
    ? { id: asset.currentAnalysis.id, version: asset.currentAnalysis.version, provenance: asset.currentAnalysis.provenance, category: result.category, recommendedAction: result.recommendedAction, completedAt: asset.currentAnalysis.completedAt }
    : null;
  const latestIsNewer = latest && (!asset.currentAnalysis || latest.version > asset.currentAnalysis.version);
  return {
    mediaAssetId: asset.id,
    supported: asset.type === "IMAGE",
    current,
    latestFailure: latestIsNewer && (latest.status === "FAILED" || latest.status === "INVALID_OUTPUT") ? { version: latest.version, status: latest.status, errorCode: latest.errorCode } : null,
    pending: Boolean(latestIsNewer && latest.status === "PENDING"),
  };
}

/** Medya kütüphanesi için özet; yalnızca üyesi olunan işletmenin medyaları döner. */
export async function listMediaAnalysisSummaries(userId: string, businessId: string): Promise<Map<string, MediaAnalysisSummary>> {
  await requireMembership(userId, businessId);
  const assets = await prisma.mediaAsset.findMany({
    where: { businessId },
    select: { id: true, type: true, currentAnalysis: { select: summarySelect }, analyses: { select: summarySelect, orderBy: { version: "desc" }, take: 1 } },
  });
  return new Map(assets.map((asset) => [asset.id, summarize(asset)]));
}

/** Medya detayı: güncel doğrulanmış sonuç + deneme geçmişi (ham yük yok). Üyelik sunucu tarafında denetlenir. */
export async function getMediaAnalysisDetail(userId: string, mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    include: { currentAnalysis: { select: { ...summarySelect, provider: true, analysisVersion: true } }, analyses: { select: summarySelect, orderBy: { version: "desc" } } },
  });
  if (!asset) throw new DomainError("Medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  const summary = summarize({ id: asset.id, type: asset.type, currentAnalysis: asset.currentAnalysis, analyses: asset.analyses.slice(0, 1) });
  const result = asset.currentAnalysis ? readVisualAnalysisResult(asset.currentAnalysis.result) : null;
  return {
    asset: { id: asset.id, businessId: asset.businessId, type: asset.type, originalFilename: asset.originalFilename, width: asset.width, height: asset.height, tags: asset.tags, createdAt: asset.createdAt },
    summary,
    current: asset.currentAnalysis && result ? { id: asset.currentAnalysis.id, version: asset.currentAnalysis.version, provenance: asset.currentAnalysis.provenance, completedAt: asset.currentAnalysis.completedAt, result } : null,
    history: asset.analyses.map((analysis) => ({ id: analysis.id, version: analysis.version, status: analysis.status, provenance: analysis.provenance, errorCode: analysis.errorCode, createdAt: analysis.createdAt, completedAt: analysis.completedAt })),
  };
}
