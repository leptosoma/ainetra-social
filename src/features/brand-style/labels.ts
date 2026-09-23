import type { BrandProfileState } from "./profile";
import type { BrandStyleAuthenticityTier, BrandStyleChoice } from "./schemas";

// Kullanıcıya gösterilen Türkçe etiketler. Marka tercihlerinin ham değerleri, iç alan adları,
// parametreler, sağlayıcı yükü veya model adı arayüze taşınmaz; yalnızca ne yapıldığı, neyin
// yapılmadığı ve sonucun nereden geldiği anlatılır.

export const brandStyleChoiceLabels: Record<BrandStyleChoice, string> = {
  BRAND_RECOMMENDED: "Markama göre",
  NATURAL: "Doğal",
  VIBRANT: "Canlı",
  PREMIUM: "Seçkin",
};

export const brandStyleChoiceDescriptions: Record<BrandStyleChoice, string> = {
  BRAND_RECOMMENDED: "Marka profilinizdeki tercihlere göre ölçülü bir ayar.",
  NATURAL: "Fotoğrafı olduğu gibi bırakan, en sade ayar.",
  VIBRANT: "Renkleri ölçülü biçimde öne çıkarır.",
  PREMIUM: "Renkleri öne çıkarmaz; kontrast ve netlik toparlanır.",
};

export const brandProfileStateNotes: Record<BrandProfileState, string | null> = {
  COMPLETE: null,
  INCOMPLETE: "Marka profilinizde belirtilmemiş tercihler dengede kabul edildi.",
  MISSING: "Marka profiliniz henüz doldurulmadı; nötr bir ayar uygulanır.",
};

export const brandStyleStatusLabels: Record<"PENDING" | "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT", string> = {
  PENDING: "Sürüyor",
  SUCCEEDED: "Hazır",
  FAILED: "Başarısız",
  INVALID_OUTPUT: "Geçersiz çıktı",
};

export const brandStyleDecisionLabels: Record<"KEPT" | "DISCARDED", string> = {
  KEPT: "Saklandı",
  DISCARDED: "Atıldı",
};

export const brandStyleProvenanceLabels: Record<"REAL" | "DEVELOPMENT", { short: string; long: string }> = {
  REAL: { short: "Görsel işleme servisi", long: "Bu çıktı yapılandırılmış bir görsel işleme sağlayıcısından geldi ve kaydedilmeden önce biçim ve boyut olarak doğrulandı." },
  DEVELOPMENT: { short: "Yerel geliştirme işlemi", long: "Bu çıktı yapay zekâ DEĞİLDİR. Görselin üzerinde, tarayıcıdaki bir fotoğraf uygulamasındaki gibi sabit ışık, kontrast, renk ve netlik ayarları uygulandı; içerik tanınmadı, hiçbir şey eklenmedi veya çıkarılmadı." },
};

export const brandStyleErrorCodeLabels: Record<string, string> = {
  PROVIDER_FAILED: "Görsel işleme adımı tamamlanamadı.",
  MEDIA_BYTES_MISSING: "Kaynak görsel dosyasına ulaşılamadı.",
  STORAGE_FAILED: "Markaya göre düzenlenmiş görsel kaydedilemedi.",
  COMPLETION_PERSIST_FAILED: "Sonuç kaydedilemedi; çıktı silindi, kaynak olduğu gibi duruyor.",
  SCHEMA_VALIDATION_FAILED: "İşlem sonucu beklenen biçimde değildi; kaydedilmedi.",
  OUTPUT_NOT_DECODABLE: "Çıktı geçerli bir görsel olarak açılamadı; kaydedilmedi.",
  OUTPUT_FORMAT_MISMATCH: "Çıktının dosya biçimi kaynaktan farklıydı; kaydedilmedi.",
  OUTPUT_DIMENSIONS_CHANGED: "Çıktının boyutları kaynaktan farklıydı; kaydedilmedi.",
  OUTPUT_TOO_LARGE: "Çıktı izin verilen dosya boyutunu aştı; kaydedilmedi.",
};

/** İnceleme ekranındaki değişmez özgünlük mesajı: ne yapıldığı ve ne yapılmadığı. */
export const brandStyleAuthenticityMessage = "Markanıza göre yalnızca ışık, kontrast, renk ve netlik gibi teknik ayarlar ölçülü biçimde uygulandı. Ürün, porsiyon, mekân, kişi veya manzara eklenmedi, çıkarılmadı ya da değiştirilmedi; ürün rengi kaydırılmadı, boyut ve kadraj kaynağıyla aynı.";

export const brandStyleTierNotes: Record<BrandStyleAuthenticityTier, string> = {
  RELAXED: "Bu görsel gerçek bir ürün, mekân veya kişiyi belgelemediği için stil ayarları normal sınırda uygulandı.",
  STANDARD: "Bu gerçek bir işletme fotoğrafı olduğundan stil ayarları dar tutuldu.",
  STRICT: "Görselde gerçek ürün veya kişi görünümü olduğundan (ya da içerik doğrulanmadığından) stil ayarları en dar sınırda uygulandı; marka tercihiniz bu sınırı genişletemez.",
};
