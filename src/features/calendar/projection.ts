import type {
  ContentPlanItemStatus,
  ContentPlanStatus,
  ContentType,
  MediaAssetOrigin,
  MediaAvailability,
  MediaRequirement,
  MediaType,
  ScheduledPostStatus,
  SocialPlatform,
} from "../../../generated/prisma/enums";
import { calendarMediaLabels, calendarPlatformLabels } from "./labels";

// P5.5A kapsamı: Ainetra'ya ait takvim İZDÜŞÜMÜ. Yeni tablo yok; her olay mevcut
// ContentPlanItem veya ScheduledPost satırından türetilir ve olay kimliği her zaman bir
// Ainetra alan kimliğine işaret eder (takvim kütüphanesi kimliği değil).
//
// Politika (kısa ve açık):
//  - Yalnızca SUPERSEDED olmayan planların ACTIVE öğeleri izdüşüme girer; eski plan sürümleri
//    ve REPLACED öğeler hiçbir görünümde ve hiçbir sayımda görünmez.
//  - Kiracı sınırı: izdüşüm yalnızca verilen businessId'ye ait satırları kabul eder; başka
//    işletmeye ait bir satır sessizce düşürülür (çağıranın where filtresine ek savunma).
//  - Takvim günü İŞLETME SAAT DİLİMİNE göredir. Plan öğeleri zaten işletme-yerel takvim günü
//    olarak (UTC gece yarısı) saklanır; ScheduledPost gerçek bir andır ve işletme saat diliminde
//    biçimlendirilir. Bu yüzden 05.10 23:30 UTC, Europe/Istanbul için 06.10 02:30 olur.
//  - Medya yeterliliği: tasarım (CREATIVE_CAMPAIGN çıktısı) yalnızca "Özel tasarım" ihtiyacını
//    karşılar; gerçek fotoğraf/video isteyen bir ihtiyacı ASLA karşılamış saymayız.
//  - İçerik hazırlığı: yalnızca varyantın GÜNCEL sürümü onaylıysa "Hazır" sayılır.
//  - Tek iş = tek olay: bir ScheduledPost, contentVariant.contentItem üzerinden aynı platformdaki
//    aktif bir ContentPlanItem'a bağlıysa müşteri için TEK bir iş vardır. Bu ikisi tek olayda
//    birleştirilir; aksi hâlde takvimde çift satır, panoda çift sayım (Planlı/Hazır) oluşurdu.
//    Birleşen işin günü GÖNDERİDEN gelir ve olaylar aralığa göre birleştirmeden SONRA süzülür;
//    bu yüzden çağıran, görünen aralıktaki satırların bağlı karşılıklarını aralık dışında
//    kalsalar bile vermelidir (bkz. service.ts `loadProjectionInputs`). Aksi hâlde çiftin tek
//    yakası yüklenir, birleştirme yapılamaz ve aynı iş iki ayrı dönemde ayrı ayrı sayılır.
//  - İzdüşüm hiçbir şey yazmaz; onay, plan veya yayın durumunu değiştirmez.

export type CalendarView = "day" | "week" | "month" | "year";
export const calendarViews: readonly CalendarView[] = ["day", "week", "month", "year"];

export type CalendarEventStatus = "READY" | "MEDIA_NEEDED" | "PLANNED" | "ACTION_NEEDED" | "AINETRA_CAN_HELP";
export type CalendarEventSource = "PLAN_ITEM" | "SCHEDULED_POST";

export type CalendarEvent = {
  /** Kaynak türüyle ön eklenmiş kararlı olay kimliği. */
  id: string;
  source: CalendarEventSource;
  /** Ainetra alan kimliği: plan öğesi ya da planlanmış gönderi. */
  refId: string;
  /** İşletme-yerel takvim günü (YYYY-MM-DD). */
  date: string;
  /** İşletme-yerel saat (HH:mm). */
  time: string;
  platform: SocialPlatform;
  contentType: ContentType | null;
  title: string;
  summary: string;
  status: CalendarEventStatus;
  statusReason: string;
  requiresUserAction: boolean;
  /** Kullanıcıya doğrudan söylenecek ihtiyaç cümlesi; ihtiyaç yoksa null. */
  need: string | null;
  mediaRequirement: MediaRequirement | null;
  mediaAssetId: string | null;
  mediaFilename: string | null;
  mediaType: MediaType | null;
  /** Atanmış medya bir tasarım çıktısı mı (özgün fotoğraf/video değil). */
  designedCreative: boolean;
  planId: string | null;
  contentItemId: string | null;
  accountName: string | null;
  /** Mevcut çekim görevi metni; yoksa "Nasıl çekeyim?" gösterilmez. */
  captureGuidance: { title: string; instructions: string } | null;
  /** Mevcut Fallback motoru bu öğe için öneri üretmeye uygun mu (proposeContentFallback kurallarıyla aynı). */
  fallbackEligible: boolean;
  /** Açık (PROPOSED) bir yedek önerisi zaten var mı. */
  fallbackProposalPending: boolean;
};

export type CalendarCounts = {
  total: number;
  ready: number;
  mediaNeeded: number;
  planned: number;
  actionNeeded: number;
  ainetraCanHelp: number;
  /** Kullanıcıdan bir şey bekleyen olay sayısı (medya, onay veya yedek kararı). */
  userAction: number;
};

export type ProjectionPlanItem = {
  id: string;
  businessId: string;
  planId: string;
  planStatus: ContentPlanStatus;
  itemStatus: ContentPlanItemStatus;
  platform: SocialPlatform;
  contentType: ContentType;
  /** İşletme-yerel takvim günü, UTC gece yarısı olarak saklanır. */
  plannedDate: Date;
  recommendedTime: string;
  topic: string;
  concept: string;
  mediaRequirement: MediaRequirement;
  mediaAvailability: MediaAvailability;
  mediaAsset: { id: string; originalFilename: string; origin: MediaAssetOrigin; type: MediaType } | null;
  contentItem: { id: string; title: string; variants: { platform: SocialPlatform; version: number; approvedVersions: number[] }[] } | null;
  captureRequest: { title: string; instructions: string } | null;
  fallbackProposalPending: boolean;
};

export type ProjectionScheduledPost = {
  id: string;
  businessId: string;
  scheduledAt: Date;
  status: ScheduledPostStatus;
  contentVersion: number;
  accountDisplayName: string;
  platform: SocialPlatform;
  variant: {
    version: number;
    caption: string;
    approvedVersions: number[];
    mediaAssetId: string | null;
    mediaFilename: string | null;
    mediaType: MediaType | null;
    contentItem: { id: string; title: string; contentType: ContentType };
  };
};

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

function dayToUtc(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

/** UTC gece yarısı gösterimindeki takvim gününü YYYY-MM-DD'ye çevirir. */
export function utcToDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function isCalendarDay(value: string): boolean {
  if (!dayPattern.test(value)) return false;
  const parsed = dayToUtc(value);
  return !Number.isNaN(parsed.getTime()) && utcToDay(parsed) === value;
}

export function addCalendarDays(day: string, days: number) {
  const value = dayToUtc(day);
  value.setUTCDate(value.getUTCDate() + days);
  return utcToDay(value);
}

export function addCalendarMonths(day: string, months: number) {
  const value = dayToUtc(day);
  const target = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(value.getUTCDate(), lastDay));
  return utcToDay(target);
}

/** Hafta Pazartesi başlar (Türkiye takvim alışkanlığı). */
export function startOfCalendarWeek(day: string) {
  const value = dayToUtc(day);
  const weekday = (value.getUTCDay() + 6) % 7;
  return addCalendarDays(day, -weekday);
}

export function startOfCalendarMonth(day: string) {
  return `${day.slice(0, 7)}-01`;
}

export function startOfCalendarYear(day: string) {
  return `${day.slice(0, 4)}-01-01`;
}

/** Bir görünümün kapsadığı takvim günü aralığı; `to` dışlayıcıdır. */
export function calendarRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: addCalendarDays(anchor, 1) };
  if (view === "week") {
    const from = startOfCalendarWeek(anchor);
    return { from, to: addCalendarDays(from, 7) };
  }
  if (view === "month") {
    // Ay görünümü 6x7 ızgaradır; komşu ayların görünen günleri de aralığa girer.
    const from = startOfCalendarWeek(startOfCalendarMonth(anchor));
    return { from, to: addCalendarDays(from, 42) };
  }
  const from = startOfCalendarYear(anchor);
  return { from, to: `${Number(from.slice(0, 4)) + 1}-01-01` };
}

/** Görünüme göre önceki/sonraki dönem çapası. */
export function shiftCalendarAnchor(view: CalendarView, anchor: string, direction: -1 | 1) {
  if (view === "day") return addCalendarDays(anchor, direction);
  if (view === "week") return addCalendarDays(anchor, 7 * direction);
  if (view === "month") return addCalendarMonths(startOfCalendarMonth(anchor), direction);
  return addCalendarMonths(startOfCalendarYear(anchor), 12 * direction);
}

function zoneParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

/** Bir anın işletme-yerel takvim günü. */
export function zonedDay(instant: Date, timeZone: string) {
  const parts = zoneParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Bir anın işletme-yerel saati (HH:mm). */
export function zonedTime(instant: Date, timeZone: string) {
  const parts = zoneParts(instant, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function zoneOffsetMs(instant: Date, timeZone: string) {
  const parts = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * İşletme-yerel bir takvim gününün başladığı gerçek an. ScheduledPost sorgularının sınırını
 * hesaplamak için kullanılır; yaz saati geçişlerinde ofset iki adımda sabitlenir.
 */
export function zonedDayStart(day: string, timeZone: string) {
  const naive = dayToUtc(day).getTime();
  let instant = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  instant = new Date(naive - zoneOffsetMs(instant, timeZone));
  return instant;
}

function compareEvents(left: CalendarEvent, right: CalendarEvent) {
  return left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.id.localeCompare(right.id);
}

/** Tasarım çıktısı yalnızca "Özel tasarım" ihtiyacını karşılar; gerçek fotoğraf/video kanıtı yerine geçmez. */
function satisfiesRequirement(item: ProjectionPlanItem) {
  if (item.mediaRequirement === "NO_NEW_MEDIA_REQUIRED") return true;
  if (item.mediaAvailability !== "AVAILABLE" || !item.mediaAsset) return false;
  if (item.mediaAsset.origin === "CREATIVE_CAMPAIGN" && item.mediaRequirement !== "CUSTOM_GRAPHIC") return false;
  return true;
}

function planItemEvent(item: ProjectionPlanItem, today: string): CalendarEvent | null {
  if (item.planStatus === "SUPERSEDED" || item.itemStatus !== "ACTIVE") return null;
  const mediaLabel = calendarMediaLabels[item.mediaRequirement];
  const designedCreative = item.mediaAsset?.origin === "CREATIVE_CAMPAIGN";
  const covered = satisfiesRequirement(item);
  const variant = item.contentItem?.variants.find((candidate) => candidate.platform === item.platform);
  const approved = variant ? variant.approvedVersions.includes(variant.version) : false;

  let status: CalendarEventStatus;
  let statusReason: string;
  let need: string | null = null;
  if (!covered) {
    status = item.fallbackProposalPending ? "AINETRA_CAN_HELP" : "MEDIA_NEEDED";
    need = `${mediaLabel} gerekiyor.`;
    statusReason = designedCreative
      ? `${mediaLabel} eksik. Bu öğeye bağlı görsel bir tasarımdır; gerçek fotoğraf veya video yerine geçmez.`
      : `${mediaLabel} eksik.`;
    if (status === "AINETRA_CAN_HELP") statusReason += " Ainetra'nın hazır bir yedek önerisi var; siz kabul edene kadar plan değişmez.";
  } else if (variant) {
    status = approved ? "READY" : "ACTION_NEEDED";
    statusReason = approved
      ? "Medya ve içeriğin güncel sürümü hazır."
      : "İçerik oluşturuldu; güncel sürümün onayı sizi bekliyor.";
    if (!approved) need = "İçeriğin güncel sürümünü onaylamanız gerekiyor.";
  } else if (item.contentItem) {
    // İçerik kaydı var ama bu platformun varyantı yok; hazır saymak yanıltıcı olurdu.
    status = "ACTION_NEEDED";
    statusReason = `İçerik oluşturuldu ancak ${calendarPlatformLabels[item.platform]} varyantı henüz hazır değil.`;
    need = `${calendarPlatformLabels[item.platform]} varyantını tamamlamanız gerekiyor.`;
  } else {
    status = "PLANNED";
    statusReason = item.mediaRequirement === "NO_NEW_MEDIA_REQUIRED"
      ? "Planlandı; yeni medya gerekmiyor, içerik henüz oluşturulmadı."
      : "Planlandı; medya hazır, içerik henüz oluşturulmadı.";
  }

  return {
    id: `plan:${item.id}`,
    source: "PLAN_ITEM",
    refId: item.id,
    date: utcToDay(item.plannedDate),
    time: item.recommendedTime,
    platform: item.platform,
    contentType: item.contentType,
    title: item.topic,
    summary: item.concept,
    status,
    statusReason,
    requiresUserAction: status === "MEDIA_NEEDED" || status === "ACTION_NEEDED" || status === "AINETRA_CAN_HELP",
    need,
    mediaRequirement: item.mediaRequirement,
    mediaAssetId: item.mediaAsset?.id ?? null,
    mediaFilename: item.mediaAsset?.originalFilename ?? null,
    mediaType: item.mediaAsset?.type ?? null,
    designedCreative,
    planId: item.planId,
    contentItemId: item.contentItem?.id ?? null,
    accountName: null,
    captureGuidance: covered ? null : item.captureRequest,
    // Mevcut Fallback motorunun uygunluk kuralları: aktif öğe, güncel plan sürümü, medya eksik,
    // yeni medya gerekiyor ve öğe geçmiş tarihli değil. Uygun değilse yardım bağlantısı gösterilmez.
    fallbackEligible: !covered
      && item.mediaRequirement !== "NO_NEW_MEDIA_REQUIRED"
      && item.mediaAvailability === "MISSING"
      && item.mediaAsset === null
      && utcToDay(item.plannedDate) >= today,
    fallbackProposalPending: !covered && item.fallbackProposalPending,
  };
}

function scheduledPostEvent(post: ProjectionScheduledPost, timeZone: string): CalendarEvent | null {
  if (post.status === "CANCELLED") return null;
  const approved = post.variant.approvedVersions.includes(post.variant.version);
  const versionMatches = post.contentVersion === post.variant.version;
  let status: CalendarEventStatus;
  let statusReason: string;
  let need: string | null = null;
  if (post.status === "PUBLISHED") {
    status = "READY";
    statusReason = "Yayınlandı.";
  } else if (post.status === "INVALIDATED") {
    status = "ACTION_NEEDED";
    statusReason = "İçerik değiştiği için bu yayın kaydı geçersizleşti.";
    need = "İçeriği gözden geçirip yeniden planlamanız gerekiyor.";
  } else if (post.status === "FAILED") {
    status = "ACTION_NEEDED";
    statusReason = "Yayın denemesi başarısız oldu.";
    need = "İçeriği gözden geçirip yeniden planlamanız gerekiyor.";
  } else if (!versionMatches) {
    status = "ACTION_NEEDED";
    statusReason = `Planlanan sürüm v${post.contentVersion}, içeriğin güncel sürümü v${post.variant.version}.`;
    need = "Güncel sürümü onaylayıp yeniden planlamanız gerekiyor.";
  } else if (!approved) {
    status = "ACTION_NEEDED";
    statusReason = "Planlanan sürümün onayı yok.";
    need = "İçeriğin güncel sürümünü onaylamanız gerekiyor.";
  } else {
    status = "READY";
    statusReason = "Onaylı ve yayın sırasını bekliyor.";
  }
  return {
    id: `post:${post.id}`,
    source: "SCHEDULED_POST",
    refId: post.id,
    date: zonedDay(post.scheduledAt, timeZone),
    time: zonedTime(post.scheduledAt, timeZone),
    platform: post.platform,
    contentType: post.variant.contentItem.contentType,
    title: post.variant.contentItem.title,
    summary: post.variant.caption.slice(0, 180),
    status,
    statusReason,
    requiresUserAction: status === "ACTION_NEEDED",
    need,
    mediaRequirement: null,
    mediaAssetId: post.variant.mediaAssetId,
    mediaFilename: post.variant.mediaFilename,
    mediaType: post.variant.mediaType,
    designedCreative: false,
    planId: null,
    contentItemId: post.variant.contentItem.id,
    accountName: post.accountDisplayName,
    captureGuidance: null,
    fallbackEligible: false,
    fallbackProposalPending: false,
  };
}

/** Bir plan öğesi ile bir planlanmış gönderiyi aynı işe bağlayan anahtar: içerik + platform. */
function linkKey(contentItemId: string | null, platform: SocialPlatform) {
  return contentItemId ? `${contentItemId}::${platform}` : null;
}

/** Durumların aciliyet sırası; birleştirmede daha acil olan kaybolmamalıdır. */
const statusUrgency: Record<CalendarEventStatus, number> = {
  READY: 0,
  PLANNED: 1,
  AINETRA_CAN_HELP: 2,
  MEDIA_NEEDED: 3,
  ACTION_NEEDED: 4,
};

/**
 * Bağlı plan öğesi ve planlanmış gönderiyi tek olaya indirger.
 *
 * Zaman, hesap, kimlik ve başlık GÖNDERİDEN gelir: gerçek yayın anı odur. Medya ihtiyacı, çekim
 * yönergesi, yedek uygunluğu ve plan bağlantısı PLAN ÖĞESİNDEN gelir. Durum, ikisinden daha acil
 * olanıdır ki gerçek bir ihtiyaç sayımdan düşmesin. Gönderi yayınlandıysa plan öğesinin medya
 * uyarısı geçmişte kalmıştır; o durumda gönderinin durumu esas alınır ve yardım/çekim bağlantıları
 * gösterilmez (olmayan bir eylem uydurulmaz).
 */
function mergeLinkedEvent(planEvent: CalendarEvent, postEvent: CalendarEvent, published: boolean): CalendarEvent {
  const leading = published || statusUrgency[postEvent.status] >= statusUrgency[planEvent.status] ? postEvent : planEvent;
  return {
    ...postEvent,
    status: leading.status,
    statusReason: leading.statusReason,
    need: leading.need,
    requiresUserAction: published ? postEvent.requiresUserAction : planEvent.requiresUserAction || postEvent.requiresUserAction,
    mediaRequirement: planEvent.mediaRequirement,
    mediaAssetId: postEvent.mediaAssetId ?? planEvent.mediaAssetId,
    mediaFilename: postEvent.mediaFilename ?? planEvent.mediaFilename,
    mediaType: postEvent.mediaType ?? planEvent.mediaType,
    designedCreative: planEvent.designedCreative,
    planId: planEvent.planId,
    captureGuidance: published ? null : planEvent.captureGuidance,
    fallbackEligible: published ? false : planEvent.fallbackEligible,
    fallbackProposalPending: published ? false : planEvent.fallbackProposalPending,
  };
}

/**
 * Saf, deterministik izdüşüm. Kiracı filtresi burada da uygulanır: verilen businessId dışındaki
 * satırlar düşürülür. `range.to` dışlayıcıdır ve işletme-yerel takvim günü olarak karşılaştırılır.
 */
export function buildCalendarProjection(input: {
  businessId: string;
  timeZone: string;
  today: string;
  range: { from: string; to: string };
  planItems: ProjectionPlanItem[];
  scheduledPosts: ProjectionScheduledPost[];
}): CalendarEvent[] {
  const planEvents: CalendarEvent[] = [];
  // Bir bağlantı anahtarının ilk plan öğesi birleştirmeye adaydır; aynı anahtarın ikinci öğesi
  // ayrı bir iştir ve kendi olayı olarak kalır.
  const planByLink = new Map<string, CalendarEvent>();
  for (const item of input.planItems) {
    if (item.businessId !== input.businessId) continue;
    const event = planItemEvent(item, input.today);
    if (!event) continue;
    planEvents.push(event);
    const key = linkKey(event.contentItemId, event.platform);
    if (key && !planByLink.has(key)) planByLink.set(key, event);
  }

  const postEvents: CalendarEvent[] = [];
  const mergedPlanEventIds = new Set<string>();
  const consumedLinks = new Set<string>();
  for (const post of input.scheduledPosts) {
    if (post.businessId !== input.businessId) continue;
    const event = scheduledPostEvent(post, input.timeZone);
    if (!event) continue;
    const key = linkKey(event.contentItemId, event.platform);
    // Aynı içerik için birden çok gönderi varsa yalnızca ilki (en erken) plan öğesiyle birleşir;
    // diğerleri ayrı gönderi olayı olarak korunur.
    const planEvent = key && !consumedLinks.has(key) ? planByLink.get(key) : undefined;
    if (key && planEvent) {
      consumedLinks.add(key);
      mergedPlanEventIds.add(planEvent.id);
      postEvents.push(mergeLinkedEvent(planEvent, event, post.status === "PUBLISHED"));
      continue;
    }
    postEvents.push(event);
  }

  return [...planEvents.filter((event) => !mergedPlanEventIds.has(event.id)), ...postEvents]
    .filter((event) => event.date >= input.range.from && event.date < input.range.to)
    .sort(compareEvents);
}

/**
 * Takvimin gösterdiği olayların AYNISINI sayar. Bağlı plan öğesi + planlanmış gönderi tek olaya
 * indirgendiği için bir içerik haftalık toplamda ve Hazır sayısında yalnızca bir kez sayılır.
 */
export function summarizeCalendarEvents(events: CalendarEvent[]): CalendarCounts {
  const count = (status: CalendarEventStatus) => events.filter((event) => event.status === status).length;
  return {
    total: events.length,
    ready: count("READY"),
    mediaNeeded: count("MEDIA_NEEDED"),
    planned: count("PLANNED"),
    actionNeeded: count("ACTION_NEEDED"),
    ainetraCanHelp: count("AINETRA_CAN_HELP"),
    userAction: events.filter((event) => event.requiresUserAction).length,
  };
}

/** Takvim olayını açan bağlantı; gün görünümünde ilgili çekmece doğrudan açılır. */
export function calendarEventHref(event: Pick<CalendarEvent, "id" | "date">) {
  return `/calendar?view=day&date=${event.date}&event=${encodeURIComponent(event.id)}`;
}

// P5.5B: telefon için hafif, Ainetra'ya ait takvim sunumu. Aynı izdüşümü ve aynı işletme-yerel gün
// semantiğini kullanır; yalnızca aralığı ve gruplamayı değiştirir. FullCalendar masaüstü/tablette kalır.

export type MobileCalendarView = "day" | "3day" | "week" | "month";
export const mobileCalendarViews: readonly MobileCalendarView[] = ["day", "3day", "week", "month"];

export function isMobileCalendarView(value: unknown): value is MobileCalendarView {
  return mobileCalendarViews.includes(value as MobileCalendarView);
}

/** Masaüstü görünümünün telefondaki karşılığı; yıl telefonda ay özetine iner. */
export function mobileViewForDesktop(view: CalendarView): MobileCalendarView {
  return view === "year" ? "month" : view;
}

/**
 * Telefon görünümünün kapsadığı işletme-yerel gün aralığı; `to` dışlayıcıdır. Ay görünümü yalnızca
 * ayın kendi günlerini kapsar (komşu ay günleri yok) ki özet kısa kalsın.
 */
export function mobileCalendarRange(view: MobileCalendarView, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: addCalendarDays(anchor, 1) };
  if (view === "3day") return { from: anchor, to: addCalendarDays(anchor, 3) };
  if (view === "week") return calendarRange("week", anchor);
  const from = startOfCalendarMonth(anchor);
  return { from, to: addCalendarMonths(from, 1) };
}

export function shiftMobileCalendarAnchor(view: MobileCalendarView, anchor: string, direction: -1 | 1) {
  if (view === "day") return addCalendarDays(anchor, direction);
  if (view === "3day") return addCalendarDays(anchor, 3 * direction);
  if (view === "week") return addCalendarDays(anchor, 7 * direction);
  return addCalendarMonths(startOfCalendarMonth(anchor), direction);
}

export type CalendarDayGroup = {
  date: string;
  events: CalendarEvent[];
  counts: CalendarCounts;
};

/** Aralıktaki HER gün için (boş günler dahil) sıralı olay grubu ve aynı sayım politikası. */
export function groupCalendarEventsByDay(events: CalendarEvent[], range: { from: string; to: string }): CalendarDayGroup[] {
  const groups: CalendarDayGroup[] = [];
  for (let date = range.from; date < range.to; date = addCalendarDays(date, 1)) {
    const dayEvents = events.filter((event) => event.date === date).sort(compareEvents);
    groups.push({ date, events: dayEvents, counts: summarizeCalendarEvents(dayEvents) });
  }
  return groups;
}
