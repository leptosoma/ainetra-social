import type { ContentType, MediaRequirement, SocialPlatform } from "../../../generated/prisma/enums";
import type { CalendarEventStatus, CalendarView } from "./projection";

// P5.5A: takvim yüzeyinde kullanıcıya gösterilen tüm etiketler. Ham enum adı hiçbir yerde
// ekrana yazılmaz; her durum RENK DIŞINDA bir simge ve düz Türkçe metinle de anlatılır.

export const calendarStatusLabels: Record<CalendarEventStatus, string> = {
  READY: "Hazır",
  MEDIA_NEEDED: "Medya gerekli",
  PLANNED: "Planlandı",
  ACTION_NEEDED: "Senden bir şey bekliyor",
  AINETRA_CAN_HELP: "Ainetra yardım edebilir",
};

/** Renk körlüğü ve yazıcı çıktısı için durum simgeleri; etiket metniyle birlikte kullanılır. */
export const calendarStatusIcons: Record<CalendarEventStatus, string> = {
  READY: "✓",
  MEDIA_NEEDED: "▧",
  PLANNED: "◷",
  ACTION_NEEDED: "!",
  AINETRA_CAN_HELP: "✦",
};

/** CSS sınıf eki; yalnızca ikincil görsel ipucudur. */
export const calendarStatusClass: Record<CalendarEventStatus, string> = {
  READY: "ready",
  MEDIA_NEEDED: "media-needed",
  PLANNED: "planned",
  ACTION_NEEDED: "action-needed",
  AINETRA_CAN_HELP: "ainetra-help",
};

export const calendarPlatformLabels: Record<SocialPlatform, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
};

export const calendarContentTypeLabels: Record<ContentType, string> = {
  POST: "Gönderi",
  REEL: "Dikey video",
  STORY: "Hikâye",
  CAROUSEL: "Çoklu görsel",
};

export const calendarMediaLabels: Record<MediaRequirement, string> = {
  PHOTO_PRODUCT: "Ürün fotoğrafı",
  PHOTO_ATMOSPHERE: "Mekân fotoğrafı",
  PHOTO_PEOPLE: "Ekip fotoğrafı",
  VIDEO_VERTICAL: "Dikey video",
  VIDEO_KITCHEN: "Hazırlık videosu",
  CUSTOM_GRAPHIC: "Özel tasarım",
  NO_NEW_MEDIA_REQUIRED: "Yeni medya gerekmiyor",
};

export const calendarViewLabels: Record<CalendarView, string> = {
  day: "Gün",
  week: "Hafta",
  month: "Ay",
  year: "Yıl",
};

export const weekdayLabels = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"] as const;
export const weekdayShortLabels = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;
export const monthLabels = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"] as const;

/** Hafta başı Pazartesi kabul edilir; takvim günü (YYYY-MM-DD) için 0-6 indeksi. */
export function weekdayIndex(day: string) {
  return (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** "7 Ekim" — ay hücreleri ve kısa satırlar için. */
export function formatCalendarDayShort(day: string) {
  return `${Number(day.slice(8, 10))} ${monthLabels[Number(day.slice(5, 7)) - 1]}`;
}

/** "7 Ekim 2026" */
export function formatCalendarDay(day: string) {
  return `${formatCalendarDayShort(day)} ${day.slice(0, 4)}`;
}

/** "7 Ekim 2026, Çarşamba" — çekmece ve gün başlıkları için. */
export function formatCalendarDayLong(day: string) {
  return `${formatCalendarDay(day)}, ${weekdayLabels[weekdayIndex(day)]}`;
}
