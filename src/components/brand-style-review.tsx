import Image from "next/image";
import { createBrandStyleAction, discardBrandStyleAction, keepBrandStyleAction } from "@/actions/brand-style";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  brandProfileStateNotes,
  brandStyleAuthenticityMessage,
  brandStyleChoiceDescriptions,
  brandStyleChoiceLabels,
  brandStyleDecisionLabels,
  brandStyleErrorCodeLabels,
  brandStyleProvenanceLabels,
  brandStyleStatusLabels,
  brandStyleTierNotes,
} from "@/features/brand-style/labels";
import type { getBrandStyleReview } from "@/features/brand-style/service";

type Review = Awaited<ReturnType<typeof getBrandStyleReview>>;

const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/**
 * "Markama göre düzenle" inceleme bölümü (Görsel analizi detayı içinde).
 * Önce markanın karakterine göre tek bir öneri ve kısa gerekçe gösterilir, ardından birkaç ölçülü
 * alternatif sunulur. Marka tercihlerinin ham değerleri, alan adları veya parametreler gösterilmez.
 * Kaynak hiçbir işlemde değişmez; "Sakla" yeni bir medya oluşturur, "At" yalnızca çıktıyı siler.
 */
export function BrandStyleReview({ review }: { review: Review }) {
  const { asset, summary, recommendation, activeChoices, awaitingReview, kept, history } = review;
  const width = asset.width ?? 1200;
  const height = asset.height ?? 1200;
  const profileNote = brandProfileStateNotes[recommendation.profileState];
  const sourceLabel = asset.origin === "SAFE_ENHANCE" ? "İyileştirilmiş sürüm (değişmedi)" : "Kaynak (değişmedi)";

  return (
    <div className="panel enhance-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow dark">Markama göre düzenle</span>
          <h2>Fotoğrafı markanızın karakterine yaklaştırın</h2>
        </div>
        {summary.kept > 0 && <span className="status success">{summary.kept} sonuç saklandı</span>}
      </div>
      <p className="form-note">{brandStyleAuthenticityMessage}</p>

      {summary.eligible ? (
        <>
          <div className="analysis-action">
            <span className="eyebrow dark">Markanız için önerimiz</span>
            <h3>{recommendation.headline}</h3>
            <p>{recommendation.rationale}</p>
            {profileNote && <small className="form-note">{profileNote}</small>}
          </div>
          <div className="enhance-presets">
            {recommendation.choices.map((choice) => {
              const active = activeChoices.includes(choice);
              return (
                <form action={createBrandStyleAction} key={choice} className="enhance-preset">
                  <input type="hidden" name="mediaAssetId" value={asset.id} />
                  <input type="hidden" name="choice" value={choice} />
                  <PendingSubmitButton
                    idle={brandStyleChoiceLabels[choice]}
                    pending="Uygulanıyor…"
                    className={choice === recommendation.recommended ? "button primary" : "mini-button"}
                    disabled={active}
                  />
                  <small>{active ? "Bu seçim için bekleyen bir sonuç var." : brandStyleChoiceDescriptions[choice]}</small>
                </form>
              );
            })}
          </div>
        </>
      ) : (
        <div className="alert warning">{summary.ineligibleReason}</div>
      )}

      {summary.latestFailure && (
        <div className="alert warning">
          Sürüm {summary.latestFailure.version} denemesi tamamlanamadı ({brandStyleErrorCodeLabels[summary.latestFailure.errorCode ?? ""] ?? "bilinmeyen hata"}). Kaynak görsel olduğu gibi duruyor.
        </div>
      )}

      {awaitingReview.map((item) => (
        <article className="enhance-review" key={item.id}>
          <div className={`analysis-banner ${item.provenance.toLowerCase()}`} role="note">
            <strong>{brandStyleProvenanceLabels[item.provenance].short}</strong>
            <span>{brandStyleProvenanceLabels[item.provenance].long}</span>
            <small>
              {brandStyleChoiceLabels[item.choice]} · Sürüm {item.version}
              {item.sourceEnhancementId ? " · iyileştirilmiş sürümden" : ""}
              {item.completedAt ? ` · ${dateFormat.format(item.completedAt)}` : ""}
            </small>
          </div>
          <div className="enhance-compare">
            <figure>
              <Image unoptimized src={`/media/${asset.id}`} alt={`${asset.originalFilename} — kaynak`} width={width} height={height} />
              <figcaption>{sourceLabel}</figcaption>
            </figure>
            <figure>
              {item.outputAvailable
                ? <Image unoptimized src={`/media/brand-style/${item.id}`} alt={`${asset.originalFilename} — ${brandStyleChoiceLabels[item.choice]}`} width={item.outputWidth ?? width} height={item.outputHeight ?? height} />
                : <div className="media-placeholder">Önizleme yok</div>}
              <figcaption>Markaya göre · {brandStyleChoiceLabels[item.choice]}</figcaption>
            </figure>
          </div>
          <p className="form-note">{brandStyleAuthenticityMessage}</p>
          <p className="form-note">{brandStyleTierNotes[item.authenticityTier]}</p>
          <div className="enhance-decision">
            <form action={keepBrandStyleAction}>
              <input type="hidden" name="mediaAssetId" value={asset.id} />
              <input type="hidden" name="brandStyleId" value={item.id} />
              <PendingSubmitButton idle="Sakla" pending="Saklanıyor…" className="button primary" />
            </form>
            <form action={discardBrandStyleAction}>
              <input type="hidden" name="mediaAssetId" value={asset.id} />
              <input type="hidden" name="brandStyleId" value={item.id} />
              <PendingSubmitButton idle="At" pending="Atılıyor…" className="mini-button" />
            </form>
            <small className="form-note">Saklarsanız kütüphaneye ayrı bir görsel olarak eklenir; kaynak yerinde kalır. Atarsanız yalnızca bu çıktı silinir.</small>
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
                  ? <Image unoptimized src={`/media/${item.outputAssetId}`} alt={`${brandStyleChoiceLabels[item.choice]} marka stili`} width={item.outputWidth ?? width} height={item.outputHeight ?? height} />
                  : <div className="media-placeholder">Kütüphaneden silindi</div>}
                <div>
                  <strong>{brandStyleChoiceLabels[item.choice]} · Sürüm {item.version}</strong>
                  <small>{item.decidedAt ? dateFormat.format(item.decidedAt) : ""} · {brandStyleProvenanceLabels[item.provenance].short}</small>
                  <small>{item.outputAssetId ? "Kütüphanede ayrı bir görsel olarak kullanılabilir; kaynak korunuyor." : "Bu türev kütüphaneden silinmiş."}</small>
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
              <dt>Sürüm {item.version} · {brandStyleChoiceLabels[item.choice]} · {dateFormat.format(item.createdAt)}</dt>
              <dd>
                {brandStyleStatusLabels[item.status]}
                {item.decision ? ` · ${brandStyleDecisionLabels[item.decision]}` : ""}
                {` · ${brandStyleProvenanceLabels[item.provenance].short}`}
                {item.errorCode ? ` · ${brandStyleErrorCodeLabels[item.errorCode] ?? item.errorCode}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
