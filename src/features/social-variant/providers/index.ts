import "server-only";

import { DevelopmentSharpReframeProvider } from "./development";
import type { ImageReframeProvider } from "./types";

/**
 * Depoda yapılandırılmış gerçek bir yeniden çerçeveleme sağlayıcısı (kimlik bilgisi + destek) yok;
 * bu yüzden P5-04 yalnızca açıkça etiketlenmiş yerel geliştirme sağlayıcısını döndürür. Gerçek bir
 * sağlayıcı eklendiğinde burada seçilir ve provenance REAL olarak kayda geçer.
 */
export function getImageReframeProvider(): ImageReframeProvider {
  return new DevelopmentSharpReframeProvider();
}

export type { ImageReframeProvider, ImageReframeProviderInput } from "./types";
