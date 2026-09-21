import "server-only";

import type { MediaRequirement, MediaType } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { requireMembership } from "@/lib/authorization";
import { summarizeMediaUsage, type MediaUsageSummary } from "@/features/media-usage/service";

// Phase 4 P4-03 kapsamı: Content Stock — yaklaşan plan öğelerinin mevcut özgün medyayla
// karşılanıp karşılanamayacağına deterministik, açıklanabilir bir cevap.
// Bu bir OPERASYONEL tamamlanma ölçütüdür; medya kalitesi veya sosyal performans puanı değildir.
// Hiçbir şey kalıcı olarak yazılmaz; her çağrıda MediaAsset + MediaUsage + plan öğelerinden hesaplanır.
// Fallback önerileri (P4-04) bu modülün dışındadır.
//
// Politika (kısa ve açık):
//  - Yaklaşan gereksinim: SUPERSEDED olmayan planların ACTIVE öğeleri, plannedDate bugün ve
//    sonrasında (işletme saat dilimine göre) ve horizonDays penceresi içinde;
//    NO_NEW_MEDIA_REQUIRED sayılmaz. REPLACED öğeler ve eski plan sürümleri yok sayılır.
//  - Uygunluk: medya, gereksinim etiketini taşımalı VE medya türü gereksinimle uyuşmalı
//    (VIDEO_* -> VIDEO, diğerleri -> IMAGE).
//  - Kullanım (MediaUsage): hiç kullanılmamış medya önce gelir. Daha önce kullanılmış medya
//    YENİDEN KULLANILABİLİR sayılır; yalnızca son reuseProtectionDays gün içinde kullanılmışsa
//    (yakınlık koruması) stoktan düşülür.
//  - Tahsis: bir medya en fazla BİR yaklaşan öğeyi karşılar (çift sayım yok). Öğeler tarih
//    sırasıyla gezilir; öğeye zaten atanmış uygun ve serbest medya varsa o kullanılır, yoksa
//    serbest havuzdan en az etiketli (en özgül), önce hiç kullanılmamış, sonra en eski
//    kullanılmış, sonra en eski yüklenmiş medya seçilir.
//  - Durum: tüm öğeler karşılanıyorsa (veya yaklaşan öğe yoksa) HEALTHY; hiçbiri
//    karşılanmıyorsa CRITICAL; aradaysa LOW.

export type ContentStockStatus = "HEALTHY" | "LOW" | "CRITICAL";
export type StockRequirement = Exclude<MediaRequirement, "NO_NEW_MEDIA_REQUIRED">;

export type ContentStockPolicy = { horizonDays: number; reuseProtectionDays: number };
export const defaultContentStockPolicy: ContentStockPolicy = { horizonDays: 30, reuseProtectionDays: 30 };

export type StockPlanItem = { id: string; mediaRequirement: MediaRequirement; plannedDate: Date; mediaAssetId: string | null };
export type StockMediaAsset = { id: string; type: MediaType; tags: string[]; createdAt: Date };

export type ContentStockAllocation = { planItemId: string; mediaRequirement: StockRequirement; plannedDate: Date; mediaAssetId: string | null };
export type ContentStockRequirementLine = { mediaRequirement: StockRequirement; upcoming: number; covered: number; missing: number };

export type ContentStockReport = {
  status: ContentStockStatus;
  window: { from: Date; to: Date };
  policy: ContentStockPolicy;
  upcomingCount: number;
  coveredCount: number;
  missingCount: number;
  byRequirement: ContentStockRequirementLine[];
  missingByRequirement: ContentStockRequirementLine[];
  inventory: { tagged: number; available: number; neverUsed: number; reusable: number; recentlyUsed: number };
  allocations: ContentStockAllocation[];
};

const planningTags: ReadonlySet<string> = new Set(["PHOTO_PRODUCT", "PHOTO_ATMOSPHERE", "PHOTO_PEOPLE", "VIDEO_VERTICAL", "VIDEO_KITCHEN", "CUSTOM_GRAPHIC"]);

export function mediaTypeForRequirement(requirement: StockRequirement): MediaType {
  return requirement === "VIDEO_VERTICAL" || requirement === "VIDEO_KITCHEN" ? "VIDEO" : "IMAGE";
}

function isStockRequirement(value: MediaRequirement): value is StockRequirement {
  return value !== "NO_NEW_MEDIA_REQUIRED";
}

function isSuitable(asset: StockMediaAsset, requirement: StockRequirement) {
  return asset.tags.includes(requirement) && asset.type === mediaTypeForRequirement(requirement);
}

function addDaysUtc(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** İşletme saat dilimindeki bugünün takvim günü; plannedDate ile aynı gösterimde (UTC gece yarısı). */
export function calendarDayUtc(now: Date, timeZone: string) {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${day}T00:00:00.000Z`);
}

type RankedAsset = StockMediaAsset & { usage: MediaUsageSummary; tagCount: number };

function compareCandidates(a: RankedAsset, b: RankedAsset) {
  if (a.tagCount !== b.tagCount) return a.tagCount - b.tagCount;
  if (a.usage.neverUsed !== b.usage.neverUsed) return a.usage.neverUsed ? -1 : 1;
  const aUsed = a.usage.lastUsedAt?.getTime() ?? 0;
  const bUsed = b.usage.lastUsedAt?.getTime() ?? 0;
  if (aUsed !== bUsed) return aUsed - bUsed;
  if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
  return compareIds(a.id, b.id);
}

/**
 * Saf, deterministik hesap. Girdi olarak yalnızca AYNI işletmeye ait yaklaşan öğeler,
 * medyalar ve kullanım özetleri verilmelidir; kiracı filtresi çağıranın sorumluluğudur.
 */
export function buildContentStockReport(input: {
  items: StockPlanItem[];
  assets: StockMediaAsset[];
  usage: Map<string, MediaUsageSummary>;
  now: Date;
  window: { from: Date; to: Date };
  policy?: Partial<ContentStockPolicy>;
}): ContentStockReport {
  const policy = { ...defaultContentStockPolicy, ...input.policy };
  const protectedSince = addDaysUtc(input.now, -policy.reuseProtectionDays);

  const tagged: RankedAsset[] = input.assets
    .map((asset) => ({
      ...asset,
      tagCount: asset.tags.filter((tag) => planningTags.has(tag)).length,
      usage: input.usage.get(asset.id) ?? { mediaAssetId: asset.id, usageCount: 0, lastUsedAt: null, neverUsed: true },
    }))
    .filter((asset) => asset.tagCount > 0);
  const isRecentlyUsed = (asset: RankedAsset) => asset.usage.lastUsedAt !== null && asset.usage.lastUsedAt >= protectedSince;
  const recentlyUsed = tagged.filter(isRecentlyUsed);
  const available = tagged.filter((asset) => !isRecentlyUsed(asset));
  const availableById = new Map(available.map((asset) => [asset.id, asset]));

  const items = input.items
    .filter((item): item is StockPlanItem & { mediaRequirement: StockRequirement } => isStockRequirement(item.mediaRequirement))
    .sort((a, b) => a.plannedDate.getTime() - b.plannedDate.getTime() || compareIds(a.id, b.id));

  const allocated = new Set<string>();
  const allocations: ContentStockAllocation[] = items.map((item) => {
    const assigned = item.mediaAssetId ? availableById.get(item.mediaAssetId) : undefined;
    let chosen = assigned && !allocated.has(assigned.id) && isSuitable(assigned, item.mediaRequirement) ? assigned : undefined;
    if (!chosen) {
      chosen = available.filter((asset) => !allocated.has(asset.id) && isSuitable(asset, item.mediaRequirement)).sort(compareCandidates)[0];
    }
    if (chosen) allocated.add(chosen.id);
    return { planItemId: item.id, mediaRequirement: item.mediaRequirement, plannedDate: item.plannedDate, mediaAssetId: chosen?.id ?? null };
  });

  const lines = new Map<StockRequirement, ContentStockRequirementLine>();
  for (const allocation of allocations) {
    const line = lines.get(allocation.mediaRequirement) ?? { mediaRequirement: allocation.mediaRequirement, upcoming: 0, covered: 0, missing: 0 };
    line.upcoming += 1;
    if (allocation.mediaAssetId) line.covered += 1; else line.missing += 1;
    lines.set(allocation.mediaRequirement, line);
  }
  const byRequirement = [...lines.values()].sort((a, b) => b.missing - a.missing || b.upcoming - a.upcoming || compareIds(a.mediaRequirement, b.mediaRequirement));

  const upcomingCount = allocations.length;
  const coveredCount = allocations.filter((allocation) => allocation.mediaAssetId).length;
  const missingCount = upcomingCount - coveredCount;
  const status: ContentStockStatus = missingCount === 0 ? "HEALTHY" : coveredCount === 0 ? "CRITICAL" : "LOW";

  return {
    status,
    window: input.window,
    policy,
    upcomingCount,
    coveredCount,
    missingCount,
    byRequirement,
    missingByRequirement: byRequirement.filter((line) => line.missing > 0),
    inventory: {
      tagged: tagged.length,
      available: available.length,
      neverUsed: available.filter((asset) => asset.usage.neverUsed).length,
      reusable: available.filter((asset) => !asset.usage.neverUsed).length,
      recentlyUsed: recentlyUsed.length,
    },
    allocations,
  };
}

/**
 * İşletme için Content Stock raporu. Sunucu içi bileşim içindir; çağıran taraf
 * yetkilendirmeyi yapmış olmalıdır. Yalnızca bu işletmenin medyası, kullanım geçmişi ve
 * SUPERSEDED olmayan planlarının ACTIVE öğeleri hesaba katılır.
 */
export async function calculateContentStock(businessId: string, options: { now?: Date; policy?: Partial<ContentStockPolicy> } = {}): Promise<ContentStockReport> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
  if (!business) throw new DomainError("İşletme bulunamadı.", "NOT_FOUND");
  const policy = { ...defaultContentStockPolicy, ...options.policy };
  const now = options.now ?? new Date();
  const from = calendarDayUtc(now, business.timezone);
  const to = addDaysUtc(from, policy.horizonDays);

  const [items, assets, usage] = await Promise.all([
    prisma.contentPlanItem.findMany({
      where: {
        plan: { businessId, status: { not: "SUPERSEDED" } },
        status: "ACTIVE",
        mediaRequirement: { not: "NO_NEW_MEDIA_REQUIRED" },
        plannedDate: { gte: from, lt: to },
      },
      select: { id: true, mediaRequirement: true, plannedDate: true, mediaAssetId: true },
      orderBy: [{ plannedDate: "asc" }, { id: "asc" }],
    }),
    prisma.mediaAsset.findMany({ where: { businessId }, select: { id: true, type: true, tags: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    summarizeMediaUsage(businessId),
  ]);
  return buildContentStockReport({ items, assets, usage, now, window: { from, to }, policy });
}

/** Üyelik denetimli giriş noktası (UI/aksiyon katmanı için). */
export async function getContentStock(userId: string, businessId: string, options: { now?: Date; policy?: Partial<ContentStockPolicy> } = {}) {
  await requireMembership(userId, businessId);
  return calculateContentStock(businessId, options);
}
