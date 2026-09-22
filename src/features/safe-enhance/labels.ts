import type { EnhancementPreset } from "./schemas";

// Kullanıcıya gösterilen Türkçe etiketler. Ham sağlayıcı yükü, model adı veya parametre değerleri
// arayüze taşınmaz; yalnızca ne yapıldığı ve sonucun gerçek bir servisten mi yoksa yerel geliştirme
// işleminden mi geldiği anlatılır.

export const presetLabels: Record<EnhancementPreset, string> = {
  NATURAL: "Doğal",
  BRIGHT: "Aydınlık",
  CLEAN: "Temiz",
  WARM: "Sıcak",
};

export const presetDescriptions: Record<EnhancementPreset, string> = {
  NATURAL: "Çok hafif ışık, kontrast ve netlik toparlama.",
  BRIGHT: "Karanlık çekimler için ölçülü pozlama artışı.",
  CLEAN: "Gürültü ve sıkıştırma izlerini azaltıp netliği toparlar.",
  WARM: "Renk sıcaklığını ve doygunluğu hafifçe yükseltir.",
};

export const enhancementStatusLabels: Record<"PENDING" | "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT", string> = {
  PENDING: "Sürüyor",
  SUCCEEDED: "Hazır",
  FAILED: "Başarısız",
  INVALID_OUTPUT: "Geçersiz çıktı",
};

export const enhancementDecisionLabels: Record<"KEPT" | "DISCARDED", string> = {
  KEPT: "Saklandı",
  DISCARDED: "Atıldı",
};

export const enhancementProvenanceLabels: Record<"REAL" | "DEVELOPMENT", { short: string; long: string }> = {
  REAL: { short: "Görsel işleme servisi", long: "Bu çıktı yapılandırılmış bir görsel işleme sağlayıcısından geldi ve kaydedilmeden önce biçim ve boyut olarak doğrulandı." },
  DEVELOPMENT: { short: "Yerel geliştirme işlemi", long: "Bu çıktı yapay zekâ DEĞİLDİR. Görselin üzerinde, tarayıcıdaki bir fotoğraf uygulamasındaki gibi sabit ışık, kontrast, renk ve netlik ayarları uygulandı; içerik tanınmadı, hiçbir şey eklenmedi veya çıkarılmadı." },
};

export const enhancementErrorCodeLabels: Record<string, string> = {
  PROVIDER_FAILED: "Görsel işleme adımı tamamlanamadı.",
  MEDIA_BYTES_MISSING: "Orijinal görsel dosyasına ulaşılamadı.",
  STORAGE_FAILED: "İyileştirilmiş görsel kaydedilemedi.",
  COMPLETION_PERSIST_FAILED: "İyileştirme sonucu kaydedilemedi; çıktı silindi, orijinal olduğu gibi duruyor.",
  SCHEMA_VALIDATION_FAILED: "İşlem sonucu beklenen biçimde değildi; kaydedilmedi.",
  OUTPUT_NOT_DECODABLE: "Çıktı geçerli bir görsel olarak açılamadı; kaydedilmedi.",
  OUTPUT_FORMAT_MISMATCH: "Çıktının dosya biçimi orijinalden farklıydı; kaydedilmedi.",
  OUTPUT_DIMENSIONS_CHANGED: "Çıktının boyutları orijinalden farklıydı; kaydedilmedi.",
  OUTPUT_TOO_LARGE: "Çıktı izin verilen dosya boyutunu aştı; kaydedilmedi.",
};

/** İnceleme ekranındaki değişmez özgünlük mesajı: ne yapıldığı ve ne yapılmadığı. */
export const authenticityMessage = "Yalnızca ışık, kontrast, renk ve netlik gibi teknik ayarlar uygulandı. Ürün, porsiyon, mekân, kişi veya manzara eklenmedi, çıkarılmadı ya da değiştirilmedi; boyut ve kadraj orijinaliyle aynı.";
