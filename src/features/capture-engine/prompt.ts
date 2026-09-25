import type { ContentType, MediaRequirement, MediaType, SocialPlatform } from "../../../generated/prisma/enums";
import { calendarContentTypeLabels, calendarMediaLabels, calendarPlatformLabels, formatCalendarDayShort, weekdayIndex, weekdayLabels } from "@/features/calendar/labels";

// P5.5B: güncel bir CaptureRequest'i mobil çekim düğmesine çeviren SAF eşleme. Burada yalnızca
// sunum üretilir; hangi etiketin ve medya türünün geçerli olduğuna yükleme sırasında sunucu yine
// CaptureRequest satırından karar verir (bkz. media/service.ts `uploadMediaForCaptureRequest`).

/** Sunucunun kabul ettiği biçimler (media/service.ts) ile aynı; tarayıcıya yalnızca ipucudur. */
export const captureAcceptByMediaType: Record<MediaType, string> = {
  IMAGE: "image/jpeg,image/png,image/webp",
  VIDEO: "video/mp4,video/quicktime,video/webm",
};

export const galleryAccept = `${captureAcceptByMediaType.IMAGE},${captureAcceptByMediaType.VIDEO}`;

export type CapturePrompt = {
  captureRequestId: string;
  mediaType: MediaType;
  mediaRequirement: Exclude<MediaRequirement, "NO_NEW_MEDIA_REQUIRED">;
  /** Ana düğme: "Cuma gönderisi için fotoğraf çek". */
  headline: string;
  /** Mevcut çekim görevi başlığı (sektöre özgü). */
  title: string;
  /** Mevcut, sektöre özgü çekim yönergesi. */
  instructions: string;
  /** "Ürün fotoğrafı · Instagram · 9 Ekim, Cuma 19:30" */
  detail: string;
  actionLabel: "Fotoğraf çek" | "Video çek";
  accept: string;
  /** İşletme-yerel vade günü (YYYY-MM-DD). */
  dueDay: string;
};

export type CapturePromptSource = {
  id: string;
  mediaRequirement: MediaRequirement;
  requestedMediaType: MediaType;
  title: string;
  instructions: string;
  /** İşletme-yerel takvim günü, UTC gece yarısı olarak saklanır. */
  dueAt: Date;
  contentPlanItem: { platform: SocialPlatform; contentType: ContentType; recommendedTime: string };
};

const contentNoun: Record<ContentType, string> = {
  POST: "gönderisi",
  REEL: "dikey videosu",
  STORY: "hikâyesi",
  CAROUSEL: "çoklu gönderisi",
};

export function buildCapturePrompt(request: CapturePromptSource): CapturePrompt | null {
  if (request.mediaRequirement === "NO_NEW_MEDIA_REQUIRED") return null;
  const dueDay = request.dueAt.toISOString().slice(0, 10);
  const weekday = weekdayLabels[weekdayIndex(dueDay)];
  const video = request.requestedMediaType === "VIDEO";
  const item = request.contentPlanItem;
  return {
    captureRequestId: request.id,
    mediaType: request.requestedMediaType,
    mediaRequirement: request.mediaRequirement,
    headline: `${weekday} ${contentNoun[item.contentType]} için ${video ? "video" : "fotoğraf"} çek`,
    title: request.title,
    instructions: request.instructions,
    detail: `${calendarMediaLabels[request.mediaRequirement]} · ${calendarPlatformLabels[item.platform]} ${calendarContentTypeLabels[item.contentType].toLocaleLowerCase("tr-TR")} · ${formatCalendarDayShort(dueDay)}, ${weekday} ${item.recommendedTime}`,
    actionLabel: video ? "Video çek" : "Fotoğraf çek",
    accept: captureAcceptByMediaType[request.requestedMediaType],
    dueDay,
  };
}
