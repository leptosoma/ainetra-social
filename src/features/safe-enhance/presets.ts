import { safeEnhanceOperationsSchema, type EnhancementPreset, type SafeEnhanceOperations } from "./schemas";

// Basit operasyonel ön ayarlar. Her biri yalnızca ışık, kontrast, renk, netlik ve gürültü ayarıdır;
// Brand Style, kırpma, sosyal varyant veya üretken işlem içermez. Değerler kasıtlı olarak küçüktür:
// amaç gerçek ürün/mekân/kişi görünümünü değiştirmeden fotoğrafı sosyal kullanım için toparlamaktır.

const presetOperations: Record<EnhancementPreset, SafeEnhanceOperations> = {
  NATURAL: { brightness: 1.03, contrast: 1.04, saturation: 1.03, warmth: 0, sharpen: 0.8, denoise: false },
  BRIGHT: { brightness: 1.1, contrast: 1.05, saturation: 1.02, warmth: 0, sharpen: 0.8, denoise: false },
  CLEAN: { brightness: 1.02, contrast: 1.06, saturation: 0.98, warmth: 0, sharpen: 1, denoise: true },
  WARM: { brightness: 1.03, contrast: 1.03, saturation: 1.06, warmth: 0.04, sharpen: 0.8, denoise: false },
};

/** Ön ayar → doğrulanmış operasyon seti. Şema dışına çıkan bir ön ayar tanımı programlama hatasıdır. */
export function operationsForPreset(preset: EnhancementPreset): SafeEnhanceOperations {
  return safeEnhanceOperationsSchema.parse(presetOperations[preset]);
}
