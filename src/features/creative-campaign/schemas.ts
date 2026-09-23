import { z } from "zod";
import { brandPaletteSchema } from "@/features/brand-style/palette";
import { socialVariantRuleSnapshotSchema } from "@/features/social-variant/schemas";

// P5-04 Kreatif Kampanya sözleşmesi. Bu akış TASARIM üretir ve bunu hiçbir yerde gizlemez.
//
// Olgu politikası şema olarak yaşar: `copy` yalnızca `factRefs` içindeki, KANONİK ve ONAYLI
// Business Brain bilgilerinden kurulabilir. Serbest metin alanı yoktur; bu yüzden kampanya,
// indirim, fiyat, ürün, hizmet, etkinlik, çalışma saati, yorum, görüntülenme, manzara, stok
// durumu veya teklif koşulu bu sözleşmede ifade EDİLEMEZ. Bilgi eksikse kreatif üretilmez.

export const CREATIVE_CAMPAIGN_VERSION = "creative-campaign-v1";

export const creativeCategories = ["BUSINESS_INTRO", "PRODUCTS_SERVICES", "LOCATION_INFO", "CONFIRMED_FACTS"] as const;
export type CreativeCategory = typeof creativeCategories[number];

/** Kayda geçen olgu referansı: hangi BusinessAttribute satırından, hangi değerle alındığı. */
export const creativeFactRefSchema = z.strictObject({
  attributeId: z.string().min(1),
  category: z.string().min(1).max(60),
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(400),
  source: z.string().min(1).max(40),
  confirmedAt: z.string().nullable(),
});

export type CreativeFactRef = z.infer<typeof creativeFactRefSchema>;

/**
 * Tasarıma basılan metin. `headline` işletmenin kayıtlı adıdır (uydurma bir slogan değildir),
 * `lines` ise onaylı bilgilerin kendi metinleridir. Başka bir alan yoktur.
 */
export const creativeCopySchema = z.strictObject({
  headline: z.string().trim().min(1).max(80),
  lines: z.array(z.string().trim().min(1).max(200)).min(1).max(3),
  /** Tasarımın üzerinde görünen, kullanıcıya da gösterilen sabit tasarım işareti. */
  designNote: z.string().trim().min(1).max(60),
});

export type CreativeCopy = z.infer<typeof creativeCopySchema>;

export const creativeBrandSnapshotSchema = z.strictObject({
  palette: brandPaletteSchema,
  businessName: z.string().min(1).max(160),
  profileVersion: z.string().min(1).max(60),
  profileAvailable: z.boolean(),
});

export type CreativeBrandSnapshot = z.infer<typeof creativeBrandSnapshotSchema>;

export const creativeRuleSnapshotSchema = socialVariantRuleSnapshotSchema;

/** Sağlayıcıdan beklenen ham çıktı: baytlar ve çıktının dosya türü. Doğrulama serviste yapılır. */
export const providerOutputSchema = z.object({
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, "empty output"),
  mimeType: z.enum(["image/jpeg", "image/png"]),
});
