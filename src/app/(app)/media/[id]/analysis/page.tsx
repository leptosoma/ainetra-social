import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { analyzeMediaAction } from "@/actions/media";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { getCurrentUser } from "@/features/auth/session";
import {
  actionLabels,
  backgroundLabels,
  categoryLabels,
  contentTypeLabels,
  errorCodeLabels,
  fitLabels,
  framingLabels,
  imageKindLabels,
  lightingLabels,
  orientationLabels,
  platformLabels,
  provenanceLabels,
  qualityLabels,
  recommendationTypeLabels,
  resolutionLabels,
  sharpnessLabels,
  statusLabels,
} from "@/features/visual-analysis/labels";
import { getMediaAnalysisDetail } from "@/features/visual-analysis/service";
import { DomainError } from "@/lib/domain-error";

const noticeLabels: Record<string, { text: string; tone: "success" | "warning" }> = {
  "analysis-complete": { text: "Görsel analizi tamamlandı; güncel sürüm aşağıda.", tone: "success" },
  "analysis-failed": { text: "Analiz tamamlanamadı; önceki güncel sonuç korundu.", tone: "warning" },
  "analysis-invalid": { text: "Analiz sonucu doğrulanamadı ve kaydedilmedi; önceki güncel sonuç korundu.", tone: "warning" },
  "analysis-rejected": { text: "Bu medya için analiz çalıştırılamadı (yalnızca fotoğraflar desteklenir, saatlik sınır olabilir).", tone: "warning" },
  "analysis-error": { text: "Analiz başlatılamadı.", tone: "warning" },
};

const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

export default async function MediaAnalysisPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  let detail: Awaited<ReturnType<typeof getMediaAnalysisDetail>>;
  try {
    detail = await getMediaAnalysisDetail(user.id, id);
  } catch (error) {
    if (error instanceof DomainError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  const { asset, current, history, summary } = detail;
  const result = current?.result ?? null;
  const notice = query.notice ? noticeLabels[query.notice] : undefined;

  return (
    <>
      <Link href="/media" className="back-link">← Medya kütüphanesine dön</Link>
      <header className="detail-header"><div><span className="eyebrow dark">Görsel analizi</span><h1>{asset.originalFilename}</h1><p>{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}{dateFormat.format(asset.createdAt)} tarihinde yüklendi. Analiz görseli değiştirmez; yalnızca kullanım için bilgi üretir.</p></div></header>
      {notice && <div className={`brain-notice ${notice.tone}`} role="status">{notice.text}</div>}
      {!summary.supported && <div className="alert warning">Görsel analizi yalnızca fotoğraf ve görseller için kullanılabilir.</div>}
      <div className="analysis-layout">
        <aside className="panel analysis-preview">
          {asset.type === "IMAGE"
            ? <Image unoptimized src={`/media/${asset.id}`} alt={asset.originalFilename} width={asset.width ?? 1200} height={asset.height ?? 1200} />
            : <div className="media-placeholder">Video önizlemesi</div>}
          {summary.supported && (
            <form action={analyzeMediaAction} className="analysis-rerun">
              <input type="hidden" name="mediaAssetId" value={asset.id} />
              <PendingSubmitButton idle={current ? "Yeniden analiz et" : "Analiz et"} pending="Analiz ediliyor…" className="button primary" />
              <small className="form-note">Yeniden analiz yeni bir sürüm oluşturur; yalnızca başarılı sonuç güncel olur.</small>
            </form>
          )}
        </aside>
        <section className="analysis-body">
          {current && result ? (
            <>
              <div className={`analysis-banner ${current.provenance.toLowerCase()}`} role="note">
                <strong>{provenanceLabels[current.provenance].short}</strong>
                <span>{provenanceLabels[current.provenance].long}</span>
                <small>Sürüm {current.version}{current.completedAt ? ` · ${dateFormat.format(current.completedAt)}` : ""}</small>
              </div>
              <div className="panel analysis-action">
                <span className="eyebrow dark">Önerilen adım</span>
                <h2>{actionLabels[result.recommendedAction]}</h2>
                <p>{result.recommendedActionReason}</p>
              </div>
              <div className="panel">
                <div className="panel-title"><div><span className="eyebrow dark">Ne görüyoruz</span><h2>{categoryLabels[result.category]}</h2></div><span className="status">{imageKindLabels[result.imageKind]}</span></div>
                <dl className="detail-list">
                  <div><dt>Ana konu</dt><dd>{result.dominantSubject}</dd></div>
                  <div><dt>Kategori güveni</dt><dd>%{Math.round(result.categoryConfidence * 100)}</dd></div>
                  <div><dt>Yön</dt><dd>{orientationLabels[result.orientation]} · {result.aspectRatio.label}</dd></div>
                  <div><dt>Boyut</dt><dd>{result.dimensions.width}×{result.dimensions.height} px</dd></div>
                  <div><dt>Genel kalite</dt><dd>{qualityLabels[result.quality.overall]}</dd></div>
                  <div><dt>Çözünürlük</dt><dd>{resolutionLabels[result.quality.resolution]}</dd></div>
                  <div><dt>Netlik</dt><dd>{sharpnessLabels[result.quality.sharpness]}</dd></div>
                  <div><dt>Işık</dt><dd>{lightingLabels[result.observations.lighting]}</dd></div>
                  <div><dt>Kadraj</dt><dd>{framingLabels[result.observations.framing]}</dd></div>
                  <div><dt>Arka plan</dt><dd>{backgroundLabels[result.observations.background]}</dd></div>
                </dl>
                {result.observations.notes.length > 0 && <ul className="analysis-notes">{result.observations.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
              </div>
              <div className="panel">
                <div className="panel-title"><div><span className="eyebrow dark">Platform uyumu</span><h2>Oran değerlendirmesi</h2></div></div>
                {result.platformFit.length ? (
                  <ul className="analysis-fit">
                    {result.platformFit.map((entry) => (
                      <li key={entry.ruleKey + entry.platform + (entry.contentType ?? "")}>
                        <span className={`status ${entry.fit === "FIT" ? "success" : ""}`}>{fitLabels[entry.fit]}</span>
                        <strong>{platformLabels[entry.platform]}{entry.contentType ? ` · ${contentTypeLabels[entry.contentType]}` : ""}</strong>
                        <small>Önerilen oran {entry.recommendedAspectRatio}; görsel {result.aspectRatio.label}. {recommendationTypeLabels[entry.recommendationType]}.</small>
                      </li>
                    ))}
                  </ul>
                ) : <p className="form-note">Bu işletme için tanımlı oran kuralı bulunmadığından platform uyumu değerlendirilmedi.</p>}
                <small className="form-note">Yalnızca değerlendirme; görsel kırpılmaz veya dönüştürülmez.</small>
              </div>
              <div className={`panel analysis-authenticity ${result.authenticity.sensitive ? "sensitive" : ""}`}>
                <span className="eyebrow dark">Özgünlük</span>
                <h2>{result.authenticity.sensitive ? "Gerçeklik korunmalı" : "Özgünlük açısından hassas değil"}</h2>
                <p>{result.authenticity.reason}</p>
              </div>
            </>
          ) : (
            <div className="empty-state wide"><h3>Bu görsel için güncel bir analiz yok.</h3><p>{summary.latestFailure ? errorCodeLabels[summary.latestFailure.errorCode ?? ""] ?? "Son deneme tamamlanamadı." : "Analiz başlatarak kategori, kalite ve platform uyumu bilgisi alın."}</p></div>
          )}
          {current && summary.latestFailure && <div className="alert warning">Sürüm {summary.latestFailure.version} denemesi tamamlanamadı ({errorCodeLabels[summary.latestFailure.errorCode ?? ""] ?? "bilinmeyen hata"}); sürüm {current.version} güncel kalmaya devam ediyor.</div>}
          {history.length > 0 && (
            <div className="panel">
              <div className="panel-title"><div><span className="eyebrow dark">Geçmiş</span><h2>Analiz denemeleri</h2></div></div>
              <dl className="detail-list">
                {history.map((entry) => (
                  <div key={entry.id}>
                    <dt>Sürüm {entry.version} · {dateFormat.format(entry.createdAt)}</dt>
                    <dd>{statusLabels[entry.status]}{entry.id === current?.id ? " · güncel" : ""} · {provenanceLabels[entry.provenance].short}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
