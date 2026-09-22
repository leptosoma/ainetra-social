import { z } from "zod";

// P5-02 Safe Enhance sözleşmesi. Özgünlük politikası burada şema olarak yaşar: sağlayıcıya yalnızca
// aşağıdaki kapalı, dar sınırlı piksel düzeyi ayarlar verilebilir. Nesne/sahne/üretken işlemler bu
// sözleşmede ifade edilemez; bu yüzden hiçbir ön ayar veya sağlayıcı bunları çalıştıramaz. Çıktı,
// kaydedilmeden önce çözülür (decode) ve kaynağın biçimi/boyutlarıyla birebir karşılaştırılır.

export const SAFE_ENHANCE_PARAMETER_VERSION = "safe-enhance-v1";

export const enhancementPresets = ["NATURAL", "BRIGHT", "CLEAN", "WARM"] as const;
export type EnhancementPreset = typeof enhancementPresets[number];

/** Muhafazakâr sınırlar: ışık/renk düzeltmesi ötesine geçen (ör. %30 parlaklık) hiçbir değer kabul edilmez. */
export const safeEnhanceOperationsSchema = z.strictObject({
  /** Çarpımsal parlaklık (pozlama). 1 = değişiklik yok. */
  brightness: z.number().min(0.85).max(1.2),
  /** Doğrusal kontrast çarpanı; orta gri sabit tutulur. 1 = değişiklik yok. */
  contrast: z.number().min(0.9).max(1.15),
  /** Doygunluk çarpanı. 1 = değişiklik yok. */
  saturation: z.number().min(0.85).max(1.15),
  /** Beyaz dengesi/sıcaklık: kırmızı kanal 1+w, mavi kanal 1-w ile çarpılır. 0 = değişiklik yok. */
  warmth: z.number().min(-0.08).max(0.08),
  /** Hafif keskinleştirme (Gauss sigma). 0 = uygulanmaz. */
  sharpen: z.number().min(0).max(1.5),
  /** Hafif gürültü/sıkıştırma artığı azaltma (3×3 medyan). */
  denoise: z.boolean(),
});

export type SafeEnhanceOperations = z.infer<typeof safeEnhanceOperationsSchema>;

/** Sağlayıcıdan beklenen ham çıktı: yalnızca baytlar. Biçim/boyut doğrulaması serviste, çözülerek yapılır. */
export const providerOutputSchema = z.object({
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, "empty output"),
});

export type ProviderOutput = z.infer<typeof providerOutputSchema>;
