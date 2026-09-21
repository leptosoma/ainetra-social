import "server-only";

import type { Prisma } from "../../../generated/prisma/client";
import type { CaptureRequestStatus, ContentType, MediaRequirement, MediaType } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { requireMembership } from "@/lib/authorization";
import { calendarDayUtc } from "@/features/content-stock/service";

// Phase 4 B1 kapsamı: yalnızca Capture Engine (CaptureRequest yaşam döngüsü) ve
// bunu Content Planning / Media servislerine bağlayan entegrasyon noktaları.
// MediaUsage KAYDI, Content Stock ve Fallback Engine bilinçli olarak B2'ye bırakıldı
// (tablo şeması hazır, henüz yazan bir servis yok).

type PlanItemForCapture = {
  id: string;
  mediaRequirement: MediaRequirement;
  mediaAvailability: string;
  plannedDate: Date;
  contentType: ContentType;
};

type BusinessForCapture = { id: string; sector: string; timezone: string };

type Sector = "RESTAURANT" | "CAFE" | "BAR" | "GENERIC";

function sectorBucket(sector: string): Sector {
  const value = sector.trim().toUpperCase();
  if (value === "RESTAURANT" || value === "CAFE" || value === "BAR") return value;
  return "GENERIC";
}

const contentTypeShortLabel: Record<ContentType, string> = { POST: "Post", REEL: "Reel", STORY: "Story", CAROUSEL: "Carousel" };

const weekdayTr: Record<string, string> = {
  Sunday: "Pazar", Monday: "Pazartesi", Tuesday: "Salı", Wednesday: "Çarşamba",
  Thursday: "Perşembe", Friday: "Cuma", Saturday: "Cumartesi",
};

type CaptureRequirement = Exclude<MediaRequirement, "NO_NEW_MEDIA_REQUIRED">;

const subtitleByRequirement: Record<CaptureRequirement, Partial<Record<Sector, string>> & { GENERIC: string }> = {
  PHOTO_PRODUCT: { RESTAURANT: "Yemek fotoğrafı", CAFE: "Ürün fotoğrafı", BAR: "İçecek fotoğrafı", GENERIC: "Ürün fotoğrafı" },
  PHOTO_ATMOSPHERE: { GENERIC: "Mekân atmosferi fotoğrafı" },
  PHOTO_PEOPLE: { GENERIC: "Ekip fotoğrafı" },
  VIDEO_VERTICAL: { GENERIC: "Kısa dikey video" },
  VIDEO_KITCHEN: { GENERIC: "Hazırlık videosu" },
  CUSTOM_GRAPHIC: { GENERIC: "Özel görsel tasarım" },
};

const instructionByRequirement: Record<CaptureRequirement, Partial<Record<Sector, string>> & { GENERIC: string }> = {
  PHOTO_PRODUCT: {
    RESTAURANT: "Ürünü doğal ışıkta, mümkünse masadaki gereksiz objeleri kaldırarak yakın plandan çek.",
    CAFE: "Ürünü doğal ışıkta, mümkünse masadaki gereksiz objeleri kaldırarak yakın plandan çek.",
    BAR: "İçeceği doğal ışıkta, bar tezgahındaki gereksiz objeleri kaldırarak yakın plandan çek.",
    GENERIC: "Ürünü doğal ışıkta, dikkat dağıtıcı objeleri kaldırarak yakın plandan çek.",
  },
  PHOTO_ATMOSPHERE: { GENERIC: "Mekânın dolu veya servise hazır hâlini yatay değil, sosyal medya kullanımına uygun şekilde çek." },
  PHOTO_PEOPLE: { GENERIC: "Ekip veya servis anını doğal şekilde çek." },
  VIDEO_VERTICAL: { GENERIC: "Telefonu dik tut ve 8–12 saniye kesintisiz çek." },
  VIDEO_KITCHEN: { GENERIC: "Hazırlık sürecini telefonu dik tutarak 8–12 saniye çek." },
  CUSTOM_GRAPHIC: { GENERIC: "Bu bir tasarım/görsel dosyasıdır; hazır olduğunda buradan yükleyin." },
};

function requestedMediaTypeFor(requirement: CaptureRequirement): MediaType {
  return requirement === "VIDEO_VERTICAL" || requirement === "VIDEO_KITCHEN" ? "VIDEO" : "IMAGE";
}

function buildCaptureCopy(business: BusinessForCapture, plannedDate: Date, contentType: ContentType, requirement: CaptureRequirement) {
  const bucket = sectorBucket(business.sector);
  const weekdayEn = new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, weekday: "long" }).format(plannedDate);
  const weekday = weekdayTr[weekdayEn] ?? weekdayEn;
  const subtitle = subtitleByRequirement[requirement][bucket] ?? subtitleByRequirement[requirement].GENERIC;
  const instructions = instructionByRequirement[requirement][bucket] ?? instructionByRequirement[requirement].GENERIC;
  return { title: `${weekday} ${contentTypeShortLabel[contentType]} — ${subtitle}`, instructions };
}

/**
 * Bir plan (yeni oluşturma veya tam yenileme) için, MISSING kalan her ACTIVE
 * öğeye eksiksiz bir CaptureRequest bağlar. Var olan tx içinde çağrılmalıdır.
 * Dedup: (contentPlanItemId, mediaRequirement) DB unique kısıtıyla garantilenir;
 * burada ayrıca terminal durumlar için açık bir politika uygulanır:
 *  - OPEN  -> dokunma (zaten takip ediliyor)
 *  - FULFILLED -> medya sonradan kaldırılmışsa (mediaAvailability tekrar MISSING) yeniden aç
 *  - DISMISSED / EXPIRED -> asla otomatik yeniden açma (kullanıcı/sistem kararına saygı)
 * Yeni satırlar tek bir createMany(skipDuplicates) ile yazılır: eşzamanlı iki senkron
 * aynı anahtarı görmese bile unique çakışması tx'i düşürmez, ikinci taraf sessizce atlanır.
 */
export async function syncCaptureRequestsForActiveItems(
  tx: Prisma.TransactionClient,
  business: BusinessForCapture,
  items: PlanItemForCapture[],
) {
  const toCreate: Prisma.CaptureRequestCreateManyInput[] = [];
  for (const item of items) {
    if (item.mediaRequirement === "NO_NEW_MEDIA_REQUIRED") continue;
    if (item.mediaAvailability !== "MISSING") continue;
    const requirement = item.mediaRequirement as CaptureRequirement;
    const existing = await tx.captureRequest.findUnique({
      where: { contentPlanItemId_mediaRequirement: { contentPlanItemId: item.id, mediaRequirement: requirement } },
    });
    if (existing) {
      if (existing.status === "FULFILLED") {
        const copy = buildCaptureCopy(business, item.plannedDate, item.contentType, requirement);
        await tx.captureRequest.update({
          where: { id: existing.id },
          data: { status: "OPEN", fulfilledAt: null, fulfilledByMediaAssetId: null, dueAt: item.plannedDate, title: copy.title, instructions: copy.instructions },
        });
      }
      continue;
    }
    const copy = buildCaptureCopy(business, item.plannedDate, item.contentType, requirement);
    toCreate.push({
      businessId: business.id,
      contentPlanItemId: item.id,
      mediaRequirement: requirement,
      requestedMediaType: requestedMediaTypeFor(requirement),
      title: copy.title,
      instructions: copy.instructions,
      dueAt: item.plannedDate,
    });
  }
  if (toCreate.length) await tx.captureRequest.createMany({ data: toCreate, skipDuplicates: true });
}

/**
 * Bir ContentPlanItem artık ACTIVE değilse (REPLACED veya planı SUPERSEDED oldu),
 * ona bağlı hâlâ OPEN olan CaptureRequest'i sistem tarafından kapatır
 * (dismissedById = null -> kullanıcı reddi değil, plan değişikliği).
 */
export async function invalidateCaptureRequestsForInactiveItems(tx: Prisma.TransactionClient, contentPlanItemIds: string[]) {
  if (!contentPlanItemIds.length) return;
  await tx.captureRequest.updateMany({
    where: { contentPlanItemId: { in: contentPlanItemIds }, status: "OPEN" },
    data: { status: "DISMISSED", dismissedAt: new Date(), dismissedById: null },
  });
}

/**
 * Yeni yüklenen/etiketlenen bir medya, eşleşen MISSING plan öğelerini doldurduğunda
 * bunlara bağlı OPEN CaptureRequest'leri FULFILLED yapar. Çağıran taraf
 * contentPlanItem.mediaAssetId/mediaAvailability güncellemesini zaten yapmış olmalıdır;
 * bu fonksiyon yalnızca CaptureRequest tarafını senkronize eder.
 */
export async function fulfillCaptureRequestsForItems(tx: Prisma.TransactionClient, contentPlanItemIds: string[], mediaAssetId: string) {
  if (!contentPlanItemIds.length) return;
  await tx.captureRequest.updateMany({
    where: { contentPlanItemId: { in: contentPlanItemIds }, status: "OPEN" },
    data: { status: "FULFILLED", fulfilledAt: new Date(), fulfilledByMediaAssetId: mediaAssetId },
  });
}

/**
 * Bir medya, onu fulfill etmiş olduğu CaptureRequest(ler)den kaldırıldığında
 * (deleteMedia veya retag) ilgili FULFILLED kayıtları tekrar OPEN'a döndürür.
 */
export async function reopenCaptureRequestsForRemovedMedia(tx: Prisma.TransactionClient, mediaAssetId: string) {
  await tx.captureRequest.updateMany({
    where: { fulfilledByMediaAssetId: mediaAssetId, status: "FULFILLED" },
    data: { status: "OPEN", fulfilledAt: null, fulfilledByMediaAssetId: null },
  });
}

function addDaysUtc(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Mevcut plan durumunu CaptureRequest tablosuyla uzlaştırır (P4-01 öncesi planlar
 * ya da senkron çağrısı atlanmış yollar için). İki adım, tek tx:
 *  1. Öğesi artık ACTIVE olmayan, planı SUPERSEDED olmuş ya da öğenin gereksinimi
 *     değişmiş hâlâ OPEN istekler sistem tarafından kapatılır (dismissedById = null).
 *  2. Güncel (SUPERSEDED olmayan plan, ACTIVE, MISSING) gereksinimler mevcut senkron
 *     kurallarıyla CaptureRequest'e bağlanır. Terminal politika ve unique kısıtı korunur;
 *     tekrarlı/eşzamanlı çağrılar kopya üretmez.
 */
async function reconcileCaptureRequests(business: BusinessForCapture, now: Date) {
  await prisma.$transaction(async (tx) => {
    const openRequests = await tx.captureRequest.findMany({
      where: { businessId: business.id, status: "OPEN" },
      select: { id: true, mediaRequirement: true, contentPlanItem: { select: { status: true, mediaRequirement: true, plan: { select: { status: true } } } } },
    });
    const staleIds = openRequests
      .filter((request) => request.contentPlanItem.status !== "ACTIVE" || request.contentPlanItem.plan.status === "SUPERSEDED" || request.contentPlanItem.mediaRequirement !== request.mediaRequirement)
      .map((request) => request.id);
    if (staleIds.length) {
      await tx.captureRequest.updateMany({ where: { id: { in: staleIds }, status: "OPEN" }, data: { status: "DISMISSED", dismissedAt: now, dismissedById: null } });
    }
    const items = await tx.contentPlanItem.findMany({
      where: { plan: { businessId: business.id, status: { not: "SUPERSEDED" } }, status: "ACTIVE", mediaAvailability: "MISSING", mediaRequirement: { not: "NO_NEW_MEDIA_REQUIRED" } },
      select: { id: true, mediaRequirement: true, mediaAvailability: true, plannedDate: true, contentType: true },
    });
    await syncCaptureRequestsForActiveItems(tx, business, items);
  });
}

/** Yalnızca vade günü işletme-yerel bugünden ÖNCE olan istekler süresi dolmuş sayılır; bugün vadeli olanlar gün bitene kadar açık kalır. */
async function expireDueCaptureRequests(businessId: string, today: Date) {
  await prisma.captureRequest.updateMany({
    where: { businessId, status: "OPEN", dueAt: { lt: today } },
    data: { status: "EXPIRED" },
  });
}

export async function listCaptureRequests(userId: string, businessId: string, options: { scope?: "TODAY" | "WEEK" | "ALL"; now?: Date } = {}) {
  await requireMembership(userId, businessId);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { id: true, sector: true, timezone: true } });
  const now = options.now ?? new Date();
  const today = calendarDayUtc(now, business.timezone);
  await reconcileCaptureRequests(business, now);
  await expireDueCaptureRequests(businessId, today);
  const scope = options.scope ?? "WEEK";
  const rangeEnd = scope === "TODAY" ? addDaysUtc(today, 1) : scope === "WEEK" ? addDaysUtc(today, 7) : null;
  return prisma.captureRequest.findMany({
    where: { businessId, status: "OPEN", ...(rangeEnd ? { dueAt: { lt: rangeEnd } } : {}) },
    orderBy: { dueAt: "asc" },
    include: { contentPlanItem: { select: { platform: true, contentType: true, pillar: true, plannedDate: true } } },
  });
}

async function requireOwnedCaptureRequest(userId: string, captureRequestId: string) {
  const request = await prisma.captureRequest.findUnique({ where: { id: captureRequestId } });
  if (!request) throw new DomainError("Çekim görevi bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, request.businessId);
  return request;
}

export async function dismissCaptureRequest(userId: string, captureRequestId: string) {
  const request = await requireOwnedCaptureRequest(userId, captureRequestId);
  if (request.status !== "OPEN") throw new DomainError("Yalnızca açık çekim görevleri reddedilebilir.", "CONFLICT");
  return prisma.captureRequest.update({
    where: { id: request.id },
    data: { status: "DISMISSED" as CaptureRequestStatus, dismissedAt: new Date(), dismissedById: userId },
  });
}
