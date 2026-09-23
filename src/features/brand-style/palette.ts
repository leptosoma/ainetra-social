import { z } from "zod";
import type { BrandVisualStyleProfile } from "./profile";
import type { BrandStyleAlternative } from "./schemas";

// P5-04 tarafından kullanılan marka renk kümesi. Kaynağı P5-03'ün türettiği görsel stil profilidir:
// kullanıcının BrandProfile tercihlerinden çıkan tek bir karakter (doğal / canlı / seçkin) kapalı
// bir renk kümesine eşlenir. Burada yeni bir marka bilgisi üretilmez ve hiçbir şey yazılmaz.
//
// Dürüstlük notu: BrandProfile'da saklanan bir marka rengi alanı YOKTUR. Bu yüzden bu küme
// "işletmenin gerçek kurumsal rengi" olarak sunulamaz; kullanıcıya her zaman marka TERCİHLERİNDEN
// türetilmiş bir renk önerisi olduğu söylenir.

export const BRAND_PALETTE_VERSION = "brand-palette-v1";

export const brandColorSchema = z.strictObject({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});

export const brandPaletteSchema = z.strictObject({
  paletteVersion: z.string().min(1).max(60),
  /** Hangi marka karakterinden türetildiği; ham tercih değerleri taşınmaz. */
  character: z.enum(["NATURAL", "VIBRANT", "PREMIUM"]),
  /** Marka profili doldurulmuş mu; doldurulmadıysa nötr küme kullanılır. */
  derivedFromProfile: z.boolean(),
  background: brandColorSchema,
  foreground: brandColorSchema,
  accent: brandColorSchema,
});

export type BrandColor = z.infer<typeof brandColorSchema>;
export type BrandPalette = z.infer<typeof brandPaletteSchema>;

/** Kapalı küme: her karakter için üç sabit renk. Uygulamanın mevcut görsel diliyle aynı tonlardır. */
const palettes: Record<BrandStyleAlternative, Pick<BrandPalette, "background" | "foreground" | "accent">> = {
  NATURAL: {
    background: { r: 244, g: 241, b: 234 },
    foreground: { r: 43, g: 53, b: 50 },
    accent: { r: 117, g: 144, b: 133 },
  },
  VIBRANT: {
    background: { r: 255, g: 246, b: 223 },
    foreground: { r: 90, g: 74, b: 38 },
    accent: { r: 200, g: 148, b: 62 },
  },
  PREMIUM: {
    background: { r: 43, g: 53, b: 50 },
    foreground: { r: 244, g: 241, b: 234 },
    accent: { r: 216, g: 206, b: 180 },
  },
};

/** Görsel stil profili → doğrulanmış renk kümesi. Profil yoksa nötr (doğal) küme kullanılır. */
export function brandPaletteFor(profile: BrandVisualStyleProfile): BrandPalette {
  const character = profile.state === "MISSING" ? "NATURAL" : profile.nearestStyle;
  return brandPaletteSchema.parse({
    paletteVersion: BRAND_PALETTE_VERSION,
    character,
    derivedFromProfile: profile.state !== "MISSING",
    ...palettes[character],
  });
}

export function toCssColor(color: BrandColor) {
  return `rgb(${color.r},${color.g},${color.b})`;
}
