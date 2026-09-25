// P6-02: kullanıcıya gösterilen kapalı hata/durum metinleri. Graph terimi, sağlayıcı kimliği veya ham
// sağlayıcı mesajı içermez; istemci bileşenlerinde de güvenle kullanılabilir.

export const META_FAILURE_CODES = [
  "NOT_CONFIGURED",
  "FORBIDDEN",
  "INVALID_STATE",
  "STATE_EXPIRED",
  "SESSION_MISMATCH",
  "PROVIDER_DENIED",
  "TOKEN_EXCHANGE_FAILED",
  "TOKEN_INVALID",
  "MISSING_PERMISSIONS",
  "NO_PAGES",
  "NO_ELIGIBLE_ASSETS",
  "RECONNECT_ASSET_UNAVAILABLE",
  "SELECTION_EXPIRED",
  "SELECTION_INVALID",
  "ASSET_VALIDATION_FAILED",
  "ASSET_OWNED_BY_OTHER_BUSINESS",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "ACTION_FAILED",
] as const;

export type MetaFailureCode = (typeof META_FAILURE_CODES)[number];

export function isMetaFailureCode(value: unknown): value is MetaFailureCode {
  return typeof value === "string" && (META_FAILURE_CODES as readonly string[]).includes(value);
}

export const META_FAILURE_MESSAGES: Record<MetaFailureCode, string> = {
  NOT_CONFIGURED: "Meta bağlantısı bu ortamda henüz yapılandırılmamış.",
  FORBIDDEN: "Hesap bağlantılarını yalnızca işletme sahibi değiştirebilir.",
  INVALID_STATE: "Bağlantı isteği geçersiz ya da zaten kullanılmış. Lütfen yeniden bağlanmayı deneyin.",
  STATE_EXPIRED: "Bağlantı isteğinin süresi doldu. Lütfen yeniden bağlanmayı deneyin.",
  SESSION_MISMATCH: "Bağlantı bu oturumda başlatılmamış. Lütfen oturum açıp yeniden deneyin.",
  PROVIDER_DENIED: "Meta izni verilmedi. Hazır olduğunuzda yeniden bağlanabilirsiniz.",
  TOKEN_EXCHANGE_FAILED: "Meta bağlantısı tamamlanamadı. Lütfen yeniden deneyin.",
  TOKEN_INVALID: "Meta yetkisi doğrulanamadı. Lütfen yeniden bağlanın.",
  MISSING_PERMISSIONS: "Gerekli Meta izinlerinin tamamı verilmedi. Yeniden bağlanırken tüm izinleri onaylayın.",
  NO_PAGES: "Bu Meta kullanıcısının yönettiği bir Facebook sayfası bulunamadı.",
  NO_ELIGIBLE_ASSETS: "Bağlanabilecek uygun bir Facebook sayfası ya da profesyonel Instagram hesabı bulunamadı.",
  RECONNECT_ASSET_UNAVAILABLE: "Yeniden bağlanmak istediğiniz hesap bu Meta kullanıcısıyla erişilebilir değil.",
  SELECTION_EXPIRED: "Hesap seçiminin süresi doldu. Lütfen yeniden bağlanmayı deneyin.",
  SELECTION_INVALID: "Seçim geçersiz. Lütfen yeniden bağlanmayı deneyin.",
  ASSET_VALIDATION_FAILED: "Seçilen hesap Meta tarafından doğrulanamadı; hiçbir hesap bağlanmadı.",
  ASSET_OWNED_BY_OTHER_BUSINESS: "Seçilen hesap başka bir işletmeye bağlı. Hiçbir hesap bağlanmadı.",
  PROVIDER_UNAVAILABLE: "Meta şu anda yanıt vermiyor. Hiçbir hesap bağlanmadı; lütfen daha sonra yeniden deneyin.",
  RATE_LIMITED: "Bir saat içinde en fazla 10 Meta bağlantı denemesi yapılabilir.",
  ACTION_FAILED: "İşlem tamamlanamadı. Lütfen yeniden deneyin.",
};

export const META_NOTICES = {
  CONNECTED: "Seçilen hesaplar bağlandı.",
  DISCONNECTED: "Hesabın bağlantısı kesildi; Ainetra'daki erişim bilgisi silindi. Meta tarafındaki uygulama iznini Facebook ayarlarından kaldırabilirsiniz.",
  VALIDATED: "Bağlantı Meta ile doğrulandı.",
  REAUTH_REQUIRED: "Meta erişimi artık geçerli değil; hesabı yeniden bağlayın.",
  CANCELLED: "Hesap seçimi iptal edildi; hiçbir hesap bağlanmadı.",
} as const;

export type MetaNotice = keyof typeof META_NOTICES;

export function isMetaNotice(value: unknown): value is MetaNotice {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(META_NOTICES, value);
}

export const META_INELIGIBILITY_MESSAGES = {
  MISSING_PAGE_TASKS: "Bu sayfada yeterli yetkiniz yok.",
  NO_PAGE_CREDENTIAL: "Meta bu sayfa için erişim vermedi.",
  INSTAGRAM_UNAVAILABLE: "Bağlı Instagram hesabı doğrulanamadı (profesyonel hesap olmalı).",
} as const;

export type MetaIneligibilityReason = keyof typeof META_INELIGIBILITY_MESSAGES;

export type MetaAccountConnectionState = "CONNECTED" | "REAUTH_REQUIRED" | "DISCONNECTED" | "NOT_LINKED";

export const META_ACCOUNT_STATE_LABELS: Record<MetaAccountConnectionState, string> = {
  CONNECTED: "Bağlı",
  REAUTH_REQUIRED: "Yeniden yetki gerekli",
  DISCONNECTED: "Bağlı değil",
  NOT_LINKED: "Gerçek bağlantı yok",
};
