// P6-03: kullanıcıya gösterilen kapalı yayın durumu ve hata metinleri. Sağlayıcı kimliği, Graph terimi veya
// ham sağlayıcı mesajı içermez; istemci bileşenlerinde de güvenle kullanılabilir.

export type PublishStatusLabelKey = "READY" | "IN_FLIGHT" | "PUBLISHED" | "UNKNOWN" | "RETRY_WAIT" | "FAILED" | "INVALIDATED" | "CANCELLED";

export const PUBLISH_STATUS_LABELS: Record<PublishStatusLabelKey, string> = {
  READY: "Yayına hazır",
  IN_FLIGHT: "Yayınlanıyor",
  PUBLISHED: "Yayınlandı",
  UNKNOWN: "Durum doğrulanmalı",
  RETRY_WAIT: "Yayınlanamadı, yeniden denenebilir",
  FAILED: "Yayınlanamadı",
  INVALIDATED: "Plan geçersiz",
  CANCELLED: "İptal edildi",
};

export const PUBLISH_STATUS_HINTS: Partial<Record<PublishStatusLabelKey, string>> = {
  UNKNOWN: "Meta yanıtı kesinleşmedi. Gönderi yayınlanmış olabilir; tekrar yayınlamadan önce hesabınızı kontrol edin.",
  RETRY_WAIT: "Meta gönderiyi kabul etmedi; yayınlanmadı. Yeniden deneyebilirsiniz.",
  FAILED: "Meta gönderiyi kalıcı olarak reddetti veya içerik desteklenmiyor.",
};

/** IN_FLIGHT kiralaması dolmuşsa kullanıcıya "Yayınlanıyor" değil "Durum doğrulanmalı" gösterilir. */
export function publishStatusLabelKey(intent: { state: string; leaseExpiresAt: Date | null } | null, now = new Date()): PublishStatusLabelKey {
  if (!intent || intent.state === "PENDING") return "READY";
  if (intent.state === "IN_FLIGHT" && intent.leaseExpiresAt && intent.leaseExpiresAt <= now) return "UNKNOWN";
  return intent.state as PublishStatusLabelKey;
}

export const PUBLISH_NOW_ERROR_CODES = [
  "NOT_DUE",
  "NOT_PUBLISHABLE",
  "ACCOUNT_NOT_CONNECTED",
  "PUBLISH_PERMISSION_MISSING",
  "PAGE_TASK_MISSING",
  "MEDIA_INVALID",
  "NOT_CONFIGURED",
  "PROVIDER_UNAVAILABLE",
  "FORBIDDEN",
  "ACTION_FAILED",
] as const;

export type PublishNowErrorCode = (typeof PUBLISH_NOW_ERROR_CODES)[number];

export function isPublishNowErrorCode(value: unknown): value is PublishNowErrorCode {
  return typeof value === "string" && (PUBLISH_NOW_ERROR_CODES as readonly string[]).includes(value);
}

export const PUBLISH_NOW_MESSAGES: Record<PublishNowErrorCode, string> = {
  NOT_DUE: "Planlanan yayın zamanı henüz gelmedi. Gelecekteki planlar bu düğmeyle erken yayınlanmaz.",
  NOT_PUBLISHABLE: "Yalnızca güncel sürümü onaylanmış ve planlı içerik yayınlanabilir.",
  ACCOUNT_NOT_CONNECTED: "Sosyal hesabın Meta bağlantısı geçerli değil. Ayarlardan hesabı yeniden bağlayın.",
  PUBLISH_PERMISSION_MISSING: "Bu hesap için Meta yayın izni verilmemiş. Ayarlar > Kanallar'dan yayın izni verin.",
  PAGE_TASK_MISSING: "Bu Facebook sayfasında içerik oluşturma yetkiniz yok.",
  MEDIA_INVALID: "Onaylı içeriğin medyası bulunamadı veya bu işletmeye ait değil.",
  NOT_CONFIGURED: "Meta yayını bu ortamda henüz yapılandırılmamış.",
  PROVIDER_UNAVAILABLE: "Meta şu anda yanıt vermiyor; hiçbir şey gönderilmedi. Lütfen daha sonra yeniden deneyin.",
  FORBIDDEN: "Bu işletme için yetkiniz yok.",
  ACTION_FAILED: "Yayın başlatılamadı. Lütfen yeniden deneyin.",
};
