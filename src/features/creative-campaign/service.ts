import "server-only";

import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { getActivePlatformRules } from "@/features/platform-intelligence/service";
import { brandPaletteFor, type BrandPalette } from "@/features/brand-style/palette";
import { deriveBrandVisualStyleProfile } from "@/features/brand-style/profile";
import { maxOutputBytes, supportedSourceFormats, withConflictRetry } from "@/features/safe-enhance/service";
import { findFormatTarget, resolveFormatTargets, type FormatTarget } from "@/features/social-variant/formats";
import { creativeCanvasFor } from "@/features/social-variant/plan";
import type { SocialVariantFormat } from "@/features/social-variant/schemas";
import { getCreativeRenderProvider, type CreativeRenderProvider } from "./providers";
import {
  buildCreativeCopy,
  creativeCategoryDefinitions,
  factRefValue,
  selectFactsForCategory,
  toFactRefs,
  type CandidateFact,
} from "./categories";
import {
  CREATIVE_CAMPAIGN_VERSION,
  creativeBrandSnapshotSchema,
  creativeCategories,
  creativeCopySchema,
  creativeFactRefSchema,
  providerOutputSchema,
  type CreativeBrandSnapshot,
  type CreativeCategory,
  type CreativeCopy,
  type CreativeFactRef,
} from "./schemas";
import {
  assertAuthenticBackground,
  assertCategoryAllowed,
  assertClaimsAllowed,
  assertCopyTracesToConfirmedFacts,
  assertHumanAcceptance,
  assertNoSyntheticProductSubstitution,
  assertProviderAllowed,
  categoryBlockedReason,
  resolveCreativeSectorPolicy,
  sectorPolicyAllowsCategory,
  type CreativeSectorPolicy,
} from "./sector-policy";

// P5-04 Kreatif Kampanya. Sosyal Varyant'tan tamamen ayrı bir akıştır: burada üretilen şey TASARIMDIR
// ve hiçbir yerde gerçek ürün/ekip/mekân fotoğrafı gibi sunulmaz. Kalıcı durumda (ayrı tablo, ayrı
// MediaAsset kökeni) ve arayüzde bu ayrım korunur.
//
// Olgu politikası: metin yalnızca KANONİK ve ONAYLI Business Brain bilgilerinden kurulur. Bilgi
// eksikse kreatif ÜRETİLMEZ; kullanıcıya hangi bilginin eksik olduğu söylenir. Bu akış Business
// Brain'e hiçbir koşulda yazmaz.
//
// Değişmezlik: factRefs/copy/brandSnapshot/ruleSnapshot birer anlık görüntüdür. Bilgi, kural, metin
// veya marka tercihi sonradan değişse de üretilmiş çıktı ve kaydı olduğu gibi kalır.
//
// Sektör politikası (bkz. `sector-policy.ts`) `Business.sector` alanından deterministik olarak
// çözülür ve hem oluşturma hem saklama yolunda aynı sırayla uygulanır:
//   ÖZGÜNLÜK > ONAYLI BİLGİ > SEKTÖR POLİTİKASI > MARKA STİLİ > KREATİF SERBESTLİK
// Politika kayda yazılmaz; karar anında yeniden çözülür, böylece sektör sonradan değiştiğinde daha
// dar bir politika saklamayı durdurur ama üretilmiş kayıt ve çıktı hiç değişmez.

export type CreateCreativeCampaignOptions = {
  provider?: CreativeRenderProvider;
  skipRateLimit?: boolean;
};

export type KeepCreativeCampaignOptions = {
  /** Politika açık kabul istiyorsa kullanıcının beyanı; politika anahtarına birebir eşit olmalıdır. */
  policyAcceptance?: string | null;
};

const maxCreativesPerHour = 20;

/** Kreatife arka plan olabilecek medya kökenleri: kabul edilmiş gerçek medya ve teknik türevleri. */
const backgroundOrigins = new Set(["UPLOAD", "SAFE_ENHANCE", "BRAND_STYLE", "SOCIAL_VARIANT"]);

/** Tasarım çıktısı yalnızca bu planlama etiketini alabilir: özgün fotoğraf/video kanıtı yerine geçemez. */
export const creativeOutputTags = ["CUSTOM_GRAPHIC"] as const;

function parseCategory(value: string): CreativeCategory {
  const category = creativeCategories.find((entry) => entry === value);
  if (!category) throw new DomainError("Geçersiz kreatif türü.", "VALIDATION_ERROR");
  return category;
}

async function requireCampaign(userId: string, campaignId: string) {
  const campaign = await prisma.mediaCreativeCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new DomainError("Kreatif bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, campaign.businessId);
  return campaign;
}

async function failAttempt(id: string, status: "FAILED" | "INVALID_OUTPUT", errorCode: string) {
  await prisma.mediaCreativeCampaign.updateMany({ where: { id, status: "PENDING" }, data: { status, errorCode, completedAt: new Date() } });
  return prisma.mediaCreativeCampaign.findUnique({ where: { id } });
}

const outputExtensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };
const outputFormats: Record<string, string> = { "image/png": "png", "image/jpeg": "jpeg" };

function creativeFilename(businessName: string, category: CreativeCategory, version: number, extension: string) {
  const base = businessName.toLocaleLowerCase("tr").replace(/[^a-z0-9ğüşıöç]+/gi, "-").replace(/^-+|-+$/g, "") || "kreatif";
  // Kategori bir makine tanımlayıcısıdır: Türkçe yerele göre küçültülürse "I" harfi "ı" olur ve
  // dosya adı bozulur. İşletme adı Türkçe metin olduğu için yerel küçültme orada kalır.
  return `${base}-${category.toLowerCase().replaceAll("_", "-")}-tasarim-s${version}.${extension}`.slice(0, 255);
}

/**
 * Kanonik ve ONAYLI bilgiler. Bu sorgu kreatif akışının TEK olgu kaynağıdır; INFERRED,
 * NEEDS_CONFIRMATION, REJECTED ve kanonik olmayan satırlar hiçbir koşulda okunmaz.
 */
async function readConfirmedFacts(businessId: string): Promise<CandidateFact[]> {
  const rows = await prisma.businessAttribute.findMany({
    where: { businessId, isCanonical: true, verificationStatus: "CONFIRMED" },
    select: { id: true, category: true, key: true, value: true, source: true, confirmedAt: true },
    orderBy: [{ confirmedAt: "asc" }, { id: "asc" }],
  });
  return rows
    .filter((row): row is typeof row & { value: string } => typeof row.value === "string" && row.value.trim().length > 0)
    .map((row) => ({ id: row.id, category: row.category, key: row.key, value: row.value, source: row.source, confirmedAt: row.confirmedAt }));
}

/** Sektör politikası: karar anında `Business.sector` alanından deterministik olarak çözülür. */
async function readSectorPolicy(businessId: string): Promise<CreativeSectorPolicy> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { sector: true } });
  if (!business) throw new DomainError("İşletme bulunamadı.", "NOT_FOUND");
  return resolveCreativeSectorPolicy(business.sector);
}

export const staleFactMessage = "Tasarımdaki bilgilerden biri artık onaylı değil ya da değişti; bu tasarım saklanamaz. Yeni bilgiyle yeni bir tasarım hazırlayabilirsiniz.";

/**
 * ONAYLI BİLGİ katmanının karar anındaki ayağı: kayıttaki her olgu referansı, HÂLÂ kanonik ve
 * CONFIRMED olan aynı satıra ve aynı değere karşılık geliyor mu. Sorgu `businessId` ile bağlıdır ve
 * saklama işleminin İÇİNDE çalışır; böylece bilgi karar ile yazma arasında geri çekilirse ya da
 * değiştirilirse tasarım saklanmaz. Üretilmiş kayıt ve çıktı baytları bu redde rağmen değişmez.
 */
async function assertFactRefsStillConfirmed(tx: Prisma.TransactionClient, businessId: string, factRefs: readonly CreativeFactRef[]) {
  const rows = await tx.businessAttribute.findMany({
    where: {
      businessId,
      id: { in: factRefs.map((ref) => ref.attributeId) },
      isCanonical: true,
      verificationStatus: "CONFIRMED",
    },
    select: { id: true, value: true },
  });
  const current = new Map(rows.map((row) => [row.id, row.value]));
  for (const ref of factRefs) {
    const value = current.get(ref.attributeId);
    if (typeof value !== "string" || factRefValue(value) !== ref.value) {
      throw new DomainError(staleFactMessage, "VALIDATION_ERROR");
    }
  }
}

/** Kayda geçmiş anlık görüntüyü sözleşmeye göre okur; uyumsuz kayıt null döner, ham yük sızmaz. */
function readStoredCopy(value: unknown): CreativeCopy | null {
  const parsed = creativeCopySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readStoredFactRefs(value: unknown): CreativeFactRef[] {
  if (!Array.isArray(value)) return [];
  const refs: CreativeFactRef[] = [];
  for (const entry of value) {
    const parsed = creativeFactRefSchema.safeParse(entry);
    if (parsed.success) refs.push(parsed.data);
  }
  return refs;
}

async function readBrandSnapshot(businessId: string): Promise<{ snapshot: CreativeBrandSnapshot; palette: BrandPalette; profileId: string | null; profileUpdatedAt: Date | null; businessName: string }> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, brandProfile: { select: { id: true, updatedAt: true, toneDimensions: true } } },
  });
  if (!business) throw new DomainError("İşletme bulunamadı.", "NOT_FOUND");
  const profile = deriveBrandVisualStyleProfile(business.brandProfile ?? null);
  const palette = brandPaletteFor(profile);
  return {
    palette,
    profileId: business.brandProfile?.id ?? null,
    profileUpdatedAt: business.brandProfile?.updatedAt ?? null,
    businessName: business.name,
    snapshot: creativeBrandSnapshotSchema.parse({
      palette,
      businessName: business.name,
      profileVersion: profile.profileVersion,
      profileAvailable: profile.state !== "MISSING",
    }),
  };
}

export type CreativeCategoryOption = {
  category: CreativeCategory;
  label: string;
  description: string;
  /** Onaylı bilgi var mı ve sektör politikası bu türü açık bırakıyor mu. */
  available: boolean;
  /** Hangi bilginin eksik olduğu; hazırlanabilir kategorilerde null. */
  missingReason: string | null;
  /** Sektör politikası bu türü kapattıysa tam gerekçe; aksi hâlde null. */
  blockedReason: string | null;
  /** Tasarıma basılacak onaylı bilgi metinleri (önizleme). */
  factPreview: string[];
};

/**
 * Tür listesi iki kapıdan geçer: onaylı bilgi (üst katman) ve sektör politikası (alt katman).
 * Politika kapattığı bir türde bilgi önizlemesi de göstermez; o türden bir tasarım hiç hazırlanmaz.
 */
function categoryOptions(facts: CandidateFact[], policy: CreativeSectorPolicy): CreativeCategoryOption[] {
  return creativeCategories.map((category) => {
    const definition = creativeCategoryDefinitions[category];
    const allowed = sectorPolicyAllowsCategory(policy, category);
    const selected = allowed ? selectFactsForCategory(category, facts) : [];
    return {
      category,
      label: definition.label,
      description: definition.description,
      available: allowed && selected.length > 0,
      missingReason: !allowed || selected.length ? null : definition.missingReason,
      blockedReason: allowed ? null : categoryBlockedReason(policy, category),
      factPreview: selected.map((fact) => fact.value),
    };
  });
}

async function resolveBackground(userId: string, businessId: string, sourceAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: sourceAssetId } });
  if (!asset) throw new DomainError("Seçilen medya bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, asset.businessId);
  if (asset.businessId !== businessId) throw new DomainError("Seçilen medya bu işletmeye ait değil.", "FORBIDDEN");
  if (asset.type !== "IMAGE" || !supportedSourceFormats.has(asset.mimeType)) {
    throw new DomainError("Kreatif arka planı olarak yalnızca desteklenen fotoğraf biçimleri kullanılabilir.", "VALIDATION_ERROR");
  }
  if (!backgroundOrigins.has(asset.origin)) throw new DomainError("Bu görsel kreatif arka planı olarak kullanılamaz.", "VALIDATION_ERROR");

  // Kök soy: zincirin en başındaki yüklenen orijinal. Kreatif gerçek medya kullandığında bu iz açık kalır.
  let rootId: string | null = asset.origin === "UPLOAD" ? asset.id : asset.derivedFromId;
  for (let step = 0; step < 4 && rootId && rootId !== asset.id; step++) {
    const parent: { id: string; origin: string; derivedFromId: string | null } | null = await prisma.mediaAsset.findUnique({
      where: { id: rootId },
      select: { id: true, origin: true, derivedFromId: true },
    });
    if (!parent) break;
    if (parent.origin === "UPLOAD" || !parent.derivedFromId) {
      rootId = parent.id;
      break;
    }
    rootId = parent.derivedFromId;
  }
  return { asset, rootAssetId: rootId };
}

export async function createCreativeCampaign(
  userId: string,
  businessId: string,
  rawCategory: string,
  rawPlatform: string,
  rawFormat: string,
  options: CreateCreativeCampaignOptions & { sourceAssetId?: string | null } = {},
) {
  await requireMembership(userId, businessId);
  const category = parseCategory(rawCategory);

  const target = findFormatTarget(resolveFormatTargets(await getActivePlatformRules(userId, businessId)), rawPlatform, rawFormat);
  if (!target) throw new DomainError("Bu platform ve format için tanımlı bir oran kuralı yok; kreatif hazırlanmadı.", "VALIDATION_ERROR");

  if (!options.skipRateLimit) {
    const recent = await prisma.mediaCreativeCampaign.count({
      where: { businessId, triggeredById: userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= maxCreativesPerHour) throw new DomainError(`Bir saat içinde en fazla ${maxCreativesPerHour} kreatif hazırlayabilirsiniz.`, "VALIDATION_ERROR");
  }

  // Kapılar öncelik sırasına göre açılır: ÖZGÜNLÜK > ONAYLI BİLGİ > SEKTÖR POLİTİKASI > MARKA STİLİ
  // > KREATİF SERBESTLİK. Üst katman reddettiğinde alttaki hiç değerlendirilmez.
  const policy = await readSectorPolicy(businessId);
  const provider = options.provider ?? getCreativeRenderProvider();

  // 1) ÖZGÜNLÜK: arka plan yalnızca kabul edilmiş gerçek medya olabilir, izi çözülebilmelidir ve
  // bu sektörde üretken bir sağlayıcı kullanılamıyorsa sentetik görsel üretilmez.
  const background = options.sourceAssetId ? await resolveBackground(userId, businessId, options.sourceAssetId) : null;
  assertAuthenticBackground(policy, background);
  assertProviderAllowed(policy, provider);

  // 2) ONAYLI BİLGİ: onaylı bilgi yoksa burada durulur ve eksik bilgi açıkça söylenir. Hiçbir metin uydurulmaz.
  const facts = selectFactsForCategory(category, await readConfirmedFacts(businessId));
  if (!facts.length) throw new DomainError(creativeCategoryDefinitions[category].missingReason, "VALIDATION_ERROR");

  // 3) SEKTÖR POLİTİKASI: tür bu sektörde açık mı ve yasaklı bir iddia var mı. Bilgi ONAYLI olsa bile
  // yasaklı iddia geçmez; onay, iddianın Ainetra için doğrulanabilir olduğu anlamına gelmez.
  assertCategoryAllowed(policy, category);
  assertClaimsAllowed(policy, facts.map((fact) => fact.value));

  // 4) MARKA STİLİ: renk ve ad yalnızca üst katmanların izin verdiği metnin üstüne uygulanır.
  const brand = await readBrandSnapshot(businessId);

  // 5) KREATİF SERBESTLİK: yok. Metin yalnızca olgulardan kurulur ve her satırın karşılığı doğrulanır.
  const copy = buildCreativeCopy(brand.businessName, facts);
  const factRefs = toFactRefs(facts);
  assertCopyTracesToConfirmedFacts(copy, factRefs);
  const canvas = creativeCanvasFor(target.targetRatio);

  // 1) Aktif işi talep et ya da yeni sürüm aç. Eşzamanlı aynı istek burada mevcut denemeye düşer.
  const claim = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const active = await tx.mediaCreativeCampaign.findFirst({
      where: {
        businessId, category, platform: target.platform, format: target.format, sourceAssetId: background?.asset.id ?? null,
        OR: [{ status: "PENDING" }, { status: "SUCCEEDED", decision: null }],
      },
      orderBy: { version: "desc" },
    });
    if (active) return { created: false as const, campaign: active };
    const latest = await tx.mediaCreativeCampaign.findFirst({ where: { businessId }, orderBy: { version: "desc" }, select: { version: true } });
    const campaign = await tx.mediaCreativeCampaign.create({
      data: {
        businessId,
        version: (latest?.version ?? 0) + 1,
        category,
        provider: provider.provider,
        model: provider.model,
        provenance: provider.provenance,
        creativeVersion: CREATIVE_CAMPAIGN_VERSION,
        platform: target.platform,
        contentType: target.contentType,
        format: target.format,
        ruleId: target.ruleId,
        ruleKey: target.ruleKey,
        ruleEffectiveFrom: target.ruleEffectiveFrom,
        ruleSnapshot: target.snapshot as unknown as Prisma.InputJsonValue,
        targetAspectRatio: target.targetAspectRatio,
        factRefs: factRefs as unknown as Prisma.InputJsonValue,
        copy: copy as unknown as Prisma.InputJsonValue,
        brandProfileId: brand.profileId,
        brandProfileUpdatedAt: brand.profileUpdatedAt,
        brandSnapshot: brand.snapshot as unknown as Prisma.InputJsonValue,
        sourceAssetId: background?.asset.id ?? null,
        rootAssetId: background?.rootAssetId ?? null,
        triggeredById: userId,
      },
    });
    return { created: true as const, campaign };
  }, { isolationLevel: "Serializable" }));
  if (!claim.created) return claim.campaign;
  const attempt = claim.campaign;

  // 2) Sağlayıcı çağrısı işlem dışında; hata yalnızca deneme kaydını işaretler, kaynağa dokunmaz.
  let backgroundBytes: { bytes: Uint8Array; mimeType: string } | null = null;
  if (background) {
    const object = await storage.get(background.asset.storageKey);
    if (!object) return failAttempt(attempt.id, "FAILED", "MEDIA_BYTES_MISSING");
    backgroundBytes = { bytes: object.bytes, mimeType: background.asset.mimeType };
  }
  let rawOutput: unknown;
  try {
    rawOutput = await provider.render({ copy, palette: brand.palette, canvas, background: backgroundBytes });
  } catch {
    return failAttempt(attempt.id, "FAILED", "PROVIDER_FAILED");
  }
  const parsedOutput = providerOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) return failAttempt(attempt.id, "INVALID_OUTPUT", "SCHEMA_VALIDATION_FAILED");
  const { bytes, mimeType } = parsedOutput.data;
  if (bytes.byteLength > maxOutputBytes()) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_TOO_LARGE");

  // 3) Çıktıyı çöz ve istenen tuvalle karşılaştır. Beyan edilen dosya türü içerikle uyuşmalıdır.
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_NOT_DECODABLE");
  }
  if (metadata.format !== outputFormats[mimeType]) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_FORMAT_MISMATCH");
  if (metadata.width !== canvas.width || metadata.height !== canvas.height) return failAttempt(attempt.id, "INVALID_OUTPUT", "OUTPUT_DIMENSIONS_UNEXPECTED");

  // 4) Ayrı anahtara yaz, sonra kaydı tamamla. Kaynak medyanın anahtarı asla üzerine yazılmaz.
  const outputStorageKey = `${businessId}/creative-campaign/${randomUUID()}.${outputExtensions[mimeType]}`;
  try {
    await storage.put({ key: outputStorageKey, bytes, contentType: mimeType });
  } catch {
    await storage.delete(outputStorageKey).catch(() => {});
    return failAttempt(attempt.id, "FAILED", "STORAGE_FAILED");
  }
  let completed: { count: number };
  try {
    completed = await prisma.mediaCreativeCampaign.updateMany({
      where: { id: attempt.id, status: "PENDING" },
      data: {
        status: "SUCCEEDED",
        outputStorageKey,
        outputMimeType: mimeType,
        outputSize: bytes.byteLength,
        outputWidth: metadata.width,
        outputHeight: metadata.height,
        completedAt: new Date(),
      },
    });
  } catch (persistError) {
    let recovered: Awaited<ReturnType<typeof failAttempt>>;
    try {
      recovered = await failAttempt(attempt.id, "FAILED", "COMPLETION_PERSIST_FAILED");
    } catch {
      throw persistError;
    }
    if (recovered?.outputStorageKey !== outputStorageKey) await storage.delete(outputStorageKey).catch(() => {});
    return recovered;
  }
  if (!completed.count) await storage.delete(outputStorageKey).catch(() => {});
  return prisma.mediaCreativeCampaign.findUnique({ where: { id: attempt.id } });
}

/**
 * "Sakla": tasarımı ayrı bir MediaAsset yapar. Köken CREATIVE_CAMPAIGN'dir ve etiket yalnızca
 * CUSTOM_GRAPHIC olabilir; bu yüzden gerçek fotoğraf/video kanıtı isteyen bir medya gereksinimini
 * karşılayamaz. Kullanılan gerçek medya varsa soy açıkça bağlanır ama çıktı yine tasarımdır.
 *
 * Bu adım aynı zamanda politikanın ZORUNLU insan incelemesidir. Politika oluşturma anına
 * hapsedilmez: karar anında yeniden çözülür, bu yüzden sektör sonradan daralmışsa (ör. işletme
 * sağlık olarak güncellenmişse) eski bir tasarım saklanamaz. Sağlık politikasında ayrıca açık bir
 * kabul beyanı istenir; beyan gelmezse hiçbir medya varlığı oluşmaz.
 *
 * Bu yeniden sınama tamamen işlemin İÇİNDEDİR (güncel sektör, tür, yasaklı iddia ve olguların
 * kendisi). Aksi hâlde sınama ile yazma arasında kalan boşlukta bilgi geri çekilebilir, değişebilir
 * ya da sektör daralabilir ve tasarım yine de saklanabilirdi. Red hâlinde MediaAsset oluşmaz;
 * üretilmiş kayıt ve çıktı baytları hiç değişmez, zaten KEPT olan bir karar ise idempotent döner.
 */
export async function keepCreativeCampaign(userId: string, campaignId: string, options: KeepCreativeCampaignOptions = {}) {
  const campaign = await requireCampaign(userId, campaignId);
  if (campaign.status === "PENDING") throw new DomainError("Kreatif hâlâ hazırlanıyor.", "CONFLICT");
  if (campaign.status !== "SUCCEEDED" || !campaign.outputStorageKey) throw new DomainError("Bu deneme için saklanabilir bir sonuç yok.", "CONFLICT");
  if (campaign.decision === "DISCARDED") throw new DomainError("Bu sonuç zaten atıldı.", "CONFLICT");

  return withConflictRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.mediaCreativeCampaign.findUnique({
      where: { id: campaign.id },
      include: { business: { select: { name: true, sector: true } } },
    });
    if (!current) throw new DomainError("Kreatif bu sırada silindi.", "NOT_FOUND");
    // Verilmiş karar yeniden sınanmaz: "Sakla" idempotenttir, ikinci çağrı aynı kaydı döner.
    if (current.decision === "KEPT") return current;
    if (current.decision) throw new DomainError("Bu sonuç zaten atıldı.", "CONFLICT");
    if (current.status !== "SUCCEEDED" || !current.outputStorageKey || !current.outputMimeType || current.outputSize === null) {
      throw new DomainError("Bu deneme için saklanabilir bir sonuç yok.", "CONFLICT");
    }

    // Saklama yolu da aynı öncelik sırasını uygular; oluşturmada geçen bir kayıt burada, yazmayla
    // aynı işlemin içinde ve güncel duruma göre yeniden sınanır.
    const policy = resolveCreativeSectorPolicy(current.business.sector);
    const storedCopy = readStoredCopy(current.copy);
    if (!storedCopy) throw new DomainError("Tasarımın metin kaydı okunamadı; bu sonuç saklanamaz.", "CONFLICT");
    const factRefs = readStoredFactRefs(current.factRefs);
    // ONAYLI BİLGİ: kayıttaki her satırın olgu karşılığı duruyor mu ve o olgular hâlâ kanonik ve
    // ONAYLI mı, değerleri değişmiş mi.
    assertCopyTracesToConfirmedFacts(storedCopy, factRefs);
    await assertFactRefsStillConfirmed(tx, current.businessId, factRefs);
    // SEKTÖR POLİTİKASI: karar anındaki politika bu türü ve bu iddiaları kabul ediyor mu.
    assertCategoryAllowed(policy, current.category);
    assertClaimsAllowed(policy, storedCopy.lines);
    assertHumanAcceptance(policy, options.policyAcceptance);

    const extension = outputExtensions[current.outputMimeType] ?? "png";
    const outputAsset = await tx.mediaAsset.create({
      data: {
        businessId: current.businessId,
        type: "IMAGE",
        origin: "CREATIVE_CAMPAIGN",
        derivedFromId: current.sourceAssetId,
        originalFilename: creativeFilename(current.business.name, current.category, current.version, extension),
        mimeType: current.outputMimeType,
        size: current.outputSize,
        width: current.outputWidth,
        height: current.outputHeight,
        storageKey: current.outputStorageKey,
        tags: [...creativeOutputTags],
      },
    });
    // ÖZGÜNLÜK: hiçbir sektörde tasarım çıktısı gerçek fotoğraf kanıtının yerine geçmez. Bu denetim
    // işlem içindedir; geçmezse varlık oluşmaz ve karar yazılmaz.
    assertNoSyntheticProductSubstitution(outputAsset);
    return tx.mediaCreativeCampaign.update({
      where: { id: current.id },
      data: { decision: "KEPT", decidedById: userId, decidedAt: new Date(), outputAssetId: outputAsset.id },
    });
  }, { isolationLevel: "Serializable" }));
}

/** "At": yalnızca bu tasarımın baytları ve anahtarı düşer. Kullanılan gerçek medya korunur. */
export async function discardCreativeCampaign(userId: string, campaignId: string) {
  const campaign = await requireCampaign(userId, campaignId);
  if (campaign.status === "PENDING") throw new DomainError("Kreatif hâlâ hazırlanıyor.", "CONFLICT");
  if (campaign.decision === "KEPT") throw new DomainError("Saklanan bir kreatif buradan atılamaz; medya kütüphanesinden silebilirsiniz.", "CONFLICT");

  const outcome = await withConflictRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.mediaCreativeCampaign.findUnique({ where: { id: campaign.id } });
    if (!current) throw new DomainError("Kreatif bu sırada silindi.", "NOT_FOUND");
    if (current.decision === "DISCARDED") return { campaign: current, discardedKey: current.outputStorageKey };
    if (current.decision) throw new DomainError("Saklanan bir kreatif buradan atılamaz; medya kütüphanesinden silebilirsiniz.", "CONFLICT");
    const updated = await tx.mediaCreativeCampaign.update({
      where: { id: current.id },
      data: { decision: "DISCARDED", decidedById: userId, decidedAt: new Date() },
    });
    return { campaign: updated, discardedKey: updated.outputStorageKey };
  }, { isolationLevel: "Serializable" }));
  if (!outcome.discardedKey) return outcome.campaign;

  await storage.delete(outcome.discardedKey);
  await prisma.mediaCreativeCampaign.updateMany({
    where: { id: campaign.id, decision: "DISCARDED", outputStorageKey: outcome.discardedKey },
    data: { outputStorageKey: null },
  });
  return (await prisma.mediaCreativeCampaign.findUnique({ where: { id: campaign.id } })) ?? { ...outcome.campaign, outputStorageKey: null };
}

const reviewSelect = {
  id: true, version: true, category: true, status: true, decision: true, provider: true, provenance: true, creativeVersion: true,
  platform: true, contentType: true, format: true, ruleKey: true, targetAspectRatio: true, factRefs: true, copy: true,
  outputStorageKey: true, outputWidth: true, outputHeight: true, outputSize: true, outputAssetId: true, sourceAssetId: true,
  rootAssetId: true, errorCode: true, createdAt: true, completedAt: true, decidedAt: true,
} satisfies Prisma.MediaCreativeCampaignSelect;

type ReviewRow = Prisma.MediaCreativeCampaignGetPayload<{ select: typeof reviewSelect }>;

export type CreativeCampaignReviewItem = Omit<ReviewRow, "outputStorageKey" | "factRefs" | "copy"> & {
  outputAvailable: boolean;
  /** Kayıttaki anlık görüntüden okunan metin; bilgi sonradan değişse de bu satır aynı kalır. */
  copy: CreativeCopy | null;
  factRefs: CreativeFactRef[];
};

function toReviewItem(row: ReviewRow): CreativeCampaignReviewItem {
  const { outputStorageKey, copy, factRefs, ...rest } = row;
  return {
    ...rest,
    outputAvailable: Boolean(outputStorageKey) && rest.decision !== "DISCARDED",
    copy: copy && typeof copy === "object" && !Array.isArray(copy) ? copy as unknown as CreativeCopy : null,
    factRefs: Array.isArray(factRefs) ? factRefs as unknown as CreativeFactRef[] : [],
  };
}

export type CreativeFormatChoice = {
  platform: FormatTarget["platform"];
  format: SocialVariantFormat;
  targetAspectRatio: string;
  ruleKey: string;
  recommendationType: FormatTarget["snapshot"]["recommendationType"];
  outputWidth: number;
  outputHeight: number;
};

/** "Bunu nerede kullanacaksınız?" + "Ne hazırlayalım?" ekranı. Yalnızca gerçek bağlamın izin verdiği seçenekler. */
export async function getCreativeCampaignWorkspace(userId: string, businessId: string) {
  await requireMembership(userId, businessId);
  const [rules, facts, brand, policy, rows, backgroundAssets] = await Promise.all([
    getActivePlatformRules(userId, businessId),
    readConfirmedFacts(businessId),
    readBrandSnapshot(businessId),
    readSectorPolicy(businessId),
    prisma.mediaCreativeCampaign.findMany({ where: { businessId }, select: reviewSelect, orderBy: { version: "desc" } }),
    prisma.mediaAsset.findMany({
      where: { businessId, type: "IMAGE", origin: { in: ["UPLOAD", "SAFE_ENHANCE", "BRAND_STYLE", "SOCIAL_VARIANT"] } },
      select: { id: true, originalFilename: true, origin: true, mimeType: true },
      orderBy: { createdAt: "desc" },
      take: 24,
    }),
  ]);
  const formats: CreativeFormatChoice[] = resolveFormatTargets(rules).map((target) => {
    const canvas = creativeCanvasFor(target.targetRatio);
    return {
      platform: target.platform,
      format: target.format,
      targetAspectRatio: target.targetAspectRatio,
      ruleKey: target.ruleKey,
      recommendationType: target.snapshot.recommendationType,
      outputWidth: canvas.width,
      outputHeight: canvas.height,
    };
  });
  return {
    businessId,
    businessName: brand.businessName,
    brand: brand.snapshot,
    formats,
    /** Uygulanan sektör politikası; ekranda hangi kuralın geçerli olduğu açıkça yazar. */
    policy: {
      key: policy.key,
      label: policy.label,
      summary: policy.summary,
      sectorRecognized: policy.sectorRecognized,
      requiresExplicitAcceptance: policy.requiresExplicitAcceptance,
      authenticityStrictness: policy.authenticityStrictness,
      restrictedClaims: policy.restrictedClaims,
    },
    categories: categoryOptions(facts, policy),
    backgrounds: backgroundAssets.filter((asset) => supportedSourceFormats.has(asset.mimeType)),
    awaitingReview: rows.filter((row) => row.status === "SUCCEEDED" && row.decision === null).map(toReviewItem),
    kept: rows.filter((row) => row.decision === "KEPT").map(toReviewItem),
    history: rows.map(toReviewItem),
    pending: rows.some((row) => row.status === "PENDING"),
    latestFailure: (() => {
      const latest = rows[0] ?? null;
      return latest && (latest.status === "FAILED" || latest.status === "INVALID_OUTPUT") && latest.decision === null
        ? { version: latest.version, status: latest.status, errorCode: latest.errorCode }
        : null;
    })(),
  };
}

/** Karar öncesi önizleme için çıktı baytları. Üyelik sorgunun içinde denetlenir. */
export async function readCreativeCampaignOutput(userId: string, campaignId: string) {
  const campaign = await prisma.mediaCreativeCampaign.findFirst({
    where: { id: campaignId, business: { memberships: { some: { userId } } } },
    select: { outputStorageKey: true, outputMimeType: true, outputSize: true, decision: true },
  });
  if (!campaign?.outputStorageKey || !campaign.outputMimeType || campaign.decision === "DISCARDED") return null;
  const object = await storage.get(campaign.outputStorageKey);
  if (!object) return null;
  return { bytes: object.bytes, mimeType: campaign.outputMimeType, size: campaign.outputSize ?? object.bytes.byteLength };
}
