import "server-only";

import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { requireMembership } from "@/lib/authorization";
import type { Prisma } from "../../../generated/prisma/client";
import {
  addCalendarDays,
  buildCalendarProjection,
  calendarRange,
  groupCalendarEventsByDay,
  mobileCalendarRange,
  startOfCalendarWeek,
  summarizeCalendarEvents,
  zonedDay,
  zonedDayStart,
  type CalendarCounts,
  type CalendarDayGroup,
  type CalendarEvent,
  type CalendarView,
  type MobileCalendarView,
  type ProjectionPlanItem,
  type ProjectionScheduledPost,
} from "./projection";

// P5.5A: takvim çalışma alanı ve panonun ORTAK okuma katmanı. İkisi de aynı izdüşüm ve aynı
// sayım politikasını kullanır, böylece panodaki sayı ile takvimdeki olaylar birbirini tutar.
// Bu modül yalnızca okur; hiçbir onay, plan veya yayın kaydını değiştirmez.

export type CalendarWorkspace = {
  timezone: string;
  today: string;
  view: CalendarView;
  anchor: string;
  range: { from: string; to: string };
  events: CalendarEvent[];
  counts: CalendarCounts;
};

function dayToUtc(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

async function loadBusiness(businessId: string) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, timezone: true } });
  if (!business) throw new DomainError("İşletme bulunamadı.", "NOT_FOUND");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: business.timezone }).format(new Date());
  } catch {
    throw new DomainError("İşletme saat dilimi geçersiz.", "VALIDATION_ERROR");
  }
  return business;
}

const planItemSelect = {
  id: true, planId: true, status: true, platform: true, contentType: true, plannedDate: true, recommendedTime: true,
  topic: true, concept: true, mediaRequirement: true, mediaAvailability: true, contentItemId: true,
  plan: { select: { businessId: true, status: true } },
  mediaAsset: { select: { id: true, originalFilename: true, origin: true, type: true } },
  contentItem: { select: { id: true, title: true, variants: { select: { platform: true, version: true, approvals: { select: { approvedVersion: true } } } } } },
  captureRequests: { where: { status: "OPEN" }, select: { title: true, instructions: true, mediaRequirement: true } },
  fallbackProposals: { where: { status: "PROPOSED" }, select: { id: true } },
} satisfies Prisma.ContentPlanItemSelect;

const scheduledPostSelect = {
  id: true, businessId: true, scheduledAt: true, status: true, contentVersion: true,
  socialAccount: { select: { platform: true, displayName: true } },
  contentVariant: {
    select: {
      version: true, caption: true, mediaAssetId: true, contentItemId: true,
      approvals: { select: { approvedVersion: true } },
      mediaAsset: { select: { originalFilename: true, type: true } },
      contentItem: { select: { id: true, title: true, contentType: true } },
    },
  },
} satisfies Prisma.ScheduledPostSelect;

type PlanItemRow = Prisma.ContentPlanItemGetPayload<{ select: typeof planItemSelect }>;
type ScheduledPostRow = Prisma.ScheduledPostGetPayload<{ select: typeof scheduledPostSelect }>;

function toProjectionPlanItem(item: PlanItemRow): ProjectionPlanItem {
  return {
    id: item.id,
    businessId: item.plan.businessId,
    planId: item.planId,
    planStatus: item.plan.status,
    itemStatus: item.status,
    platform: item.platform,
    contentType: item.contentType,
    plannedDate: item.plannedDate,
    recommendedTime: item.recommendedTime,
    topic: item.topic,
    concept: item.concept,
    mediaRequirement: item.mediaRequirement,
    mediaAvailability: item.mediaAvailability,
    mediaAsset: item.mediaAsset,
    contentItem: item.contentItem
      ? {
        id: item.contentItem.id,
        title: item.contentItem.title,
        variants: item.contentItem.variants.map((variant) => ({
          platform: variant.platform,
          version: variant.version,
          approvedVersions: variant.approvals.map((approval) => approval.approvedVersion),
        })),
      }
      : null,
    captureRequest: (() => {
      const request = item.captureRequests.find((candidate) => candidate.mediaRequirement === item.mediaRequirement);
      return request ? { title: request.title, instructions: request.instructions } : null;
    })(),
    fallbackProposalPending: item.fallbackProposals.length > 0,
  };
}

function toProjectionScheduledPost(post: ScheduledPostRow): ProjectionScheduledPost {
  return {
    id: post.id,
    businessId: post.businessId,
    scheduledAt: post.scheduledAt,
    status: post.status,
    contentVersion: post.contentVersion,
    accountDisplayName: post.socialAccount.displayName,
    platform: post.socialAccount.platform,
    variant: {
      version: post.contentVariant.version,
      caption: post.contentVariant.caption,
      approvedVersions: post.contentVariant.approvals.map((approval) => approval.approvedVersion),
      mediaAssetId: post.contentVariant.mediaAssetId,
      mediaFilename: post.contentVariant.mediaAsset?.originalFilename ?? null,
      mediaType: post.contentVariant.mediaAsset?.type ?? null,
      contentItem: post.contentVariant.contentItem,
    },
  };
}

// İzdüşümdeki "ilk bağlı öğe/gönderi birleşir" kuralı sıraya bağlıdır; aralık dışından gelen
// karşı yakaları ekledikten sonra listeleri yeniden aynı ölçütle sıralarız.
function comparePlanItemRows(left: PlanItemRow, right: PlanItemRow) {
  return left.plannedDate.getTime() - right.plannedDate.getTime()
    || left.recommendedTime.localeCompare(right.recommendedTime)
    || left.id.localeCompare(right.id);
}

function compareScheduledPostRows(left: ScheduledPostRow, right: ScheduledPostRow) {
  return left.scheduledAt.getTime() - right.scheduledAt.getTime() || left.id.localeCompare(right.id);
}

/**
 * Verilen takvim günü aralığındaki olayları toplar. Plan öğeleri işletme-yerel takvim günü
 * olarak saklandığı için doğrudan karşılaştırılır; planlanmış gönderiler gerçek an olduğu için
 * aralık sınırları işletme saat diliminde ana çevrilir.
 *
 * BAĞLI ÇİFTİN KARŞI YAKASI: bir plan öğesi ile ona bağlı ScheduledPost farklı haftalara düşebilir
 * (öğe A haftasına planlanmış, gönderi B haftasına alınmıştır). Yalnızca görünen aralığı okursak
 * çiftin tek yakasını görür, birleştiremez ve aynı işi iki haftada ayrı ayrı gösterip sayardık;
 * eski planlanan gün de yanlışlıkla "yapılacak iş" gibi durmaya devam ederdi. Bu yüzden aralıktaki
 * satırların bağlı karşılıkları, aralık dışında olsalar bile İKİNCİ bir kiracı-kapsamlı sorguyla
 * yüklenir. Bunlar yalnızca birleştirme içindir: izdüşüm olayları yine görünen aralığa göre süzer,
 * dolayısıyla birleşmiş iş sadece gönderinin yetkili gününde ve bir kez görünür. Aynı plan/gönderi
 * kuralları (kiracı, güncel plan sürümü, ACTIVE öğe) bu ikinci sorguda da aynen uygulanır.
 */
async function loadProjectionInputs(businessId: string, range: { from: string; to: string }, timeZone: string) {
  const rangeStartInstant = zonedDayStart(range.from, timeZone);
  const rangeEndInstant = zonedDayStart(range.to, timeZone);

  const [items, posts] = await Promise.all([
    prisma.contentPlanItem.findMany({
      where: {
        plan: { businessId, status: { not: "SUPERSEDED" } },
        status: "ACTIVE",
        plannedDate: { gte: dayToUtc(range.from), lt: dayToUtc(range.to) },
      },
      select: planItemSelect,
      orderBy: [{ plannedDate: "asc" }, { recommendedTime: "asc" }, { id: "asc" }],
    }),
    prisma.scheduledPost.findMany({
      where: { businessId, scheduledAt: { gte: rangeStartInstant, lt: rangeEndInstant } },
      select: scheduledPostSelect,
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    }),
  ]);

  // Aralıktaki satırların bağlanabileceği içerik kayıtları; karşı yakayı yalnızca bunlarla ararız.
  const itemContentIds = [...new Set(items.map((item) => item.contentItemId).filter((id): id is string => id !== null))];
  const postContentIds = [...new Set(posts.map((post) => post.contentVariant.contentItemId))];

  const [linkedPosts, linkedItems] = await Promise.all([
    itemContentIds.length
      ? prisma.scheduledPost.findMany({
        where: {
          businessId,
          contentVariant: { contentItemId: { in: itemContentIds } },
          OR: [{ scheduledAt: { lt: rangeStartInstant } }, { scheduledAt: { gte: rangeEndInstant } }],
        },
        select: scheduledPostSelect,
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      })
      : Promise.resolve<ScheduledPostRow[]>([]),
    postContentIds.length
      ? prisma.contentPlanItem.findMany({
        where: {
          plan: { businessId, status: { not: "SUPERSEDED" } },
          status: "ACTIVE",
          contentItemId: { in: postContentIds },
          OR: [{ plannedDate: { lt: dayToUtc(range.from) } }, { plannedDate: { gte: dayToUtc(range.to) } }],
        },
        select: planItemSelect,
        orderBy: [{ plannedDate: "asc" }, { recommendedTime: "asc" }, { id: "asc" }],
      })
      : Promise.resolve<PlanItemRow[]>([]),
  ]);

  const planItems: ProjectionPlanItem[] = [...items, ...linkedItems].sort(comparePlanItemRows).map(toProjectionPlanItem);
  const scheduledPosts: ProjectionScheduledPost[] = [...posts, ...linkedPosts].sort(compareScheduledPostRows).map(toProjectionScheduledPost);

  return { planItems, scheduledPosts };
}

/** Üyelik denetimli takvim çalışma alanı; görünüm ve çapa (anchor) sunucuda doğrulanmış olmalıdır. */
export async function getCalendarWorkspace(
  userId: string,
  businessId: string,
  options: { view?: CalendarView; anchor?: string; now?: Date } = {},
): Promise<CalendarWorkspace> {
  await requireMembership(userId, businessId);
  const business = await loadBusiness(businessId);
  const now = options.now ?? new Date();
  const today = zonedDay(now, business.timezone);
  const view = options.view ?? "week";
  const anchor = options.anchor ?? today;
  const range = calendarRange(view, anchor);
  const inputs = await loadProjectionInputs(businessId, range, business.timezone);
  const events = buildCalendarProjection({ businessId, timeZone: business.timezone, today, range, ...inputs });
  return { timezone: business.timezone, today, view, anchor, range, events, counts: summarizeCalendarEvents(events) };
}

export type CalendarWeekSummary = {
  timezone: string;
  today: string;
  weekStart: string;
  weekEnd: string;
  counts: CalendarCounts;
  /** Kullanıcıdan bir şey bekleyen ilk olaylar; pano bunlara doğrudan bağlanır. */
  nextActions: CalendarEvent[];
};

/**
 * Panonun üst bölümü için bu haftanın (işletme-yerel, Pazartesi başlangıçlı) özeti.
 * Takvimle AYNI izdüşümü kullanır; eski plan sürümleri ve REPLACED öğeler yine sayılmaz.
 */
export async function getCalendarWeekSummary(
  userId: string,
  businessId: string,
  options: { now?: Date; maxActions?: number } = {},
): Promise<CalendarWeekSummary> {
  await requireMembership(userId, businessId);
  const business = await loadBusiness(businessId);
  const now = options.now ?? new Date();
  const today = zonedDay(now, business.timezone);
  const from = startOfCalendarWeek(today);
  const to = addCalendarDays(from, 7);
  const inputs = await loadProjectionInputs(businessId, { from, to }, business.timezone);
  const events = buildCalendarProjection({ businessId, timeZone: business.timezone, today, range: { from, to }, ...inputs });
  return {
    timezone: business.timezone,
    today,
    weekStart: from,
    weekEnd: addCalendarDays(to, -1),
    counts: summarizeCalendarEvents(events),
    nextActions: events.filter((event) => event.requiresUserAction).slice(0, options.maxActions ?? 3),
  };
}

async function loadRangeEvents(business: { id: string; timezone: string }, range: { from: string; to: string }, today: string) {
  const inputs = await loadProjectionInputs(business.id, range, business.timezone);
  return buildCalendarProjection({ businessId: business.id, timeZone: business.timezone, today, range, ...inputs });
}

export type MobileCalendarWorkspace = {
  timezone: string;
  today: string;
  view: MobileCalendarView;
  anchor: string;
  range: { from: string; to: string };
  events: CalendarEvent[];
  days: CalendarDayGroup[];
  counts: CalendarCounts;
};

/** P5.5B: telefon takvimi. Masaüstü ile aynı üyelik, kiracı, plan sürümü ve saat dilimi kuralları. */
export async function getMobileCalendar(
  userId: string,
  businessId: string,
  options: { view?: MobileCalendarView; anchor?: string; now?: Date } = {},
): Promise<MobileCalendarWorkspace> {
  await requireMembership(userId, businessId);
  const business = await loadBusiness(businessId);
  const today = zonedDay(options.now ?? new Date(), business.timezone);
  const view = options.view ?? "day";
  const anchor = options.anchor ?? today;
  const range = mobileCalendarRange(view, anchor);
  const events = await loadRangeEvents(business, range, today);
  return { timezone: business.timezone, today, view, anchor, range, events, days: groupCalendarEventsByDay(events, range), counts: summarizeCalendarEvents(events) };
}

export type TodayAgenda = {
  timezone: string;
  today: string;
  /** İşletme-yerel bugünün olayları. */
  todayEvents: CalendarEvent[];
  todayCounts: CalendarCounts;
  /** Bugünden sonraki günlerde (varsayılan 7 gün) sizden bir şey bekleyen ilk olaylar. */
  upcomingActions: CalendarEvent[];
};

/** P5.5B: mobil Bugün yüzeyi; takvimle aynı izdüşüm, işletme saat dilimindeki bugün. */
export async function getTodayAgenda(
  userId: string,
  businessId: string,
  options: { now?: Date; days?: number; maxActions?: number } = {},
): Promise<TodayAgenda> {
  await requireMembership(userId, businessId);
  const business = await loadBusiness(businessId);
  const today = zonedDay(options.now ?? new Date(), business.timezone);
  const events = await loadRangeEvents(business, { from: today, to: addCalendarDays(today, options.days ?? 7) }, today);
  const todayEvents = events.filter((event) => event.date === today);
  return {
    timezone: business.timezone,
    today,
    todayEvents,
    todayCounts: summarizeCalendarEvents(todayEvents),
    upcomingActions: events.filter((event) => event.date > today && event.requiresUserAction).slice(0, options.maxActions ?? 3),
  };
}
