import type { CreativeCategory } from "./schemas";

// Kullanıcıya gösterilen Türkçe etiketler. En önemli iş burada yapılır: tasarım ile gerçek fotoğraf
// arasındaki fark her ekranda açıkça söylenir ve yerel şablon işi asla üretken yapay zekâ gibi
// sunulmaz.

export const creativeCategoryLabels: Record<CreativeCategory, string> = {
  BUSINESS_INTRO: "İşletme tanıtımı",
  PRODUCTS_SERVICES: "Ürün ve hizmet bilgisi",
  LOCATION_INFO: "Konum bilgisi",
  CONFIRMED_FACTS: "Onaylı işletme bilgisi",
};

export const creativeStatusLabels: Record<"PENDING" | "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT", string> = {
  PENDING: "Hazırlanıyor",
  SUCCEEDED: "Hazır",
  FAILED: "Başarısız",
  INVALID_OUTPUT: "Geçersiz çıktı",
};

export const creativeDecisionLabels: Record<"KEPT" | "DISCARDED", string> = {
  KEPT: "Saklandı",
  DISCARDED: "Atıldı",
};

export const creativeProvenanceLabels: Record<"REAL" | "DEVELOPMENT", { short: string; long: string }> = {
  REAL: { short: "Kreatif üretim servisi", long: "Bu tasarım yapılandırılmış bir kreatif üretim sağlayıcısında hazırlandı ve kaydedilmeden önce biçim ve boyut olarak doğrulandı." },
  DEVELOPMENT: { short: "Yerel şablon çalışması", long: "Bu tasarım yapay zekâ ile ÜRETİLMEDİ. Onayladığınız bilgi metinleri, marka tercihlerinizden türetilen renklerle sabit bir yerleşime yerleştirildi; hiçbir cümle, ürün, sahne veya görsel öğe üretilmedi." },
};

/** Her kreatif ekranında ve her kayıtta tekrarlanan, değişmez tasarım/gerçeklik ayrımı. */
export const creativeDesignDisclaimer = "Bu bir TASARIM görselidir; gerçek ürün, ekip, mekân veya hizmet fotoğrafı değildir. Bu yüzden gerçek fotoğraf isteyen bir içerik ihtiyacının yerine geçemez.";

/** Olgu politikasının kullanıcıya söylenen hâli. */
export const creativeFactPolicyMessage = "Tasarımdaki her satır, Business Brain'de onayladığınız bilgilerden birebir alınır. Kampanya, indirim, fiyat, ürün, hizmet, etkinlik, çalışma saati, yorum veya uygunluk bilgisi üretilmez; bilgi eksikse tasarım hazırlanmaz.";

/** Renk kümesinin nereden geldiği; ölçülmüş bir marka rengi iddiası yapılmaz. */
export const creativePaletteNote = "Renkler marka profilinizdeki tercihlerinizden türetildi; kayıtlı bir kurumsal renk kodunuz kullanılmadı.";

/**
 * Arka plan seçiminde gösterilen köken adları. Yalnızca kabul edilmiş gerçek medya ve onun teknik
 * türevleri arka plan olabilir; başka bir tasarım kreatifi listeye hiç girmez.
 */
export const creativeBackgroundOriginLabels: Record<string, string> = {
  UPLOAD: "Yüklenen fotoğraf",
  SAFE_ENHANCE: "Güvenli iyileştirilmiş sürüm",
  BRAND_STYLE: "Markaya göre düzenlenmiş sürüm",
  SOCIAL_VARIANT: "Sosyal format sürümü",
};

/** Arka plansız seçenek: tasarım yalnızca marka renkleriyle basılır. */
export const creativeNoBackgroundLabel = "Arka plan kullanma — yalnızca marka renkleri";

export const creativeBackgroundNote = "Seçtiğiniz gerçek görsel yalnızca arka plan olarak kırpıldı ve karartıldı; üzerine tasarım katmanı eklendiği için sonuç yine tasarım sayılır ve kaynağı olduğu gibi durur.";

export const creativeErrorCodeLabels: Record<string, string> = {
  PROVIDER_FAILED: "Tasarım adımı tamamlanamadı.",
  MEDIA_BYTES_MISSING: "Arka plan olarak seçilen görsel dosyasına ulaşılamadı.",
  STORAGE_FAILED: "Tasarım kaydedilemedi.",
  COMPLETION_PERSIST_FAILED: "Sonuç kaydedilemedi; çıktı silindi, kullanılan görsel olduğu gibi duruyor.",
  SCHEMA_VALIDATION_FAILED: "İşlem sonucu beklenen biçimde değildi; kaydedilmedi.",
  OUTPUT_NOT_DECODABLE: "Çıktı geçerli bir görsel olarak açılamadı; kaydedilmedi.",
  OUTPUT_FORMAT_MISMATCH: "Çıktının dosya biçimi beklenenden farklıydı; kaydedilmedi.",
  OUTPUT_DIMENSIONS_UNEXPECTED: "Çıktının boyutları istenen formatla uyuşmadı; kaydedilmedi.",
  OUTPUT_TOO_LARGE: "Çıktı izin verilen dosya boyutunu aştı; kaydedilmedi.",
};
