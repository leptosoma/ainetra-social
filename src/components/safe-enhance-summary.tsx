import Link from "next/link";
import type { SafeEnhanceSummary } from "@/features/safe-enhance/service";

/**
 * Medya kartındaki tek satırlık güvenli iyileştirme durumu. Karar ve karşılaştırma ekranı
 * görsel analizi detayındadır; burada yalnızca bekleyen/saklanan sayısı ve kısa bir bağlantı var.
 */
export function SafeEnhanceSummaryLine({ mediaAssetId, origin, summary }: { mediaAssetId: string; origin: string; summary: SafeEnhanceSummary | undefined }) {
  if (origin === "SAFE_ENHANCE") return <small className="analysis-line enhance-badge">İyileştirilmiş sürüm · orijinal kütüphanede ayrıca duruyor</small>;
  if (!summary?.eligible) return null;
  const { awaitingReview, kept, pending } = summary;
  return (
    <div className="analysis-line" aria-label="Güvenli iyileştirme">
      <small>
        {pending ? "İyileştirme sürüyor…" : awaitingReview > 0 ? `${awaitingReview} iyileştirme kararınızı bekliyor.` : kept > 0 ? `${kept} iyileştirilmiş sürüm saklandı.` : "Henüz iyileştirilmedi."}
      </small>
      <Link href={`/media/${mediaAssetId}/analysis`} className="analysis-link">
        {awaitingReview > 0 ? "İncele →" : "İyileştir →"}
      </Link>
    </div>
  );
}
