import Image from "next/image";
import { createSafeEnhancementAction, discardSafeEnhancementAction, keepSafeEnhancementAction } from "@/actions/safe-enhance";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  authenticityMessage,
  enhancementDecisionLabels,
  enhancementErrorCodeLabels,
  enhancementProvenanceLabels,
  enhancementStatusLabels,
  presetDescriptions,
  presetLabels,
} from "@/features/safe-enhance/labels";
import type { getSafeEnhanceReview } from "@/features/safe-enhance/service";

type Review = Awaited<ReturnType<typeof getSafeEnhanceReview>>;

const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/**
 * Güvenli iyileştirme inceleme bölümü (Görsel analizi detayı içinde).
 * Orijinal ile çıktıyı yan yana gösterir, ne yapıldığını açıkça yazar ve karar için Sakla / At sunar.
 * Orijinal hiçbir işlemde değişmez; "Sakla" yeni bir medya oluşturur, "At" yalnızca çıktıyı siler.
 */
export function SafeEnhanceReview({ review }: { review: Review }) {
  const { asset, summary, presets, activePresets, awaitingReview, kept, history } = review;
  const width = asset.width ?? 1200;
  const height = asset.height ?? 1200;

  return (
    <div className="panel enhance-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow dark">Güvenli iyileştirme</span>
          <h2>Fotoğrafı sosyal kullanım için toparlayın</h2>
        </div>
        {summary.kept > 0 && <span className="status success">{summary.kept} sonuç saklandı</span>}
      </div>
      <p className="form-note">{authenticityMessage}</p>

      {summary.eligible ? (
        <div className="enhance-presets">
          {presets.map((preset) => {
            const active = activePresets.includes(preset);
            return (
              <form action={createSafeEnhancementAction} key={preset} className="enhance-preset">
                <input type="hidden" name="mediaAssetId" value={asset.id} />
                <input type="hidden" name="preset" value={preset} />
                <PendingSubmitButton idle={presetLabels[preset]} pending="İyileştiriliyor…" className="mini-button" disabled={active} />
                <small>{active ? "Bu ön ayar için bekleyen bir sonuç var." : presetDescriptions[preset]}</small>
              </form>
            );
          })}
        </div>
      ) : (
        <div className="alert warning">{summary.ineligibleReason}</div>
      )}

      {summary.latestFailure && (
        <div className="alert warning">
          Sürüm {summary.latestFailure.version} denemesi tamamlanamadı ({enhancementErrorCodeLabels[summary.latestFailure.errorCode ?? ""] ?? "bilinmeyen hata"}). Orijinal görsel olduğu gibi duruyor.
        </div>
      )}

      {awaitingReview.map((item) => (
        <article className="enhance-review" key={item.id}>
          <div className={`analysis-banner ${item.provenance.toLowerCase()}`} role="note">
            <strong>{enhancementProvenanceLabels[item.provenance].short}</strong>
            <span>{enhancementProvenanceLabels[item.provenance].long}</span>
            <small>
              {presetLabels[item.preset]} ön ayarı · Sürüm {item.version}
              {item.completedAt ? ` · ${dateFormat.format(item.completedAt)}` : ""}
            </small>
          </div>
          <div className="enhance-compare">
            <figure>
              <Image unoptimized src={`/media/${asset.id}`} alt={`${asset.originalFilename} — orijinal`} width={width} height={height} />
              <figcaption>Orijinal (değişmedi)</figcaption>
            </figure>
            <figure>
              {item.outputAvailable
                ? <Image unoptimized src={`/media/enhancement/${item.id}`} alt={`${asset.originalFilename} — ${presetLabels[item.preset]} iyileştirmesi`} width={item.outputWidth ?? width} height={item.outputHeight ?? height} />
                : <div className="media-placeholder">Önizleme yok</div>}
              <figcaption>İyileştirilmiş · {presetLabels[item.preset]}</figcaption>
            </figure>
          </div>
          <p className="form-note">{authenticityMessage}</p>
          <div className="enhance-decision">
            <form action={keepSafeEnhancementAction}>
              <input type="hidden" name="mediaAssetId" value={asset.id} />
              <input type="hidden" name="enhancementId" value={item.id} />
              <PendingSubmitButton idle="Sakla" pending="Saklanıyor…" className="button primary" />
            </form>
            <form action={discardSafeEnhancementAction}>
              <input type="hidden" name="mediaAssetId" value={asset.id} />
              <input type="hidden" name="enhancementId" value={item.id} />
              <PendingSubmitButton idle="At" pending="Atılıyor…" className="mini-button" />
            </form>
            <small className="form-note">Saklarsanız kütüphaneye ayrı bir görsel olarak eklenir; orijinal yerinde kalır. Atarsanız yalnızca bu çıktı silinir.</small>
          </div>
        </article>
      ))}

      {kept.length > 0 && (
        <div className="enhance-kept">
          <span className="eyebrow dark">Saklananlar</span>
          <ul>
            {kept.map((item) => (
              <li key={item.id}>
                {item.outputAssetId
                  ? <Image unoptimized src={`/media/${item.outputAssetId}`} alt={`${presetLabels[item.preset]} iyileştirmesi`} width={item.outputWidth ?? width} height={item.outputHeight ?? height} />
                  : <div className="media-placeholder">Kütüphaneden silindi</div>}
                <div>
                  <strong>{presetLabels[item.preset]} · Sürüm {item.version}</strong>
                  <small>{item.decidedAt ? dateFormat.format(item.decidedAt) : ""} · {enhancementProvenanceLabels[item.provenance].short}</small>
                  <small>{item.outputAssetId ? "Kütüphanede ayrı bir görsel olarak kullanılabilir; orijinal korunuyor." : "Bu türev kütüphaneden silinmiş."}</small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <dl className="detail-list">
          {history.map((item) => (
            <div key={item.id}>
              <dt>Sürüm {item.version} · {presetLabels[item.preset]} · {dateFormat.format(item.createdAt)}</dt>
              <dd>
                {enhancementStatusLabels[item.status]}
                {item.decision ? ` · ${enhancementDecisionLabels[item.decision]}` : ""}
                {` · ${enhancementProvenanceLabels[item.provenance].short}`}
                {item.errorCode ? ` · ${enhancementErrorCodeLabels[item.errorCode] ?? item.errorCode}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
