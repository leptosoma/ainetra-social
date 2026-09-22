import type { VisualAnalysisResult } from "./schemas";

// Kullanıcıya gösterilen Türkçe etiketler. Ham sağlayıcı/model adı arayüze taşınmaz;
// yalnızca "gerçek AI analizi" ile "geliştirme analizi" ayrımı gösterilir.

export const categoryLabels: Record<VisualAnalysisResult["category"], string> = {
  FOOD: "Yemek",
  DRINK: "İçecek",
  INTERIOR: "İç mekân",
  EXTERIOR: "Dış mekân",
  PEOPLE: "Kişiler",
  TEAM: "Ekip",
  PRODUCT: "Ürün",
  SERVICE: "Hizmet",
  EVENT: "Etkinlik",
  GRAPHIC: "Tasarım görseli",
  OTHER: "Diğer",
  UNKNOWN: "Belirlenemedi",
};

export const imageKindLabels: Record<VisualAnalysisResult["imageKind"], string> = { PHOTO: "Fotoğraf", GRAPHIC: "Tasarım / grafik", UNKNOWN: "Belirlenemedi" };
export const orientationLabels: Record<VisualAnalysisResult["orientation"], string> = { PORTRAIT: "Dikey", LANDSCAPE: "Yatay", SQUARE: "Kare" };
export const qualityLabels: Record<VisualAnalysisResult["quality"]["overall"], string> = { LOW: "Düşük", MEDIUM: "Orta", GOOD: "İyi" };
export const resolutionLabels: Record<VisualAnalysisResult["quality"]["resolution"], string> = { LOW: "Düşük", MEDIUM: "Orta", HIGH: "Yüksek" };
export const sharpnessLabels: Record<VisualAnalysisResult["quality"]["sharpness"], string> = { SOFT: "Yumuşak / bulanık", ACCEPTABLE: "Kabul edilebilir", SHARP: "Net", UNKNOWN: "Ölçülemedi" };
export const lightingLabels: Record<VisualAnalysisResult["observations"]["lighting"], string> = { DARK: "Yetersiz ışık", BALANCED: "Dengeli", BRIGHT: "Fazla parlak", UNKNOWN: "Ölçülemedi" };
export const framingLabels: Record<VisualAnalysisResult["observations"]["framing"], string> = { TIGHT: "Dar kadraj", BALANCED: "Dengeli kadraj", WIDE: "Geniş kadraj", UNKNOWN: "Değerlendirilemedi" };
export const backgroundLabels: Record<VisualAnalysisResult["observations"]["background"], string> = { CLEAN: "Sade arka plan", BUSY: "Kalabalık arka plan", UNKNOWN: "Değerlendirilemedi" };
export const fitLabels: Record<VisualAnalysisResult["platformFit"][number]["fit"], string> = { FIT: "Uygun", CROP_NEEDED: "Kırpma gerekir" };
export const platformLabels: Record<VisualAnalysisResult["platformFit"][number]["platform"], string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TIKTOK: "TikTok" };
export const contentTypeLabels: Record<NonNullable<VisualAnalysisResult["platformFit"][number]["contentType"]>, string> = { POST: "Gönderi", REEL: "Reel", STORY: "Hikâye", CAROUSEL: "Carousel" };
export const recommendationTypeLabels: Record<VisualAnalysisResult["platformFit"][number]["recommendationType"], string> = {
  TECHNICAL_REQUIREMENT: "Teknik gereklilik",
  BEST_PRACTICE: "Platform önerisi",
  GENERAL_RECOMMENDATION: "Ainetra önerisi",
  BUSINESS_LEARNED: "İşletme verisi",
};

export const actionLabels: Record<VisualAnalysisResult["recommendedAction"], string> = {
  USE_AS_IS: "Olduğu gibi kullanılabilir",
  SAFE_ENHANCE_CANDIDATE: "İyileştirme adayı",
  CROP_FOR_PLATFORM: "Platforma göre kırpma gerekir",
  RECAPTURE: "Yeniden çekim önerilir",
  REVIEW_MANUALLY: "Elle kontrol edin",
};

export const provenanceLabels: Record<"REAL" | "DEVELOPMENT", { short: string; long: string }> = {
  REAL: { short: "Yapay zekâ analizi", long: "Bu sonuç yapılandırılmış bir görsel analiz sağlayıcısından geldi ve Ainetra kurallarıyla doğrulandı." },
  DEVELOPMENT: { short: "Geliştirme analizi", long: "Bu sonuç gerçek yapay zekâ analizi DEĞİLDİR. Görsel içerik tanınmadı; yalnızca boyut, ışık/netlik ölçümleri ve planlama etiketleri kullanıldı." },
};

export const statusLabels: Record<"PENDING" | "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT", string> = {
  PENDING: "Sürüyor",
  SUCCEEDED: "Tamamlandı",
  FAILED: "Başarısız",
  INVALID_OUTPUT: "Geçersiz sonuç",
};

export const errorCodeLabels: Record<string, string> = {
  PROVIDER_FAILED: "Analiz servisi yanıt vermedi.",
  MEDIA_BYTES_MISSING: "Görsel dosyasına ulaşılamadı.",
  SCHEMA_VALIDATION_FAILED: "Analiz sonucu beklenen biçimde değildi; kaydedilmedi.",
  RESULT_VALIDATION_FAILED: "Analiz sonucu doğrulanamadı; kaydedilmedi.",
};
