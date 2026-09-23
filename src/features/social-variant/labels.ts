import type { SocialVariantFit, SocialVariantFormat } from "./schemas";

// Kullanıcıya gösterilen Türkçe etiketler. Kural anahtarları, geometri parametreleri, sağlayıcı yükü
// veya model adı arayüze taşınmaz; yalnızca ne yapıldığı, neyin yapılmadığı ve sonucun nereden
// geldiği anlatılır.

export const socialVariantFormatLabels: Record<SocialVariantFormat, string> = {
  FEED: "Akış gönderisi",
  STORY: "Hikâye",
  REEL_COVER: "Reel kapağı",
  SQUARE: "Kare",
};

export const socialVariantFormatDescriptions: Record<SocialVariantFormat, string> = {
  FEED: "Profil akışındaki gönderi için.",
  STORY: "Tam ekran hikâye için.",
  REEL_COVER: "Reel kapak görseli için.",
  SQUARE: "Kare kullanım için.",
};

export const socialVariantPlatformLabels: Record<"INSTAGRAM" | "FACEBOOK" | "TIKTOK", string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
};

export const socialVariantStatusLabels: Record<"PENDING" | "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT", string> = {
  PENDING: "Hazırlanıyor",
  SUCCEEDED: "Hazır",
  FAILED: "Başarısız",
  INVALID_OUTPUT: "Geçersiz çıktı",
};

export const socialVariantDecisionLabels: Record<"KEPT" | "DISCARDED", string> = {
  KEPT: "Saklandı",
  DISCARDED: "Atıldı",
};

export const socialVariantProvenanceLabels: Record<"REAL" | "DEVELOPMENT", { short: string; long: string }> = {
  REAL: { short: "Görsel işleme servisi", long: "Bu sürüm yapılandırılmış bir görsel işleme sağlayıcısında hazırlandı ve kaydedilmeden önce biçim ve boyut olarak doğrulandı." },
  DEVELOPMENT: { short: "Yerel geliştirme işlemi", long: "Bu sürüm yapay zekâ DEĞİLDİR. Fotoğraf yalnızca merkezden, sabit bir geometriyle yeniden çerçevelendi; görselde ne olduğu tanınmadı, hiçbir şey eklenmedi veya çıkarılmadı." },
};

export const socialVariantFitNotes: Record<SocialVariantFit, string> = {
  COVER: "Hedef orana ulaşmak için kenarlardan az miktarda kırpıldı. Kırpma merkezden ve sabittir; görseldeki konu tanınmaz, bu yüzden sonucu kendiniz görmelisiniz.",
  CONTAIN: "Güvenli bir kırpma kurulamadı; önemli bir öğeyi kesmemek için fotoğrafın tamamı korundu ve boşluklar marka tercihlerinizden türetilen düz bir renkle dolduruldu.",
};

/** İnceleme ekranındaki değişmez özgünlük mesajı: teknik türev, kaynağı kadar gerçektir. */
export const socialVariantAuthenticityMessage = "Bu teknik bir format sürümüdür: fotoğraf yalnızca yeniden çerçevelendi. Ürün, porsiyon, mekân, kişi veya manzara eklenmedi, çıkarılmadı ya da değiştirilmedi; ışık ve renk kaynağıyla aynı. Kaynak gerçek bir işletme fotoğrafıysa bu sürüm de gerçek bir işletme fotoğrafıdır.";

/** Formatın hangi kuraldan geldiğini açıklarken kullanılan kaynak dili. */
export const socialVariantRecommendationTypeLabels: Record<"TECHNICAL_REQUIREMENT" | "BEST_PRACTICE" | "GENERAL_RECOMMENDATION" | "BUSINESS_LEARNED", string> = {
  TECHNICAL_REQUIREMENT: "Platformun teknik gereksinimi",
  BEST_PRACTICE: "Platformun resmi önerisi",
  GENERAL_RECOMMENDATION: "Ainetra önerisi",
  BUSINESS_LEARNED: "İşletmenizin verisinden öğrenilen öneri",
};

export const socialVariantErrorCodeLabels: Record<string, string> = {
  PROVIDER_FAILED: "Yeniden çerçeveleme adımı tamamlanamadı.",
  MEDIA_BYTES_MISSING: "Kaynak görsel dosyasına ulaşılamadı.",
  STORAGE_FAILED: "Format sürümü kaydedilemedi.",
  COMPLETION_PERSIST_FAILED: "Sonuç kaydedilemedi; çıktı silindi, kaynak olduğu gibi duruyor.",
  SCHEMA_VALIDATION_FAILED: "İşlem sonucu beklenen biçimde değildi; kaydedilmedi.",
  OUTPUT_NOT_DECODABLE: "Çıktı geçerli bir görsel olarak açılamadı; kaydedilmedi.",
  OUTPUT_FORMAT_MISMATCH: "Çıktının dosya biçimi kaynaktan farklıydı; kaydedilmedi.",
  OUTPUT_DIMENSIONS_UNEXPECTED: "Çıktının boyutları istenen formatla uyuşmadı; kaydedilmedi.",
  OUTPUT_TOO_LARGE: "Çıktı izin verilen dosya boyutunu aştı; kaydedilmedi.",
};
