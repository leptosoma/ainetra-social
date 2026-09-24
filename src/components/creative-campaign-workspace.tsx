import Image from "next/image";
import { createCreativeCampaignAction, discardCreativeCampaignAction, keepCreativeCampaignAction } from "@/actions/creative-campaign";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  creativeBackgroundNote,
  creativeBackgroundOriginLabels,
  creativeCategoryLabels,
  creativeDecisionLabels,
  creativeDesignDisclaimer,
  creativeErrorCodeLabels,
  creativeFactPolicyMessage,
  creativeNoBackgroundLabel,
  creativePaletteNote,
  creativeProvenanceLabels,
  creativeStatusLabels,
} from "@/features/creative-campaign/labels";
import {
  acceptanceCheckboxLabel,
  creativeRestrictedClaimRules,
  unrecognizedSectorNote,
} from "@/features/creative-campaign/sector-policy";
import type { getCreativeCampaignWorkspace } from "@/features/creative-campaign/service";
import {
  socialVariantFormatLabels,
  socialVariantPlatformLabels,
  socialVariantRecommendationTypeLabels,
} from "@/features/social-variant/labels";

type Workspace = Awaited<ReturnType<typeof getCreativeCampaignWorkspace>>;

const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/**
 * Kreatif Kampanya ekranı: "Bunu nerede kullanacaksınız?" (gerçek bir oran kuralı olan hedefler) ve
 * "Ne hazırlayalım?" (yalnızca onaylı bilgiyle beslenebilen türler). Onaylı bilgisi olmayan bir tür
 * seçilemez ve neyin eksik olduğu satırın kendisinde yazar; böylece bu ekrandan olgu uydurulamaz.
 *
 * Çıktı her yerde TASARIM olarak etiketlenir ve gerçek fotoğrafla karıştırılmaz. "Sakla" tasarımı
 * ayrı bir medya yapar, "At" yalnızca o tasarımı siler; kullanılan gerçek görsel her iki yolda da
 * olduğu gibi kalır. Bu adım içeriği onaylamaz, planlamaz veya yayınlamaz.
 */
export function CreativeCampaignWorkspace({ workspace }: { workspace: Workspace }) {
  const { businessId, formats, categories, backgrounds, awaitingReview, kept, history, pending, latestFailure, policy } = workspace;
  const availableCategories = categories.filter((category) => category.available);
  const canCreate = formats.length > 0 && availableCategories.length > 0;

  return (
    <div className="panel enhance-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow dark">Ne hazırlayalım?</span>
          <h2>Onaylı bilgilerinizden bir tasarım</h2>
        </div>
        {kept.length > 0 && <span className="status success">{kept.length} tasarım saklandı</span>}
      </div>
      <p className="form-note">{creativeDesignDisclaimer}</p>
      <p className="form-note">{creativeFactPolicyMessage}</p>
      <p className="form-note">
        <strong>{policy.label} politikası:</strong> {policy.summary}
      </p>
      {!policy.sectorRecognized && <p className="form-note">{unrecognizedSectorNote}</p>}
      {policy.restrictedClaims.length > 0 && (
        <p className="form-note">
          Bu politikada onaylı olsa bile basılmayan iddialar: {policy.restrictedClaims.map((claim) => creativeRestrictedClaimRules[claim].label).join(", ")}.
        </p>
      )}

      {formats.length === 0 && <div className="alert warning">Bu işletme için tanımlı bir platform oran kuralı yok; tasarım hazırlanamaz.</div>}

      {formats.length > 0 && (
        <form action={createCreativeCampaignAction} className="stack-form compact">
          <input type="hidden" name="businessId" value={businessId} />

          <fieldset>
            <legend>Bunu nerede kullanacaksınız?</legend>
            <div className="check-grid">
              {formats.map((choice, index) => (
                <label key={`${choice.platform}-${choice.format}`}>
                  <input type="radio" name="target" value={`${choice.platform}:${choice.format}`} defaultChecked={index === 0} required />
                  {socialVariantPlatformLabels[choice.platform]} · {socialVariantFormatLabels[choice.format]}
                  <small>{choice.targetAspectRatio} · {choice.outputWidth}×{choice.outputHeight} px · {socialVariantRecommendationTypeLabels[choice.recommendationType]}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Ne hazırlayalım?</legend>
            <div className="check-grid">
              {categories.map((category) => (
                <label key={category.category}>
                  <input
                    type="radio"
                    name="category"
                    value={category.category}
                    disabled={!category.available}
                    defaultChecked={category.category === availableCategories[0]?.category}
                    required
                  />
                  {creativeCategoryLabels[category.category]}
                  <small>{category.description}</small>
                  {category.available
                    ? <small>Basılacak bilgi: {category.factPreview.join(" · ")}</small>
                    : <small>{category.blockedReason ?? category.missingReason}</small>}
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            Arka plan (isteğe bağlı)
            <select name="sourceAssetId" defaultValue="">
              <option value="">{creativeNoBackgroundLabel}</option>
              {backgrounds.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.originalFilename} — {creativeBackgroundOriginLabels[asset.origin] ?? asset.origin}
                </option>
              ))}
            </select>
          </label>
          <small className="form-note">{creativeBackgroundNote}</small>
          <small className="form-note">{creativePaletteNote}</small>

          <PendingSubmitButton idle="Tasarımı hazırla" pending="Hazırlanıyor…" className="button primary" disabled={!canCreate || pending} />
          {!availableCategories.length && <small className="form-note">Onaylı bilginiz olmadığı için hiçbir tasarım türü hazırlanamıyor.</small>}
          {pending && <small className="form-note">Bekleyen bir tasarım var; kararınızı verdikten sonra yenisini hazırlayabilirsiniz.</small>}
        </form>
      )}

      {latestFailure && (
        <div className="alert warning">
          Sürüm {latestFailure.version} denemesi tamamlanamadı ({creativeErrorCodeLabels[latestFailure.errorCode ?? ""] ?? "bilinmeyen hata"}). Kullanılan görsel ve işletme bilgileriniz olduğu gibi duruyor.
        </div>
      )}

      {awaitingReview.map((item) => (
        <article className="enhance-review" key={item.id}>
          <div className={`analysis-banner ${item.provenance.toLowerCase()}`} role="note">
            <strong>{creativeProvenanceLabels[item.provenance].short}</strong>
            <span>{creativeProvenanceLabels[item.provenance].long}</span>
            <small>
              {creativeCategoryLabels[item.category]} · {socialVariantPlatformLabels[item.platform]} {socialVariantFormatLabels[item.format]} · {item.targetAspectRatio} · Sürüm {item.version}
              {item.completedAt ? ` · ${dateFormat.format(item.completedAt)}` : ""}
            </small>
          </div>
          <figure>
            {item.outputAvailable
              ? <Image unoptimized src={`/media/creative-campaign/${item.id}`} alt={`${creativeCategoryLabels[item.category]} tasarımı`} width={item.outputWidth ?? 1080} height={item.outputHeight ?? 1080} />
              : <div className="media-placeholder">Önizleme yok</div>}
            <figcaption>Tasarım · {item.outputWidth}×{item.outputHeight} px</figcaption>
          </figure>
          <p className="form-note">{creativeDesignDisclaimer}</p>
          {item.sourceAssetId && <p className="form-note">{creativeBackgroundNote}</p>}
          {item.copy && (
            <dl className="detail-list">
              <div>
                <dt>Tasarıma basılan bilgiler</dt>
                <dd>
                  {item.copy.headline}
                  {item.copy.lines.map((line, index) => <span key={`${item.id}-line-${index}`}> · {line}</span>)}
                </dd>
              </div>
              <div>
                <dt>Bu bilgilerin kaynağı</dt>
                <dd>{item.factRefs.length ? item.factRefs.map((fact) => `${fact.category} (onaylı)`).join(", ") : "—"}</dd>
              </div>
            </dl>
          )}
          <div className="enhance-decision">
            <form action={keepCreativeCampaignAction}>
              <input type="hidden" name="campaignId" value={item.id} />
              {policy.requiresExplicitAcceptance && (
                <label className="form-note">
                  <input type="checkbox" name="policyAcceptance" value={policy.key} required />
                  {acceptanceCheckboxLabel}
                </label>
              )}
              <PendingSubmitButton idle="Sakla" pending="Saklanıyor…" className="button primary" />
            </form>
            <form action={discardCreativeCampaignAction}>
              <input type="hidden" name="campaignId" value={item.id} />
              <PendingSubmitButton idle="At" pending="Atılıyor…" className="mini-button" />
            </form>
            <small className="form-note">Saklarsanız kütüphaneye ayrı bir TASARIM olarak eklenir ve yalnızca özel tasarım ihtiyacına işaretlenebilir; gerçek fotoğraf isteyen bir ihtiyacı karşılayamaz. Bu işlem içeriği onaylamaz, planlamaz veya yayınlamaz.</small>
          </div>
        </article>
      ))}

      {kept.length > 0 && (
        <div className="enhance-kept">
          <span className="eyebrow dark">Saklanan tasarımlar</span>
          <ul>
            {kept.map((item) => (
              <li key={item.id}>
                {item.outputAssetId
                  ? <Image unoptimized src={`/media/${item.outputAssetId}`} alt={`${creativeCategoryLabels[item.category]} tasarımı`} width={item.outputWidth ?? 1080} height={item.outputHeight ?? 1080} />
                  : <div className="media-placeholder">Kütüphaneden silindi</div>}
                <div>
                  <strong>{creativeCategoryLabels[item.category]} · {socialVariantPlatformLabels[item.platform]} {socialVariantFormatLabels[item.format]} · Sürüm {item.version}</strong>
                  <small>{item.decidedAt ? dateFormat.format(item.decidedAt) : ""} · {creativeProvenanceLabels[item.provenance].short}</small>
                  <small>{item.outputAssetId ? "Kütüphanede ayrı bir tasarım olarak duruyor; gerçek fotoğraf yerine geçmez." : "Bu tasarım kütüphaneden silinmiş."}</small>
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
              <dt>Sürüm {item.version} · {creativeCategoryLabels[item.category]} · {dateFormat.format(item.createdAt)}</dt>
              <dd>
                {creativeStatusLabels[item.status]}
                {item.decision ? ` · ${creativeDecisionLabels[item.decision]}` : ""}
                {` · ${creativeProvenanceLabels[item.provenance].short}`}
                {item.errorCode ? ` · ${creativeErrorCodeLabels[item.errorCode] ?? item.errorCode}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
