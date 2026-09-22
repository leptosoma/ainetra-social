import sharp from "sharp";
import type { ProviderOutput } from "../schemas";
import type { ImageAnalysisProvider, ImageAnalysisProviderInput } from "./types";

// GELİŞTİRME SAĞLAYICISI — gerçek görsel tanıma DEĞİLDİR.
// Yapılandırılmış bir görsel analiz servisi olmadığında kullanılır. Yalnızca ölçülebilir piksel
// istatistiklerini (ortalama parlaklık, netlik kestirimi) ve kullanıcının planlama etiketlerini
// kullanır; görüntüdeki nesneleri/kişileri tanımaz. İçerik sınıfı (imageKind/category) yalnızca
// tek bir planlama etiketinden türetilir; etiket yoksa UNKNOWN kalır. Piksel istatistiklerinden
// (ör. düşük ton çeşitliliği) GRAFİK çıkarımı yapılmaz: düz arka planlı gerçek bir ürün fotoğrafı
// aksi halde "tasarım görseli" sayılıp otantiklik hassasiyeti yanlışlıkla kapanırdı. CUSTOM_GRAPHIC
// etiketi de yalnızca sınıflandırma bağlamıdır: görselde gerçek ürün/mekân/kişi olmadığını kanıtlamaz;
// otantiklik gevşetmesi provenance üzerinden serviste engellenir (normalize.ts). Kategori güveni
// düşük tutulur ve provenance DEVELOPMENT olarak kayda geçer.

const tagCategory: Record<string, { category: ProviderOutput["category"]; subject: string; imageKind: ProviderOutput["imageKind"] }> = {
  PHOTO_PRODUCT: { category: "PRODUCT", subject: "Ürün (planlama etiketinden)", imageKind: "PHOTO" },
  PHOTO_ATMOSPHERE: { category: "INTERIOR", subject: "Mekân atmosferi (planlama etiketinden)", imageKind: "PHOTO" },
  PHOTO_PEOPLE: { category: "PEOPLE", subject: "Kişiler (planlama etiketinden)", imageKind: "PHOTO" },
  CUSTOM_GRAPHIC: { category: "GRAPHIC", subject: "Tasarım görseli (planlama etiketinden)", imageKind: "GRAPHIC" },
};

function lightingFor(luminance: number): ProviderOutput["lighting"] {
  if (luminance < 60) return "DARK";
  if (luminance > 195) return "BRIGHT";
  return "BALANCED";
}

function sharpnessFor(value: number): ProviderOutput["sharpness"] {
  if (value < 0.5) return "SOFT";
  if (value < 3) return "ACCEPTABLE";
  return "SHARP";
}

export class DevelopmentImageAnalysisProvider implements ImageAnalysisProvider {
  readonly provider = "development-pixel-stats";
  readonly model = "none";
  readonly provenance = "DEVELOPMENT" as const;

  async analyze(input: ImageAnalysisProviderInput): Promise<unknown> {
    const stats = await sharp(input.bytes).stats();
    const rgb = stats.channels.slice(0, 3);
    const luminance = rgb.reduce((sum, channel) => sum + channel.mean, 0) / Math.max(rgb.length, 1);
    const knownTags = input.planningTags.filter((tag) => tag in tagCategory);
    const single = knownTags.length === 1 ? tagCategory[knownTags[0]] : null;
    const output: ProviderOutput = {
      imageKind: single?.imageKind ?? "UNKNOWN",
      dominantSubject: single?.subject ?? "Belirlenemedi",
      category: single?.category ?? "UNKNOWN",
      confidence: single ? 0.35 : 0,
      lighting: lightingFor(luminance),
      framing: "UNKNOWN",
      background: "UNKNOWN",
      sharpness: sharpnessFor(stats.sharpness),
      peopleVisible: null,
      notes: [
        single
          ? "Kategori, görüntü tanınarak değil planlama etiketinden türetildi."
          : knownTags.length > 1
            ? "Birden fazla planlama etiketi var; kategori belirlenemedi."
            : "Planlama etiketi yok; görüntü içeriği tanınmadı.",
        "Işık ve netlik değerleri piksel istatistiklerinden kestirildi.",
      ],
    };
    return output;
  }
}
