import "server-only";

import { DevelopmentSharpTransformProvider } from "./development";
import type { ImageTransformProvider } from "./types";

/**
 * Depoda yapılandırılmış gerçek bir görsel dönüştürme sağlayıcısı (kimlik bilgisi + destek) yok;
 * bu yüzden P5-02 yalnızca açıkça etiketlenmiş yerel geliştirme sağlayıcısını döndürür. Gerçek bir
 * sağlayıcı eklendiğinde burada seçilir ve provenance REAL olarak kayda geçer.
 */
export function getImageTransformProvider(): ImageTransformProvider {
  return new DevelopmentSharpTransformProvider();
}

export type { ImageTransformProvider, ImageTransformProviderInput } from "./types";
