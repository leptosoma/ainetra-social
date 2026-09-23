import Image from "next/image";
import { createSocialVariantAction, discardSocialVariantAction, keepSocialVariantAction } from "@/actions/social-variant";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  socialVariantAuthenticityMessage,
  socialVariantDecisionLabels,
  socialVariantErrorCodeLabels,
  socialVariantFitNotes,
  socialVariantFormatDescriptions,
  socialVariantFormatLabels,
  socialVariantPlatformLabels,
  socialVariantProvenanceLabels,
  socialVariantRecommendationTypeLabels,
  socialVariantStatusLabels,
} from "@/features/social-variant/labels";
import type { getSocialVariantReview } from "@/features/social-variant/service";

type Review = Awaited<ReturnType<typeof getSocialVariantReview>>;

const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/**
 * "Bunu nerede kullanacaksınız?" bölümü (Görsel analizi detayı içinde).
 * Yalnızca gerçek bir platform oran kuralının izin verdiği seçenekler gösterilir; her seçenek
 * kırpmanın ne yapacağını önceden söyler. Kaynak hiçbir işlemde değişmez; "Sakla" yeni bir medya
 * oluşturur, "At" yalnızca bu sürümü siler. Bu adım içerik onayı ya da yayın değildir.
 */
export function SocialVariantReview({ review }: { review: Review }) {
  const { asset, summary, choices, awaitingReview, kept, history } = review;
  const width = asset.width ?? 1200;
  const height = asset.height ?? 1200;

  return (
    <div className="panel enhance-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow dark">Bunu nerede kullanacaksınız?</span>
          <h2>Bu fotoğrafın sosyal format sürümleri</h2>
        </div>
        {summary.kept > 0 && <span className="status success">{summary.kept} sürüm saklandı</span>}
      </div>
      <p className="form-note">{socialVariantAuthenticityMessage}</p>

      {summary.eligible ? (
        choices.length ? (
          <div className="enhance-presets">
            {choices.map((choice) => (
              <form action={createSocialVariantAction} key={`${choice.platform}-${choice.format}`} className="enhance-preset">
                <input type="hidden" name="mediaAssetId" value={asset.id} />
                <input type="hidden" name="platform" value={choice.platform} />
                <input type="hidden" name="format" value={choice.format} />
                <PendingSubmitButton
                  idle={`${socialVariantPlatformLabels[choice.platform]} · ${socialVariantFormatLabels[choice.format]}`}
                  pending="Hazırlanıyor…"
                  className="mini-button"
                  disabled={choice.active}
                />
                <small>
                  {choice.active
                    ? "Bu seçim için bekleyen bir sonuç var."
                    : `${socialVariantFormatDescriptions[choice.format]} ${choice.targetAspectRatio} · ${choice.outputWidth}×${choice.outputHeight} px.`}
                </small>
                <small>{socialVariantRecommendationTypeLabels[choice.recommendationType]}.</small>
                {!choice.active && choice.reviewNeeded && <small>Güvenli kırpma kurulamıyor; fotoğrafın tamamı korunacak ve boşluklar düz renkle doldurulacak.</small>}
              </form>
            ))}
          </div>
        ) : (
          <div className="alert warning">Bu işletme için tanımlı bir platform oran kuralı yok; sosyal format sürümü önerilmiyor.</div>
        )
      ) : (
        <div className="alert warning">{summary.ineligibleReason}</div>
      )}

      {summary.latestFailure && (
        <div className="alert warning">
          Sürüm {summary.latestFailure.version} denemesi tamamlanamadı ({socialVariantErrorCodeLabels[summary.latestFailure.errorCode ?? ""] ?? "bilinmeyen hata"}). Kaynak görsel olduğu gibi duruyor.
        </div>
      )}

      {awaitingReview.map((item) => (
        <article className="enhance-review" key={item.id}>
          <div className={`analysis-banner ${item.provenance.toLowerCase()}`} role="note">
            <strong>{socialVariantProvenanceLabels[item.provenance].short}</strong>
            <span>{socialVariantProvenanceLabels[item.provenance].long}</span>
            <small>
              {socialVariantPlatformLabels[item.platform]} · {socialVariantFormatLabels[item.format]} · {item.targetAspectRatio} · Sürüm {item.version}
              {item.completedAt ? ` · ${dateFormat.format(item.completedAt)}` : ""}
            </small>
          </div>
          <div className="enhance-compare">
            <figure>
              <Image unoptimized src={`/media/${asset.id}`} alt={`${asset.originalFilename} — kaynak`} width={width} height={height} />
              <figcaption>Kaynak (değişmedi)</figcaption>
            </figure>
            <figure>
              {item.outputAvailable
                ? <Image unoptimized src={`/media/social-variant/${item.id}`} alt={`${asset.originalFilename} — ${socialVariantFormatLabels[item.format]}`} width={item.outputWidth ?? width} height={item.outputHeight ?? height} />
                : <div className="media-placeholder">Önizleme yok</div>}
              <figcaption>{socialVariantFormatLabels[item.format]} · {item.outputWidth}×{item.outputHeight} px</figcaption>
            </figure>
          </div>
          <p className="form-note">{socialVariantFitNotes[item.fit]}</p>
          <p className="form-note">{socialVariantAuthenticityMessage}</p>
          {item.reviewNeeded && <div className="alert warning">Bu sürümü saklamadan önce mutlaka kontrol edin: güvenli bir kırpma kurulamadığı için yerleşim değişti.</div>}
          <div className="enhance-decision">
            <form action={keepSocialVariantAction}>
              <input type="hidden" name="mediaAssetId" value={asset.id} />
              <input type="hidden" name="variantId" value={item.id} />
              <PendingSubmitButton idle="Sakla" pending="Saklanıyor…" className="button primary" />
            </form>
            <form action={discardSocialVariantAction}>
              <input type="hidden" name="mediaAssetId" value={asset.id} />
              <input type="hidden" name="variantId" value={item.id} />
              <PendingSubmitButton idle="At" pending="Atılıyor…" className="mini-button" />
            </form>
            <small className="form-note">Saklarsanız kütüphaneye ayrı bir görsel olarak eklenir; kaynak yerinde kalır. Bu işlem içeriği onaylamaz, planlamaz veya yayınlamaz.</small>
          </div>
        </article>
      ))}

      {kept.length > 0 && (
        <div className="enhance-kept">
          <span className="eyebrow dark">Saklanan sürümler</span>
          <ul>
            {kept.map((item) => (
              <li key={item.id}>
                {item.outputAssetId
                  ? <Image unoptimized src={`/media/${item.outputAssetId}`} alt={`${socialVariantFormatLabels[item.format]} sürümü`} width={item.outputWidth ?? width} height={item.outputHeight ?? height} />
                  : <div className="media-placeholder">Kütüphaneden silindi</div>}
                <div>
                  <strong>{socialVariantPlatformLabels[item.platform]} · {socialVariantFormatLabels[item.format]} · Sürüm {item.version}</strong>
                  <small>{item.decidedAt ? dateFormat.format(item.decidedAt) : ""} · {socialVariantProvenanceLabels[item.provenance].short}</small>
                  <small>{item.outputAssetId ? "Kütüphanede ayrı bir görsel olarak kullanılabilir; kaynak korunuyor." : "Bu sürüm kütüphaneden silinmiş."}</small>
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
              <dt>Sürüm {item.version} · {socialVariantPlatformLabels[item.platform]} {socialVariantFormatLabels[item.format]} · {dateFormat.format(item.createdAt)}</dt>
              <dd>
                {socialVariantStatusLabels[item.status]}
                {item.decision ? ` · ${socialVariantDecisionLabels[item.decision]}` : ""}
                {` · ${socialVariantProvenanceLabels[item.provenance].short}`}
                {item.errorCode ? ` · ${socialVariantErrorCodeLabels[item.errorCode] ?? item.errorCode}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
