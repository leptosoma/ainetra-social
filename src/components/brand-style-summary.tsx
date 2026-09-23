import Link from "next/link";
import type { BrandStyleSummary } from "@/features/brand-style/service";

/**
 * Medya kartındaki tek satırlık marka stili durumu. Karar ve karşılaştırma ekranı görsel analizi
 * detayındadır; burada yalnızca bekleyen/saklanan sayısı ve kısa bir bağlantı var.
 */
export function BrandStyleSummaryLine({ mediaAssetId, origin, summary }: { mediaAssetId: string; origin: string; summary: BrandStyleSummary | undefined }) {
  if (origin === "BRAND_STYLE") return <small className="analysis-line enhance-badge">Markaya göre düzenlenmiş sürüm · kaynağı kütüphanede ayrıca duruyor</small>;
  if (!summary?.eligible) return null;
  const { awaitingReview, kept, pending } = summary;
  return (
    <div className="analysis-line" aria-label="Markama göre düzenle">
      <small>
        {pending ? "Marka stili uygulanıyor…" : awaitingReview > 0 ? `${awaitingReview} marka stili kararınızı bekliyor.` : kept > 0 ? `${kept} markaya göre düzenlenmiş sürüm saklandı.` : "Henüz markaya göre düzenlenmedi."}
      </small>
      <Link href={`/media/${mediaAssetId}/analysis`} className="analysis-link">
        {awaitingReview > 0 ? "İncele →" : "Markama göre düzenle →"}
      </Link>
    </div>
  );
}
