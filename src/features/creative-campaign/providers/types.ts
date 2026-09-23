import type { MediaCreativeProvenance } from "../../../../generated/prisma/enums";
import type { BrandPalette } from "@/features/brand-style/palette";
import type { CreativeCopy } from "../schemas";

export type CreativeRenderProviderInput = {
  copy: CreativeCopy;
  palette: BrandPalette;
  canvas: { width: number; height: number };
  /** Kabul edilmiş gerçek bir medya arka plan olarak kullanılıyorsa baytları; aksi hâlde null. */
  background: { bytes: Uint8Array; mimeType: string } | null;
};

/**
 * Satıcıdan bağımsız kreatif üretim sınırı. Sağlayıcıya yalnızca doğrulanmış metin, renk kümesi,
 * tuval boyutu ve (varsa) arka plan baytları verilir; serbest istem (prompt) yoktur, bu yüzden
 * sağlayıcı olgu üretemez. Çıktı ham döner (`unknown`); doğrulama ve kalıcılık serviste yapılır.
 *
 * `provenance` sağlayıcı nesnesinden gelir: yerel şablon sağlayıcısı kendini asla üretken yapay
 * zekâ olarak sunamaz.
 */
export interface CreativeRenderProvider {
  readonly provider: string;
  readonly model: string;
  readonly provenance: MediaCreativeProvenance;
  /** Sağlayıcının üretken olup olmadığı; arayüzdeki dürüstlük etiketini bu belirler. */
  readonly generative: boolean;
  render(input: CreativeRenderProviderInput): Promise<unknown>;
}
