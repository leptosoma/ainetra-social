import { z } from "zod";
import { safeEnhanceOperationsSchema, type SafeEnhanceOperations } from "@/features/safe-enhance/schemas";

// P5-03 Marka Stili sözleşmesi. Ayrı bir dönüştürme yığını kurulmaz: operasyon kümesi P5-02'nin kapalı
// piksel sözleşmesinin ta kendisidir (aynı alanlar, aynı sağlayıcı sınırı). Marka Stili bu sözleşmenin
// üzerine yalnızca DAHA DAR sınırlar koyar; nesne/sahne/üretken bir işlem burada da ifade edilemez.
//
// Özgünlük katmanı (tier) stil tercihinin üstündedir: gerçek ürün/kişi görünümü belgeleyen ya da
// doğrulanamamış görsellerde sınırlar en dar seviyeye iner ve stil isteği bu sınırı genişletemez.

export const BRAND_STYLE_VERSION = "brand-style-v1";

export const brandStyleChoices = ["BRAND_RECOMMENDED", "NATURAL", "VIBRANT", "PREMIUM"] as const;
export type BrandStyleChoice = typeof brandStyleChoices[number];

/** "Markama göre" dışındaki sabit alternatifler. */
export const brandStyleAlternatives = ["NATURAL", "VIBRANT", "PREMIUM"] as const;
export type BrandStyleAlternative = typeof brandStyleAlternatives[number];

export const brandStyleAuthenticityTiers = ["RELAXED", "STANDARD", "STRICT"] as const;
export type BrandStyleAuthenticityTier = typeof brandStyleAuthenticityTiers[number];

export type BrandStyleOperations = SafeEnhanceOperations;

type Bound = readonly [number, number];
type TierBounds = { brightness: Bound; contrast: Bound; saturation: Bound; warmth: Bound; sharpen: Bound; denoise: boolean };

/**
 * Her katmanın izin verdiği aralık. Hepsi P5-02 sınırlarının içindedir; STRICT'te renk ve sıcaklık
 * neredeyse nötr kalır, çünkü ürün/kişi rengi olgusal bir bilgidir ve stil uğruna kaydırılamaz.
 * `denoise` STRICT'te kapalıdır: medyan filtre gerçek dokuyu (ör. yemek yüzeyi) yumuşatabilir.
 */
const tierBounds: Record<BrandStyleAuthenticityTier, TierBounds> = {
  RELAXED: { brightness: [0.92, 1.12], contrast: [0.95, 1.12], saturation: [0.9, 1.12], warmth: [-0.05, 0.05], sharpen: [0, 1.2], denoise: true },
  STANDARD: { brightness: [0.95, 1.08], contrast: [0.96, 1.06], saturation: [0.94, 1.06], warmth: [-0.03, 0.03], sharpen: [0, 1], denoise: true },
  STRICT: { brightness: [0.97, 1.05], contrast: [0.98, 1.05], saturation: [0.97, 1.04], warmth: [-0.02, 0.02], sharpen: [0, 0.8], denoise: false },
};

export function brandStyleBounds(tier: BrandStyleAuthenticityTier): TierBounds {
  return tierBounds[tier];
}

/**
 * Katmana göre daraltılmış operasyon şeması. Son adımda P5-02 sözleşmesine `pipe` edilir: Marka Stili
 * çıktısı her zaman Güvenli İyileştirme'nin kapalı kümesini de sağlamak zorundadır.
 */
export function brandStyleOperationsSchema(tier: BrandStyleAuthenticityTier) {
  const bounds = tierBounds[tier];
  return z
    .strictObject({
      brightness: z.number().min(bounds.brightness[0]).max(bounds.brightness[1]),
      contrast: z.number().min(bounds.contrast[0]).max(bounds.contrast[1]),
      saturation: z.number().min(bounds.saturation[0]).max(bounds.saturation[1]),
      warmth: z.number().min(bounds.warmth[0]).max(bounds.warmth[1]),
      sharpen: z.number().min(bounds.sharpen[0]).max(bounds.sharpen[1]),
      denoise: bounds.denoise ? z.boolean() : z.literal(false),
    })
    .pipe(safeEnhanceOperationsSchema);
}

/** Kayda geçen marka tercihi anlık görüntüsü. Ham değerler yalnızca kanıt olarak saklanır, arayüze taşınmaz. */
export const brandStyleProfileSnapshotSchema = z.object({
  profileVersion: z.string().min(1).max(60),
  available: z.boolean(),
  complete: z.boolean(),
  nearestStyle: z.enum(brandStyleAlternatives),
  tones: z.record(z.string(), z.number()),
});

export type BrandStyleProfileSnapshot = z.infer<typeof brandStyleProfileSnapshotSchema>;
