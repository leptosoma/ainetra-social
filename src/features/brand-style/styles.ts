import { DomainError } from "@/lib/domain-error";
import type { BrandVisualStyleProfile } from "./profile";
import {
  brandStyleBounds,
  brandStyleOperationsSchema,
  type BrandStyleAlternative,
  type BrandStyleAuthenticityTier,
  type BrandStyleChoice,
  type BrandStyleOperations,
} from "./schemas";

// Stil seçimi → sınırlandırılmış piksel ayarları. İki kural birlikte işler:
// 1) Stil yalnızca ışık, kontrast, renk ve netlik ayarıdır; başka bir şey ifade edilemez.
// 2) Özgünlük katmanı stilin üstündedir: türetilen değerler önce katman sınırına kısılır (clamp),
//    sonra hem Marka Stili hem de P5-02 sözleşmesine göre doğrulanır. Sözleşmeye sığmayan bir istek
//    kısılarak "geçirilmez"; sığdırılamıyorsa reddedilir.

/** Sabit, ölçülü alternatifler. Hiçbiri özgünlük katmanının sınırlarını genişletemez. */
const fixedStyles: Record<BrandStyleAlternative, BrandStyleOperations> = {
  NATURAL: { brightness: 1.01, contrast: 1.02, saturation: 1, warmth: 0.01, sharpen: 0.7, denoise: false },
  VIBRANT: { brightness: 1.03, contrast: 1.06, saturation: 1.08, warmth: 0.02, sharpen: 0.9, denoise: false },
  PREMIUM: { brightness: 0.99, contrast: 1.07, saturation: 0.95, warmth: -0.02, sharpen: 1, denoise: true },
};

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, [min, max]: readonly [number, number]) {
  return round(Math.min(max, Math.max(min, value)));
}

/** Marka tercihlerinden sürekli (kademesiz) türetim: her eksen küçük ve tek bir ayarı etkiler. */
function recommendedOperations(profile: BrandVisualStyleProfile): BrandStyleOperations {
  const { corporateFriendly, minimalVibrant, luxuryAccessible, modernNatural, seriousPlayful } = profile.tones;
  const luxury = 100 - luxuryAccessible;
  const centered = (value: number) => (value - 50) / 50;
  return {
    brightness: round(1 + (0.03 * Math.max(0, 50 - modernNatural)) / 50),
    contrast: round(1 + 0.05 * centered(luxury)),
    saturation: round(1 + 0.06 * centered(minimalVibrant) + 0.02 * centered(seriousPlayful)),
    warmth: round(0.03 * centered(corporateFriendly)),
    sharpen: round(Math.min(1, Math.max(0.5, 0.7 + 0.3 * centered(luxury)))),
    denoise: luxury >= 70,
  };
}

/** Özgünlük katmanının sınırına kısar. Stil tercihi burada sessizce daraltılır; hiçbir zaman genişletilmez. */
export function clampToTier(operations: BrandStyleOperations, tier: BrandStyleAuthenticityTier): BrandStyleOperations {
  const bounds = brandStyleBounds(tier);
  return {
    brightness: clamp(operations.brightness, bounds.brightness),
    contrast: clamp(operations.contrast, bounds.contrast),
    saturation: clamp(operations.saturation, bounds.saturation),
    warmth: clamp(operations.warmth, bounds.warmth),
    sharpen: clamp(operations.sharpen, bounds.sharpen),
    denoise: bounds.denoise ? operations.denoise : false,
  };
}

/**
 * Kapalı sözleşme denetimi. Buradan geçemeyen bir stil isteği çalıştırılmaz: sınır dışı bir değer,
 * tanınmayan bir alan ya da üretken bir işlem isteği reddedilir.
 */
export function assertBrandStyleOperations(operations: unknown, tier: BrandStyleAuthenticityTier): BrandStyleOperations {
  const parsed = brandStyleOperationsSchema(tier).safeParse(operations);
  if (!parsed.success) throw new DomainError("Bu stil isteği, özgünlüğü koruyan güvenli işlem sınırlarının dışında kaldığı için uygulanamaz.", "VALIDATION_ERROR");
  return parsed.data;
}

/** Seçim + marka profili + özgünlük katmanı → doğrulanmış operasyon seti. */
export function buildBrandStyleOperations(
  choice: BrandStyleChoice,
  profile: BrandVisualStyleProfile,
  tier: BrandStyleAuthenticityTier,
): BrandStyleOperations {
  const base = choice === "BRAND_RECOMMENDED" ? recommendedOperations(profile) : fixedStyles[choice];
  return assertBrandStyleOperations(clampToTier(base, tier), tier);
}
