import "server-only";

import { createHash } from "node:crypto";
import type { ContentFallbackProposal, Prisma } from "../../../generated/prisma/client";
import type { BusinessAttributeCategory, ContentFallbackKind, MediaRequirement, MediaType } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { requireMembership } from "@/lib/authorization";
import type { MediaUsageSummary } from "@/features/media-usage/service";
import { summarizeMediaUsage } from "@/features/media-usage/service";
import { calendarDayUtc, defaultContentStockPolicy, mediaTypeForRequirement, type StockRequirement } from "@/features/content-stock/service";
import { fulfillCaptureRequestsForItems, syncCaptureRequestsForActiveItems } from "@/features/capture-engine/service";

// Phase 4 P4-04 kapsamı: Content Fallback Engine — medyası eksik, yaklaşan ve ACTIVE bir plan
// öğesi için deterministik, açıklanabilir TEK bir yedek öneri üretir. Bu kural tabanlı bir
// motordur; yapay zeka üretimi değildir. Öneri üretmek planı DEĞİŞTİRMEZ; plan yalnızca
// kullanıcı öneriyi açıkça kabul ettiğinde ve kabul anındaki yeniden doğrulama geçerse değişir.
//
// Sıralama (product-bible "Content Fallback"):
//  1. UNUSED_AUTHENTIC_MEDIA        — gereksinim etiketli, hiç kullanılmamış, son freshDays içinde yüklenmiş medya
//  2. OLDER_UNUSED_AUTHENTIC_MEDIA  — gereksinim etiketli, hiç kullanılmamış, daha eski medya
//  3. REUSABLE_AUTHENTIC_MEDIA      — gereksinim etiketli, daha önce kullanılmış ama reuseProtectionDays dışında kalan medya
//  4. FORMAT_ADAPTATION             — aynı medya ailesinde (fotoğraf/video) farklı etiketli, yakın zamanda kullanılmamış medya;
//                                     kabulde öğenin medya ihtiyacı o etikete uyarlanır
//  5. CONFIRMED_BUSINESS_INFO       — yalnızca kanonik CONFIRMED Business Brain bilgileri; kabulde öğe yeni medya gerektirmez olur
//  6. VERIFIED_SOCIAL_PROOF         — yalnızca gerçek doğrulanmış veri varsa (bugün böyle bir kaynak yok; asla uydurulmaz)
//  7. BRAND_CREATIVE_PLACEHOLDER    — marka kimliğiyle hazırlanacak yer tutucu tasarım; kabulde öğe CUSTOM_GRAPHIC ister
//  8. yedek yok
// MediaUsage (P4-02) hiç-kullanılmadı önceliğini ve yakınlık korumasını belirler. Başka bir ACTIVE
// öğeye atanmış medya "rezerve" sayılır ve 1–4 için aday olmaz (aynı medya iki öğeye önerilmez).

export type FallbackPolicy = { reuseProtectionDays: number; freshDays: number };
export const defaultFallbackPolicy: FallbackPolicy = { reuseProtectionDays: defaultContentStockPolicy.reuseProtectionDays, freshDays: 30 };

export type FallbackPlanItem = { id: string; mediaRequirement: MediaRequirement; pillar: string };
export type FallbackMediaAsset = { id: string; type: MediaType; tags: string[]; createdAt: Date; originalFilename: string };
export type FallbackConfirmedFact = { id: string; category: BusinessAttributeCategory; key: string; value: string; source: string; confirmedAt: Date | null };
export type FallbackVerifiedSocialProof = { id: string; label: string; sourceReference: string; verifiedAt: Date };
export type FallbackBrand = { businessName: string; hasBrandProfile: boolean };

export type FallbackSource =
  | { type: "MEDIA_ASSET"; id: string; originalFilename: string; mediaType: MediaType; tags: string[]; createdAt: string; usageCount: number; lastUsedAt: string | null }
  | { type: "BUSINESS_ATTRIBUTE"; id: string; category: BusinessAttributeCategory; key: string; value: string; source: string; confirmedAt: string | null }
  | { type: "VERIFIED_SOCIAL_PROOF"; id: string; label: string; sourceReference: string; verifiedAt: string }
  | { type: "BRAND"; businessName: string; hasBrandProfile: boolean };

export type ContentFallbackDraft = {
  kind: ContentFallbackKind;
  mediaAssetId: string | null;
  targetMediaRequirement: MediaRequirement;
  rationale: string;
  sources: FallbackSource[];
};

export type ContentFallbackEvaluation = { proposal: ContentFallbackDraft | null; reason: string };

const requirementLabels: Record<MediaRequirement, string> = {
  PHOTO_PRODUCT: "Ürün fotoğrafı", PHOTO_ATMOSPHERE: "Mekân fotoğrafı", PHOTO_PEOPLE: "Ekip fotoğrafı",
  VIDEO_VERTICAL: "Dikey video", VIDEO_KITCHEN: "Hazırlık videosu", CUSTOM_GRAPHIC: "Özel tasarım", NO_NEW_MEDIA_REQUIRED: "Yeni medya gerekmiyor",
};

const photoFamily: readonly StockRequirement[] = ["PHOTO_PRODUCT", "PHOTO_ATMOSPHERE", "PHOTO_PEOPLE"];
const videoFamily: readonly StockRequirement[] = ["VIDEO_VERTICAL", "VIDEO_KITCHEN"];
const planningTags: ReadonlySet<string> = new Set([...photoFamily, ...videoFamily, "CUSTOM_GRAPHIC"]);

/** Onaylı bilgi yedeği için kullanılabilecek Business Brain kategorileri; diğerleri (ton, kaçınılacak kelime vb.) içerik konusu değildir. */
export const informationCategories: readonly BusinessAttributeCategory[] = ["FACT", "PRODUCTS_SERVICES", "DESCRIPTION", "LOCATION_CONTEXT"];
const maxFactsPerProposal = 3;

const mediaKinds: ReadonlySet<ContentFallbackKind> = new Set(["UNUSED_AUTHENTIC_MEDIA", "OLDER_UNUSED_AUTHENTIC_MEDIA", "REUSABLE_AUTHENTIC_MEDIA", "FORMAT_ADAPTATION"]);

export function isMediaFallbackKind(kind: ContentFallbackKind) {
  return mediaKinds.has(kind);
}

function familyOf(requirement: StockRequirement): readonly StockRequirement[] {
  return photoFamily.includes(requirement) ? photoFamily : videoFamily.includes(requirement) ? videoFamily : [requirement];
}

function addDaysUtc(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function daysBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type RankedAsset = FallbackMediaAsset & { usage: MediaUsageSummary; tagCount: number };

/** Kullanılmamış adaylar: en özgül (az etiket), sonra en yeni yüklenen. */
function compareUnused(a: RankedAsset, b: RankedAsset) {
  if (a.tagCount !== b.tagCount) return a.tagCount - b.tagCount;
  if (a.createdAt.getTime() !== b.createdAt.getTime()) return b.createdAt.getTime() - a.createdAt.getTime();
  return compareIds(a.id, b.id);
}

/** Yeniden kullanım adayları: en uzun süredir kullanılmayan, sonra en özgül. */
function compareReusable(a: RankedAsset, b: RankedAsset) {
  const aUsed = a.usage.lastUsedAt?.getTime() ?? 0;
  const bUsed = b.usage.lastUsedAt?.getTime() ?? 0;
  if (aUsed !== bUsed) return aUsed - bUsed;
  if (a.tagCount !== b.tagCount) return a.tagCount - b.tagCount;
  return compareIds(a.id, b.id);
}

/** Format uyarlama adayları: hiç kullanılmamış önce, sonra en uzun süredir kullanılmayan, sonra en özgül, sonra en yeni. */
function compareAdaptation(a: RankedAsset, b: RankedAsset) {
  if (a.usage.neverUsed !== b.usage.neverUsed) return a.usage.neverUsed ? -1 : 1;
  return compareReusable(a, b) || compareUnused(a, b);
}

function mediaSource(asset: RankedAsset): FallbackSource {
  return { type: "MEDIA_ASSET", id: asset.id, originalFilename: asset.originalFilename, mediaType: asset.type, tags: asset.tags, createdAt: asset.createdAt.toISOString(), usageCount: asset.usage.usageCount, lastUsedAt: asset.usage.lastUsedAt?.toISOString() ?? null };
}

function factSource(fact: FallbackConfirmedFact): FallbackSource {
  return { type: "BUSINESS_ATTRIBUTE", id: fact.id, category: fact.category, key: fact.key, value: fact.value, source: fact.source, confirmedAt: fact.confirmedAt?.toISOString() ?? null };
}

/** Sütuna göre kategori önceliği: ürün/tanıtım için ürün-hizmet bilgisi, mekân odaklı sütunlar için konum bağlamı öne alınır. */
function informationOrder(pillar: string): readonly BusinessAttributeCategory[] {
  if (pillar === "PRODUCT" || pillar === "PROMOTIONAL") return ["PRODUCTS_SERVICES", "FACT", "DESCRIPTION", "LOCATION_CONTEXT"];
  if (pillar === "ATMOSPHERE" || pillar === "COMMUNITY" || pillar === "EVENT") return ["LOCATION_CONTEXT", "FACT", "DESCRIPTION", "PRODUCTS_SERVICES"];
  return informationCategories;
}

/**
 * Saf, deterministik değerlendirme. Girdi olarak yalnızca AYNI işletmeye ait medya, kullanım
 * özeti ve onaylı bilgiler verilmelidir; kiracı filtresi çağıranın sorumluluğudur. Hiçbir şey yazmaz.
 */
export function evaluateContentFallback(input: {
  item: FallbackPlanItem;
  assets: FallbackMediaAsset[];
  usage: Map<string, MediaUsageSummary>;
  reservedAssetIds?: Iterable<string>;
  confirmedFacts: FallbackConfirmedFact[];
  verifiedSocialProof: FallbackVerifiedSocialProof[];
  brand: FallbackBrand;
  now: Date;
  policy?: Partial<FallbackPolicy>;
}): ContentFallbackEvaluation {
  const policy = { ...defaultFallbackPolicy, ...input.policy };
  if (input.item.mediaRequirement === "NO_NEW_MEDIA_REQUIRED") return { proposal: null, reason: "Bu öğe yeni medya gerektirmiyor." };
  const requirement = input.item.mediaRequirement;
  const requirementLabel = requirementLabels[requirement];
  const mediaType = mediaTypeForRequirement(requirement);
  const protectedSince = addDaysUtc(input.now, -policy.reuseProtectionDays);
  const freshSince = addDaysUtc(input.now, -policy.freshDays);
  const reserved = new Set(input.reservedAssetIds ?? []);

  const candidates: RankedAsset[] = input.assets
    .filter((asset) => asset.type === mediaType && !reserved.has(asset.id))
    .map((asset) => ({ ...asset, tagCount: asset.tags.filter((tag) => planningTags.has(tag)).length, usage: input.usage.get(asset.id) ?? { mediaAssetId: asset.id, usageCount: 0, lastUsedAt: null, neverUsed: true } }));
  const isRecentlyUsed = (asset: RankedAsset) => asset.usage.lastUsedAt !== null && asset.usage.lastUsedAt >= protectedSince;
  const exact = candidates.filter((asset) => asset.tags.includes(requirement));
  const recentlyUsedCount = exact.filter(isRecentlyUsed).length;
  const recentNote = recentlyUsedCount ? ` ${recentlyUsedCount} uygun medya son ${policy.reuseProtectionDays} gün içinde kullanıldığı için önerilmedi.` : "";

  // 1. Yeni/kullanılmamış özgün medya
  const unusedFresh = exact.filter((asset) => asset.usage.neverUsed && asset.createdAt >= freshSince).sort(compareUnused)[0];
  if (unusedFresh) {
    return { reason: "UNUSED_AUTHENTIC_MEDIA", proposal: {
      kind: "UNUSED_AUTHENTIC_MEDIA", mediaAssetId: unusedFresh.id, targetMediaRequirement: requirement, sources: [mediaSource(unusedFresh)],
      rationale: `Hiç kullanılmamış ${requirementLabel.toLocaleLowerCase("tr")} mevcut: "${unusedFresh.originalFilename}" (${daysBetween(unusedFresh.createdAt, input.now)} gün önce yüklendi). Yeni ve özgün medya her zaman önceliklidir.`,
    } };
  }

  // 2. Daha eski kullanılmamış özgün medya
  const unusedOlder = exact.filter((asset) => asset.usage.neverUsed).sort(compareUnused)[0];
  if (unusedOlder) {
    return { reason: "OLDER_UNUSED_AUTHENTIC_MEDIA", proposal: {
      kind: "OLDER_UNUSED_AUTHENTIC_MEDIA", mediaAssetId: unusedOlder.id, targetMediaRequirement: requirement, sources: [mediaSource(unusedOlder)],
      rationale: `Son ${policy.freshDays} günde yüklenmiş kullanılmamış ${requirementLabel.toLocaleLowerCase("tr")} yok; daha eski ama hiç kullanılmamış "${unusedOlder.originalFilename}" (${daysBetween(unusedOlder.createdAt, input.now)} gün önce yüklendi) uygun.`,
    } };
  }

  // 3. Yakınlık koruması dışında yeniden kullanılabilir özgün medya
  const reusable = exact.filter((asset) => !asset.usage.neverUsed && !isRecentlyUsed(asset)).sort(compareReusable)[0];
  if (reusable) {
    return { reason: "REUSABLE_AUTHENTIC_MEDIA", proposal: {
      kind: "REUSABLE_AUTHENTIC_MEDIA", mediaAssetId: reusable.id, targetMediaRequirement: requirement, sources: [mediaSource(reusable)],
      rationale: `Kullanılmamış ${requirementLabel.toLocaleLowerCase("tr")} yok; "${reusable.originalFilename}" en son ${daysBetween(reusable.usage.lastUsedAt!, input.now)} gün önce kullanıldı ve ${policy.reuseProtectionDays} günlük yakınlık korumasının dışında olduğu için yeniden kullanılabilir.${recentNote}`,
    } };
  }

  // 4. Format uyarlaması: aynı medya ailesinde farklı etiket
  const family = familyOf(requirement).filter((member) => member !== requirement);
  const adaptable = candidates
    .filter((asset) => !isRecentlyUsed(asset) && asset.tags.some((tag) => (family as string[]).includes(tag)))
    .sort(compareAdaptation)[0];
  if (adaptable) {
    const target = family.filter((member) => adaptable.tags.includes(member)).sort()[0];
    return { reason: "FORMAT_ADAPTATION", proposal: {
      kind: "FORMAT_ADAPTATION", mediaAssetId: adaptable.id, targetMediaRequirement: target, sources: [mediaSource(adaptable)],
      rationale: `${requirementLabel} için uygun medya yok; aynı türde (${mediaType === "VIDEO" ? "video" : "fotoğraf"}) "${adaptable.originalFilename}" (${requirementLabels[target].toLocaleLowerCase("tr")}) ile içerik bu formata uyarlanabilir. Kabul edilirse öğenin medya ihtiyacı "${requirementLabels[target]}" olarak güncellenir.${recentNote}`,
    } };
  }

  // 5. Onaylı kanonik işletme bilgisi
  const order = informationOrder(input.item.pillar);
  const facts = input.confirmedFacts
    .filter((fact) => informationCategories.includes(fact.category) && fact.value.trim().length > 0)
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || (a.confirmedAt?.getTime() ?? 0) - (b.confirmedAt?.getTime() ?? 0) || compareIds(a.id, b.id))
    .slice(0, maxFactsPerProposal);
  if (facts.length) {
    return { reason: "CONFIRMED_BUSINESS_INFO", proposal: {
      kind: "CONFIRMED_BUSINESS_INFO", mediaAssetId: null, targetMediaRequirement: "NO_NEW_MEDIA_REQUIRED", sources: facts.map(factSource),
      rationale: `Uygun özgün medya yok. Onaylı işletme bilgisine dayalı bilgilendirici içerik önerilir: ${facts.map((fact) => `"${fact.value}"`).join(", ")}. Yalnızca onaylanmış kanonik bilgiler kullanılır; ürün, fiyat, etkinlik, kampanya veya yorum uydurulmaz. Kabul edilirse öğe yeni medya gerektirmez olarak işaretlenir.${recentNote}`,
    } };
  }

  // 6. Doğrulanmış sosyal kanıt — yalnızca gerçek doğrulanmış veri varsa
  const proof = [...input.verifiedSocialProof].sort((a, b) => b.verifiedAt.getTime() - a.verifiedAt.getTime() || compareIds(a.id, b.id))[0];
  if (proof) {
    return { reason: "VERIFIED_SOCIAL_PROOF", proposal: {
      kind: "VERIFIED_SOCIAL_PROOF", mediaAssetId: null, targetMediaRequirement: "NO_NEW_MEDIA_REQUIRED",
      sources: [{ type: "VERIFIED_SOCIAL_PROOF", id: proof.id, label: proof.label, sourceReference: proof.sourceReference, verifiedAt: proof.verifiedAt.toISOString() }],
      rationale: `Uygun özgün medya ve onaylı işletme bilgisi yok; doğrulanmış sosyal kanıt kullanılabilir: "${proof.label}" (${proof.sourceReference}). Kabul edilirse öğe yeni medya gerektirmez olarak işaretlenir.${recentNote}`,
    } };
  }

  // 7. Marka yer tutucu tasarımı
  if (requirement !== "CUSTOM_GRAPHIC") {
    return { reason: "BRAND_CREATIVE_PLACEHOLDER", proposal: {
      kind: "BRAND_CREATIVE_PLACEHOLDER", mediaAssetId: null, targetMediaRequirement: "CUSTOM_GRAPHIC",
      sources: [{ type: "BRAND", businessName: input.brand.businessName, hasBrandProfile: input.brand.hasBrandProfile }],
      rationale: `Uygun özgün medya, onaylı işletme bilgisi veya doğrulanmış sosyal kanıt yok. ${input.brand.businessName} marka kimliğiyle hazırlanacak bir yer tutucu tasarım önerilir; kabul edilirse öğenin medya ihtiyacı "Özel tasarım" olur ve bunun için çekim görevi açılır.${recentNote}`,
    } };
  }

  // 8. Yedek yok
  return { proposal: null, reason: `Uygun özgün medya, onaylı işletme bilgisi veya doğrulanmış sosyal kanıt yok; öğe zaten özel tasarım gerektirdiği için yer tutucu da önerilemez.${recentNote}` };
}

type ItemWithPlan = Prisma.ContentPlanItemGetPayload<{ include: { plan: { select: { id: true; businessId: true; status: true; version: true } } } }>;
const planSelect = { id: true, businessId: true, status: true, version: true } as const;

/** Öğe, yedek öneri üretmeye uygun değilse gerekçe döner; uygunsa null. Öneri ve kabul aynı kuralları kullanır. */
function ineligibleReason(item: ItemWithPlan | null): string | null {
  if (!item) return "Plan öğesi bulunamadı.";
  if (item.status !== "ACTIVE") return "Plan öğesi değiştirilmiş; bu öğe artık aktif değil.";
  if (item.plan.status === "SUPERSEDED") return "Bu plan sürümü güncellenmiş; eski sürüm için yedek uygulanamaz.";
  if (item.mediaRequirement === "NO_NEW_MEDIA_REQUIRED") return "Bu öğe yeni medya gerektirmiyor.";
  if (item.mediaAvailability !== "MISSING" || item.mediaAssetId) return "Bu öğenin medyası zaten sağlanmış.";
  return null;
}

const maxSerializationRetries = 3;

/** Prisma'nın P2034'ü ya da pg driver adapter'ın TransactionWriteConflict (SQLSTATE 40001) hatası. */
function isSerializationConflict(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 2) return false;
  const candidate = error as { code?: unknown; kind?: unknown; originalCode?: unknown; cause?: unknown };
  if (String(candidate.code) === "P2034" || candidate.kind === "TransactionWriteConflict" || String(candidate.originalCode) === "40001") return true;
  return isSerializationConflict(candidate.cause, depth + 1);
}

/** Serializable çakışmasında sınırlı sayıda yeniden dener; diğer hatalar olduğu gibi fırlatılır. */
async function withSerializationRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= maxSerializationRetries) throw error;
    }
  }
}

async function loadFallbackInputs(businessId: string, item: ItemWithPlan) {
  const [business, assets, usage, reservedRows, attributes] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, brandProfile: { select: { id: true } } } }),
    prisma.mediaAsset.findMany({ where: { businessId }, select: { id: true, type: true, tags: true, createdAt: true, originalFilename: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    summarizeMediaUsage(businessId),
    prisma.contentPlanItem.findMany({ where: { plan: { businessId, status: { not: "SUPERSEDED" } }, status: "ACTIVE", id: { not: item.id }, mediaAssetId: { not: null } }, select: { mediaAssetId: true } }),
    prisma.businessAttribute.findMany({
      where: { businessId, isCanonical: true, verificationStatus: "CONFIRMED", category: { in: [...informationCategories] } },
      select: { id: true, category: true, key: true, value: true, source: true, confirmedAt: true },
      orderBy: [{ confirmedAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const confirmedFacts: FallbackConfirmedFact[] = attributes
    .filter((attribute): attribute is typeof attribute & { value: string } => typeof attribute.value === "string")
    .map((attribute) => ({ id: attribute.id, category: attribute.category, key: attribute.key, value: attribute.value, source: attribute.source, confirmedAt: attribute.confirmedAt }));
  return {
    assets,
    usage,
    reservedAssetIds: reservedRows.map((row) => row.mediaAssetId).filter((id): id is string => id !== null),
    confirmedFacts,
    // Sistemde doğrulanmış sosyal kanıt kaynağı (yayınlanmış gönderi performansı, platform yorumları) henüz yok;
    // kullanıcı metni veya çıkarım "doğrulanmış" sayılmaz. Kaynak geldiğinde yalnızca burada beslenir.
    verifiedSocialProof: [] as FallbackVerifiedSocialProof[],
    brand: { businessName: business.name, hasBrandProfile: business.brandProfile !== null },
  };
}

/**
 * Yaklaşan, ACTIVE ve medyası MISSING bir plan öğesi için yedek öneri üretir ve kaydeder.
 * Plan öğesine DOKUNMAZ. Aynı içerikli (parmak izi eşit) açık öneri varsa onu döner;
 * farklı içerikli açık öneriler geçersiz kılınır (öğe başına en fazla bir açık öneri).
 * Yedek yoksa proposal null ve reason açıklamadır.
 */
export async function proposeContentFallback(userId: string, planItemId: string, options: { now?: Date; policy?: Partial<FallbackPolicy> } = {}) {
  const item = await prisma.contentPlanItem.findUnique({ where: { id: planItemId }, include: { plan: { select: planSelect } } });
  if (!item) throw new DomainError("Plan öğesi bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, item.plan.businessId);
  const ineligible = ineligibleReason(item);
  if (ineligible) throw new DomainError(ineligible, "CONFLICT");
  const now = options.now ?? new Date();
  const business = await prisma.business.findUniqueOrThrow({ where: { id: item.plan.businessId }, select: { timezone: true } });
  if (item.plannedDate < calendarDayUtc(now, business.timezone)) throw new DomainError("Geçmiş tarihli plan öğesi için yedek öneri üretilmez.", "VALIDATION_ERROR");

  const inputs = await loadFallbackInputs(item.plan.businessId, item);
  const evaluation = evaluateContentFallback({ item: { id: item.id, mediaRequirement: item.mediaRequirement, pillar: item.pillar }, ...inputs, now, policy: options.policy });
  if (!evaluation.proposal) {
    await prisma.contentFallbackProposal.updateMany({ where: { contentPlanItemId: item.id, status: "PROPOSED" }, data: { status: "INVALIDATED", invalidatedAt: now } });
    return { proposal: null, reason: evaluation.reason };
  }
  const draft = evaluation.proposal;
  const fingerprint = hash({ planId: item.planId, planVersion: item.plan.version, itemId: item.id, itemRevision: item.revision, kind: draft.kind, mediaAssetId: draft.mediaAssetId, target: draft.targetMediaRequirement, sources: draft.sources });

  const persist = () => prisma.$transaction(async (tx) => {
    const existing = await tx.contentFallbackProposal.findFirst({ where: { contentPlanItemId: item.id, status: "PROPOSED", fingerprint }, orderBy: { createdAt: "asc" } });
    await tx.contentFallbackProposal.updateMany({
      where: { contentPlanItemId: item.id, status: "PROPOSED", ...(existing ? { id: { not: existing.id } } : {}) },
      data: { status: "INVALIDATED", invalidatedAt: now },
    });
    if (existing) return existing;
    return tx.contentFallbackProposal.create({ data: {
      businessId: item.plan.businessId, planId: item.planId, planVersion: item.plan.version, contentPlanItemId: item.id, itemRevision: item.revision,
      kind: draft.kind, mediaAssetId: draft.mediaAssetId, targetMediaRequirement: draft.targetMediaRequirement, rationale: draft.rationale,
      sources: draft.sources as Prisma.InputJsonValue, fingerprint,
    } });
  }, { isolationLevel: "Serializable" });

  const proposal = await withSerializationRetry(persist);
  return { proposal, reason: evaluation.reason };
}

class StaleProposalError extends Error {}

/**
 * Kabul anında öneriyi mevcut duruma karşı yeniden doğrular. Kiracı, plan sürümü, öğe revizyonu,
 * öğe durumu, medya uygunluğu/yakınlık koruması ve onaylı bilgi kanonikliği kontrol edilir.
 */
async function assertProposalStillValid(tx: Prisma.TransactionClient, proposal: ContentFallbackProposal, item: ItemWithPlan | null, now: Date) {
  const ineligible = ineligibleReason(item);
  if (ineligible) throw new StaleProposalError(ineligible);
  const current = item!;
  if (current.plan.businessId !== proposal.businessId) throw new StaleProposalError("Öneri bu işletmeye ait değil.");
  if (current.planId !== proposal.planId || current.plan.version !== proposal.planVersion) throw new StaleProposalError("Plan sürümü değişmiş; öneri eski sürüm için üretilmişti.");
  if (current.revision !== proposal.itemRevision) throw new StaleProposalError("Plan öğesi yenilenmiş; öneri eski revizyon için üretilmişti.");

  if (isMediaFallbackKind(proposal.kind)) {
    if (!proposal.mediaAssetId) throw new StaleProposalError("Önerilen medya artık mevcut değil.");
    const asset = await tx.mediaAsset.findUnique({ where: { id: proposal.mediaAssetId }, select: { id: true, businessId: true, type: true, tags: true } });
    if (!asset || asset.businessId !== proposal.businessId) throw new StaleProposalError("Önerilen medya artık mevcut değil.");
    const target = proposal.targetMediaRequirement as StockRequirement;
    if (!asset.tags.includes(target) || asset.type !== mediaTypeForRequirement(target)) throw new StaleProposalError("Önerilen medyanın etiketi değişmiş; gereksinimle artık eşleşmiyor.");
    const lastUse = await tx.mediaUsage.aggregate({ where: { mediaAssetId: asset.id }, _max: { usedAt: true } });
    if (lastUse._max.usedAt && lastUse._max.usedAt >= addDaysUtc(now, -defaultFallbackPolicy.reuseProtectionDays)) throw new StaleProposalError("Önerilen medya bu arada kullanıldı; yakınlık koruması içinde.");
    const reservedElsewhere = await tx.contentPlanItem.count({ where: { plan: { businessId: proposal.businessId, status: { not: "SUPERSEDED" } }, status: "ACTIVE", id: { not: current.id }, mediaAssetId: asset.id } });
    if (reservedElsewhere) throw new StaleProposalError("Önerilen medya bu arada başka bir plan öğesine atandı.");
    if (proposal.kind === "FORMAT_ADAPTATION" && (target === current.mediaRequirement || !familyOf(current.mediaRequirement as StockRequirement).includes(target))) throw new StaleProposalError("Format uyarlaması artık geçerli değil.");
    return;
  }

  if (proposal.kind === "CONFIRMED_BUSINESS_INFO") {
    const sources = Array.isArray(proposal.sources) ? (proposal.sources as FallbackSource[]) : [];
    const ids = sources.filter((source) => source.type === "BUSINESS_ATTRIBUTE").map((source) => source.id);
    const stillConfirmed = await tx.businessAttribute.count({ where: { id: { in: ids }, businessId: proposal.businessId, isCanonical: true, verificationStatus: "CONFIRMED" } });
    if (!ids.length || stillConfirmed !== ids.length) throw new StaleProposalError("Önerinin dayandığı onaylı işletme bilgisi değişmiş.");
    return;
  }

  if (proposal.kind === "BRAND_CREATIVE_PLACEHOLDER" && current.mediaRequirement === "CUSTOM_GRAPHIC") throw new StaleProposalError("Öğe zaten özel tasarım gerektiriyor.");
}

/**
 * Kullanıcının açık kabulü. Kiracı denetimli, plan/sürüm güvenli, idempotent (ACCEPTED öneri
 * tekrar kabul edilirse aynı sonuç döner, plan ikinci kez değişmez) ve eşzamanlı yinelenen
 * kabule dayanıklı (PROPOSED->ACCEPTED geçişi tek satırlık koşullu güncellemeyle yarışı kazananı
 * belirler; kaybeden Serializable çakışmasında işlemi yeniden dener, öneriyi ACCEPTED görür ve aynı sonucu döner).
 * Eski, geçersiz kılınmış, değiştirilmiş veya başka sürüme ait hedefler CONFLICT ile reddedilir.
 */
export async function acceptContentFallbackProposal(userId: string, proposalId: string, options: { now?: Date } = {}) {
  const proposal = await prisma.contentFallbackProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new DomainError("Yedek önerisi bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, proposal.businessId);
  if (proposal.status === "ACCEPTED") return proposal;
  if (proposal.status === "INVALIDATED") throw new DomainError("Bu yedek önerisi artık geçerli değil; yeni bir öneri isteyin.", "CONFLICT");
  const now = options.now ?? new Date();

  try {
    return await withSerializationRetry(() => prisma.$transaction(async (tx) => {
      const current = await tx.contentFallbackProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      if (current.status === "ACCEPTED") return current;
      if (current.status === "INVALIDATED") throw new DomainError("Bu yedek önerisi artık geçerli değil; yeni bir öneri isteyin.", "CONFLICT");
      const item = await tx.contentPlanItem.findUnique({ where: { id: current.contentPlanItemId }, include: { plan: { select: planSelect } } });
      await assertProposalStillValid(tx, current, item, now);
      const target = item!;

      const claimed = await tx.contentFallbackProposal.updateMany({ where: { id: current.id, status: "PROPOSED" }, data: { status: "ACCEPTED", acceptedAt: now, acceptedById: userId } });
      if (claimed.count === 0) {
        const winner = await tx.contentFallbackProposal.findUniqueOrThrow({ where: { id: current.id } });
        if (winner.status === "ACCEPTED") return winner;
        throw new DomainError("Bu yedek önerisi artık geçerli değil; yeni bir öneri isteyin.", "CONFLICT");
      }

      if (isMediaFallbackKind(current.kind)) {
        await tx.contentPlanItem.update({ where: { id: target.id }, data: { mediaAssetId: current.mediaAssetId, mediaAvailability: "AVAILABLE", mediaRequirement: current.targetMediaRequirement } });
        await fulfillCaptureRequestsForItems(tx, [target.id], current.mediaAssetId!);
      } else if (current.kind === "BRAND_CREATIVE_PLACEHOLDER") {
        const updated = await tx.contentPlanItem.update({ where: { id: target.id }, data: { mediaRequirement: "CUSTOM_GRAPHIC", mediaAvailability: "MISSING", mediaAssetId: null } });
        await tx.captureRequest.updateMany({ where: { contentPlanItemId: target.id, status: "OPEN" }, data: { status: "DISMISSED", dismissedAt: now, dismissedById: userId } });
        const business = await tx.business.findUniqueOrThrow({ where: { id: current.businessId }, select: { id: true, sector: true, timezone: true } });
        await syncCaptureRequestsForActiveItems(tx, business, [updated]);
      } else {
        await tx.contentPlanItem.update({ where: { id: target.id }, data: { mediaRequirement: "NO_NEW_MEDIA_REQUIRED", mediaAvailability: "NOT_REQUIRED", mediaAssetId: null } });
        await tx.captureRequest.updateMany({ where: { contentPlanItemId: target.id, status: "OPEN" }, data: { status: "DISMISSED", dismissedAt: now, dismissedById: userId } });
      }
      await tx.contentFallbackProposal.updateMany({ where: { contentPlanItemId: target.id, status: "PROPOSED", id: { not: current.id } }, data: { status: "INVALIDATED", invalidatedAt: now } });
      return tx.contentFallbackProposal.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: "Serializable" }));
  } catch (error) {
    if (error instanceof StaleProposalError) {
      await prisma.contentFallbackProposal.updateMany({ where: { id: proposal.id, status: "PROPOSED" }, data: { status: "INVALIDATED", invalidatedAt: now } });
      throw new DomainError(error.message, "CONFLICT");
    }
    throw error;
  }
}

/** Seçili planın ACTIVE öğeleri için açık (PROPOSED) öneriler; öğe başına en yeni. UI için üyelik denetimlidir. */
export async function listContentFallbackProposals(userId: string, planId: string) {
  const plan = await prisma.contentPlan.findUnique({ where: { id: planId }, select: { businessId: true } });
  if (!plan) throw new DomainError("İçerik planı bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, plan.businessId);
  const proposals = await prisma.contentFallbackProposal.findMany({
    where: { planId, businessId: plan.businessId, status: "PROPOSED", contentPlanItem: { status: "ACTIVE", mediaAvailability: "MISSING" } },
    include: { mediaAsset: { select: { originalFilename: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const byItem = new Map<string, (typeof proposals)[number]>();
  for (const proposal of proposals) if (!byItem.has(proposal.contentPlanItemId)) byItem.set(proposal.contentPlanItemId, proposal);
  return byItem;
}
