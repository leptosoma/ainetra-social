import type { MediaAnalysisProvenance } from "../../../../generated/prisma/enums";

export type ImageAnalysisProviderInput = {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  originalFilename: string;
  /** Kullanıcının medyaya verdiği planlama etiketleri (PHOTO_PRODUCT vb.); sağlayıcıya bağlam olarak geçer. */
  planningTags: string[];
};

/**
 * Satıcıdan bağımsız görsel analiz sınırı. Sağlayıcı yalnızca gözlem döndürür (ham `unknown`);
 * şema doğrulaması, boyut/oran/platform uyumu, özgünlük politikası ve önerilen adım serviste
 * hesaplanır. `provenance` sağlayıcı nesnesinden gelir, çıktıdan değil: geliştirme sağlayıcısı
 * kendini asla gerçek yapay zekâ olarak sunamaz.
 */
export interface ImageAnalysisProvider {
  readonly provider: string;
  readonly model: string;
  readonly provenance: MediaAnalysisProvenance;
  analyze(input: ImageAnalysisProviderInput): Promise<unknown>;
}
