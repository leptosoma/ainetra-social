import "server-only";

import { LocalTemplateCreativeProvider } from "./local";
import type { CreativeRenderProvider } from "./types";

/**
 * Depoda yapılandırılmış, gerçek bir kreatif üretim sağlayıcısı (kimlik bilgisi + destek) yok ve
 * P5-04 ücretli bir sağlayıcı eklemez. Bu yüzden yalnızca açıkça etiketlenmiş yerel, üretken
 * OLMAYAN şablon sağlayıcısı döner. Gerçek bir sağlayıcı eklendiğinde burada seçilir, provenance
 * REAL olarak kayda geçer ve `generative` bayrağı arayüzdeki etiketi buna göre değiştirir.
 */
export function getCreativeRenderProvider(): CreativeRenderProvider {
  return new LocalTemplateCreativeProvider();
}

export type { CreativeRenderProvider, CreativeRenderProviderInput } from "./types";
