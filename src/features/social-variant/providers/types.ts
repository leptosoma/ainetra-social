import type { MediaSocialVariantProvenance } from "../../../../generated/prisma/enums";
import type { SocialVariantOperations } from "../schemas";

export type ImageReframeProviderInput = {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  /** Serviste hedef orandan türetilen, şemayla sınırlandırılmış geometri talimatı. */
  operations: SocialVariantOperations;
};

/**
 * Satıcıdan bağımsız yeniden çerçeveleme sınırı. Sağlayıcı yalnızca verilen geometriyi uygular ve
 * ham baytlar (`unknown`) döndürür; biçim/boyut doğrulaması ve kalıcılık serviste yapılır.
 * `provenance` sağlayıcı nesnesinden gelir: geliştirme sağlayıcısı kendini asla gerçek/üretken
 * yapay zekâ ya da konu tanıyan bir kırpma olarak sunamaz.
 */
export interface ImageReframeProvider {
  readonly provider: string;
  readonly model: string;
  readonly provenance: MediaSocialVariantProvenance;
  reframe(input: ImageReframeProviderInput): Promise<unknown>;
}
