import "server-only";

import { DevelopmentImageAnalysisProvider } from "./development";
import type { ImageAnalysisProvider } from "./types";

/**
 * Depoda yapılandırılmış gerçek bir görsel analiz sağlayıcısı (kimlik bilgisi + destek) yok;
 * bu yüzden P5-01 yalnızca açıkça etiketlenmiş geliştirme sağlayıcısını döndürür. Gerçek bir
 * sağlayıcı eklendiğinde burada seçilir ve provenance REAL olarak kayda geçer.
 */
export function getImageAnalysisProvider(): ImageAnalysisProvider {
  return new DevelopmentImageAnalysisProvider();
}

export type { ImageAnalysisProvider, ImageAnalysisProviderInput } from "./types";
