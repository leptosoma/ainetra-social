import type { MediaEnhancementProvenance } from "../../../../generated/prisma/enums";
import type { SafeEnhanceOperations } from "../schemas";

export type ImageTransformProviderInput = {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  /** Serviste ön ayardan türetilen, şemayla sınırlandırılmış piksel düzeyi ayarlar. */
  operations: SafeEnhanceOperations;
};

/**
 * Satıcıdan bağımsız görsel dönüştürme sınırı. Sağlayıcı yalnızca verilen teknik ayarları uygular ve
 * ham baytlar (`unknown`) döndürür; biçim/boyut doğrulaması ve kalıcılık serviste yapılır. `provenance`
 * sağlayıcı nesnesinden gelir: geliştirme sağlayıcısı kendini asla gerçek/üretken yapay zekâ olarak sunamaz.
 */
export interface ImageTransformProvider {
  readonly provider: string;
  readonly model: string;
  readonly provenance: MediaEnhancementProvenance;
  transform(input: ImageTransformProviderInput): Promise<unknown>;
}
