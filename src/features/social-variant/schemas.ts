import { z } from "zod";

// P5-04 Sosyal Varyant sözleşmesi. Sağlayıcıya yalnızca aşağıdaki kapalı, geometrik yeniden
// çerçeveleme talimatı verilebilir: kırpma kutusu, çıktı boyutu ve (gerekliyse) dolgu rengi.
// Nesne tanıma, sahne değiştirme, içerik ekleme/çıkarma veya üretken bir işlem bu sözleşmede
// ifade edilemez; bu yüzden hiçbir format eylemi veya sağlayıcı bunları çalıştıramaz.
//
// Çıktı kaydedilmeden önce çözülür (decode) ve kaynağın biçimiyle, talep edilen boyutlarla
// birebir karşılaştırılır. Kaynak satır ve baytları hiçbir yolda değişmez.

export const SOCIAL_VARIANT_VERSION = "social-variant-v1";

export const socialVariantFormats = ["FEED", "STORY", "REEL_COVER", "SQUARE"] as const;
export type SocialVariantFormat = typeof socialVariantFormats[number];

export const socialVariantFits = ["COVER", "CONTAIN"] as const;
export type SocialVariantFit = typeof socialVariantFits[number];

const channel = z.number().int().min(0).max(255);

/** Kapalı geometri sözleşmesi: yalnızca kırp, ölçekle, gerekiyorsa düz renkle doldur. */
export const socialVariantOperationsSchema = z.strictObject({
  fit: z.enum(socialVariantFits),
  /** Kaynak piksel uzayında kırpma kutusu. CONTAIN durumunda kutu kaynağın tamamıdır. */
  crop: z.strictObject({
    left: z.number().int().min(0),
    top: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  }),
  /** Nihai tuval boyutu. Servis çıktıyı bu boyutlara göre doğrular. */
  output: z.strictObject({
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
  }),
  /** CONTAIN durumunda boşlukların doldurulduğu düz renk; COVER durumunda kullanılmaz. */
  padColor: z.strictObject({ r: channel, g: channel, b: channel }),
});

export type SocialVariantOperations = z.infer<typeof socialVariantOperationsSchema>;

/** Kayda geçen platform kuralı anlık görüntüsü: kural sonradan değişse de geçmiş kayıt aynı kalır. */
export const socialVariantRuleSnapshotSchema = z.object({
  ruleId: z.string().nullable(),
  ruleKey: z.string().min(1).max(120),
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"]),
  contentType: z.enum(["POST", "REEL", "STORY", "CAROUSEL"]).nullable(),
  category: z.string().min(1).max(60),
  recommendationType: z.enum(["TECHNICAL_REQUIREMENT", "BEST_PRACTICE", "GENERAL_RECOMMENDATION", "BUSINESS_LEARNED"]),
  source: z.enum(["OFFICIAL_PLATFORM", "VERIFIED_INTERNAL_ANALYSIS", "BUSINESS_PERFORMANCE", "MANUAL_ADMIN_RULE"]),
  sourceUrl: z.string().nullable(),
  recommendedAspectRatio: z.string().min(1).max(12),
  supportedAspectRatios: z.array(z.string().min(1).max(12)).max(8),
  effectiveFrom: z.string(),
  reviewedAt: z.string(),
  confidence: z.number().min(0).max(1),
});

export type SocialVariantRuleSnapshot = z.infer<typeof socialVariantRuleSnapshotSchema>;

/** Sağlayıcıdan beklenen ham çıktı: yalnızca baytlar. Biçim/boyut doğrulaması serviste yapılır. */
export const providerOutputSchema = z.object({
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, "empty output"),
});
