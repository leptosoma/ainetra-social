import Link from "next/link";
import { analyzeMediaAction } from "@/actions/media";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { actionLabels, categoryLabels, errorCodeLabels, provenanceLabels } from "@/features/visual-analysis/labels";
import type { MediaAnalysisSummary } from "@/features/visual-analysis/service";

/** Medya kartındaki kısa analiz özeti: kategori, geliştirme/gerçek ayrımı, önerilen adım ve analiz tetikleme. */
export function MediaAnalysisSummaryCard({ mediaAssetId, summary }: { mediaAssetId: string; summary: MediaAnalysisSummary | undefined }) {
  if (!summary?.supported) return <small className="analysis-line">Görsel analizi yalnızca fotoğraflar için kullanılabilir.</small>;
  const { current, latestFailure, pending } = summary;
  return (
    <div className="analysis-line" aria-label="Görsel analizi">
      {current ? (
        <small>
          <span className={`analysis-provenance ${current.provenance.toLowerCase()}`}>{provenanceLabels[current.provenance].short}</span>
          {" "}{categoryLabels[current.category]} · {actionLabels[current.recommendedAction]}
        </small>
      ) : <small>Henüz analiz edilmedi.</small>}
      {latestFailure && <small className="analysis-failure">Son deneme başarısız: {errorCodeLabels[latestFailure.errorCode ?? ""] ?? "Analiz tamamlanamadı."}</small>}
      {pending && <small>Analiz sürüyor…</small>}
      <div className="analysis-actions">
        <form action={analyzeMediaAction}>
          <input type="hidden" name="mediaAssetId" value={mediaAssetId} />
          <input type="hidden" name="returnTo" value="library" />
          <PendingSubmitButton idle={current ? "Yeniden analiz et" : "Analiz et"} pending="Analiz ediliyor…" className="mini-button" />
        </form>
        {current && <Link href={`/media/${mediaAssetId}/analysis`} className="analysis-link">Detay →</Link>}
      </div>
    </div>
  );
}
