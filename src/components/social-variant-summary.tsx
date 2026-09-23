import Link from "next/link";
import type { SocialVariantSummary } from "@/features/social-variant/service";

/**
 * Medya kartındaki tek satırlık format sürümü durumu. Karar ve karşılaştırma ekranı görsel analizi
 * detayındadır; burada yalnızca bekleyen/saklanan sayısı ve kısa bir bağlantı var.
 */
export function SocialVariantSummaryLine({ mediaAssetId, origin, summary }: { mediaAssetId: string; origin: string; summary: SocialVariantSummary | undefined }) {
  if (origin === "SOCIAL_VARIANT") return <small className="analysis-line enhance-badge">Sosyal format sürümü · kaynağı kütüphanede ayrıca duruyor</small>;
  if (origin === "CREATIVE_CAMPAIGN") return <small className="analysis-line enhance-badge">Tasarım kreatifi · gerçek fotoğraf değildir</small>;
  if (!summary?.eligible) return null;
  const { awaitingReview, kept, pending } = summary;
  return (
    <div className="analysis-line" aria-label="Sosyal format sürümleri">
      <small>
        {pending ? "Format sürümü hazırlanıyor…" : awaitingReview > 0 ? `${awaitingReview} format sürümü kararınızı bekliyor.` : kept > 0 ? `${kept} format sürümü saklandı.` : "Henüz format sürümü hazırlanmadı."}
      </small>
      <Link href={`/media/${mediaAssetId}/analysis`} className="analysis-link">
        {awaitingReview > 0 ? "İncele →" : "Formatlara hazırla →"}
      </Link>
    </div>
  );
}
