import type { BrandColor } from "@/features/brand-style/palette";
import { socialVariantOperationsSchema, type SocialVariantOperations } from "./schemas";

// Deterministik yeniden çerçeveleme planı. Bu yerel geometridir: konu, yüz, tabak veya metin
// TANINMAZ. Bu yüzden "akıllı kırpma" iddiası yapılamaz ve kırpma yalnızca kaybın küçük kaldığı
// durumda uygulanır.
//
// Koruma kuralı: merkez kırpma kaynağın belirgin bir bölümünü götürecekse kırpma YAPILMAZ.
// Bunun yerine fotoğrafın tamamı korunur (CONTAIN) ve boşluklar düz renkle doldurulur; sonuç
// gözden geçirilmesi gereken olarak işaretlenir. Önemli bir öğenin kadraj dışında kalma riski
// böylece kullanıcıya bırakılır, sessizce alınmaz.

/** Merkez kırpmanın götürebileceği en fazla alan oranı. Üzerinde kırpma güvenli kabul edilmez. */
export const maxSafeCropLoss = 0.2;
/** Bu kısa kenarın altındaki kaynaklardan sosyal format türevi üretilmez. */
export const minSourceShortSide = 320;
/** Çıktının en uzun kenarı; kaynak büyütülmez, yalnızca gerektiğinde küçültülür. */
export const maxOutputSide = 2048;

export type ReframePlan = {
  operations: SocialVariantOperations;
  /** Merkez kırpmanın götüreceği alan oranı (0–1). CONTAIN planında da hesaplanır. */
  cropLoss: number;
  /** CONTAIN planında fotoğrafın tuvalde kapladığı alan oranı; COVER planında 1. */
  coverage: number;
  /** Güvenli kırpma kurulamadı: kullanıcı sonucu görmeden saklamamalı. */
  reviewNeeded: boolean;
};

function scaleToBounds(width: number, height: number) {
  const longest = Math.max(width, height);
  if (longest <= maxOutputSide) return { width, height };
  const scale = maxOutputSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Kaynak boyutları + hedef oran → kapalı sözleşmeye göre doğrulanmış geometri.
 * Kaynak asla büyütülmez; kırpma her zaman merkezdendir ve sabittir.
 */
export function planReframe(input: { width: number; height: number; targetRatio: number; padColor: BrandColor }): ReframePlan {
  const { width, height, targetRatio, padColor } = input;
  const sourceRatio = width / height;

  // Merkez kırpma kutusu: hedef orana ulaşmak için yalnızca bir kenar daraltılır.
  const cropWidth = targetRatio < sourceRatio ? Math.max(1, Math.min(width, Math.round(height * targetRatio))) : width;
  const cropHeight = targetRatio < sourceRatio ? height : Math.max(1, Math.min(height, Math.round(width / targetRatio)));
  const cropLoss = Number((1 - (cropWidth * cropHeight) / (width * height)).toFixed(4));

  if (cropLoss <= maxSafeCropLoss) {
    const output = scaleToBounds(cropWidth, cropHeight);
    return {
      operations: socialVariantOperationsSchema.parse({
        fit: "COVER",
        crop: { left: Math.floor((width - cropWidth) / 2), top: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight },
        output,
        padColor,
      }),
      cropLoss,
      coverage: 1,
      reviewNeeded: false,
    };
  }

  // Güvenli kırpma yok: fotoğrafın tamamını içeren tuval kurulur, kaynak kırpılmaz.
  const canvasWidth = targetRatio < sourceRatio ? width : Math.max(1, Math.round(height * targetRatio));
  const canvasHeight = targetRatio < sourceRatio ? Math.max(1, Math.round(width / targetRatio)) : height;
  const output = scaleToBounds(canvasWidth, canvasHeight);
  return {
    operations: socialVariantOperationsSchema.parse({
      fit: "CONTAIN",
      crop: { left: 0, top: 0, width, height },
      output,
      padColor,
    }),
    cropLoss,
    coverage: Number(((width * height) / (canvasWidth * canvasHeight)).toFixed(4)),
    reviewNeeded: true,
  };
}

/** Kreatif Kampanya tuvali: hedef orandan sabit, öngörülebilir bir çıktı boyutu. */
export function creativeCanvasFor(targetRatio: number, shortSide = 1080) {
  const raw = targetRatio <= 1
    ? { width: shortSide, height: Math.round(shortSide / targetRatio) }
    : { width: Math.round(shortSide * targetRatio), height: shortSide };
  return scaleToBounds(raw.width, raw.height);
}
