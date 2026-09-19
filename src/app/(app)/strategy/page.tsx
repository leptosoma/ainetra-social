import { redirect } from "next/navigation";
import { saveCustomStrategyAction, useRecommendedStrategyAction } from "@/actions/content-planning";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";
import { getContentStrategyDisplay } from "@/features/content-planning/service";
import { contentPillars } from "@/features/content-planning/schemas";
import { getCurrentUser } from "@/features/auth/session";
import { getActivePlatformRules } from "@/features/platform-intelligence/service";
import { getFirstBusinessForUser } from "@/lib/authorization";

const platformLabels = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TIKTOK: "TikTok" } as const;
const typeLabels = { POST: "Gönderi", REEL: "Dikey video", STORY: "Hikâye", CAROUSEL: "Carousel" } as const;
const pillarLabels: Record<string, string> = {
  PRODUCT: "Ürün / hizmet", ATMOSPHERE: "Atmosfer", PEOPLE: "İnsanlar", SOCIAL_PROOF: "Sosyal kanıt", EDUCATIONAL: "Bilgilendirici",
  PROMOTIONAL: "Tanıtım", BEHIND_THE_SCENES: "Kamera arkası", EVENT: "Etkinlik", COMMUNITY: "Topluluk", TREND: "Trend",
};

export default async function StrategyPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const [display, rules, params] = await Promise.all([
    getContentStrategyDisplay(user.id, business.id),
    getActivePlatformRules(user.id, business.id),
    searchParams,
  ]);
  const strategy = display.settings;
  const mix = new Map(strategy.contentMix.map((entry) => [entry.pillar, entry.percentage]));
  const officialRules = rules.filter((rule) => rule.source === "OFFICIAL_PLATFORM");
  return (
    <>
      <PageHeader eyebrow="Sosyal strateji" title="Ainetra önerisi veya sizin planınız" description="Platform, sıklık, içerik karışımı ve dil kararlarını burada onaylayın. Plan yenilense bile bu tercihler korunur." />
      {params.notice && <div className="brain-notice success" role="status">Stratejiniz kaydedildi ve içerik planlamasında kullanılacak.</div>}
      <section className="strategy-hero panel">
        <div><span className="eyebrow dark">Ainetra önerisi</span><h2>{display.mode === "CUSTOM" ? "Özelleştirilmiş strateji etkin" : "Başlangıç stratejiniz hazır"}</h2><p>{display.rationale}</p></div>
        <div className="strategy-state"><strong>{display.approvedAt ? "Onaylı" : "Onay bekliyor"}</strong><small>{display.version ? `v${display.version} · ` : ""}{rules.length} güncel kural</small></div>
        <form action={useRecommendedStrategyAction}><input type="hidden" name="businessId" value={business.id} /><button className="button primary" type="submit">Ainetra önerisini kullan</button></form>
      </section>

      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow dark">Özelleştir</span><h2>Kararlar sizde</h2><p>Burada yaptığınız seçimler yapay zekâ tarafından değiştirilemez.</p></div></div>
        <form action={saveCustomStrategyAction} className="strategy-form">
          <input type="hidden" name="businessId" value={business.id} />
          <div className="strategy-platform-grid">
            {strategy.platformSettings.map((setting) => <fieldset className="strategy-platform" key={setting.platform}>
              <legend><label><input type="checkbox" name={`enabled_${setting.platform}`} defaultChecked={setting.enabled} /> {platformLabels[setting.platform]}</label></legend>
              <label>Haftalık sıklık<input type="number" min="1" max="14" name={`frequency_${setting.platform}`} defaultValue={setting.weeklyFrequency} required /></label>
              <div className="format-checks">{(["POST", "REEL", "STORY", "CAROUSEL"] as const).filter((type) => {
                const rule = rules.find((candidate) => candidate.platform === setting.platform && candidate.ruleKey === "ainetra.format.planning");
                const value = rule?.value && typeof rule.value === "object" && !Array.isArray(rule.value) ? rule.value as { contentTypes?: unknown } : {};
                return Array.isArray(value.contentTypes) && value.contentTypes.includes(type);
              }).map((type) => <label key={type}><input type="checkbox" name={`types_${setting.platform}`} value={type} defaultChecked={setting.contentTypes.includes(type)} />{typeLabels[type]}</label>)}</div>
            </fieldset>)}
          </div>
          <div className="mix-editor"><div><h3>İçerik karışımı</h3><p>Toplamın 100 olması gerekir.</p></div><div className="mix-grid">{contentPillars.map((pillar) => <label key={pillar}>{pillarLabels[pillar]}<span><input type="number" min="0" max="100" name={`mix_${pillar}`} defaultValue={mix.get(pillar) ?? 0} />%</span></label>)}</div></div>
          <label className="language-field">İçerik dilleri<input name="languages" defaultValue={strategy.languages.join(", ")} placeholder="tr, en" required /><small>İki harfli dil kodlarını virgülle ayırın.</small></label>
          <p className="form-note">Etkin platformlarda haftalık toplam en fazla 20 içerik olabilir.</p>
          <button className="button secondary" type="submit">Özelleştir ve onayla</button>
        </form>
      </section>

      <section className="panel rule-library">
        <div className="panel-title"><div><span className="eyebrow dark">Neden?</span><h2>Kaynağı belli platform bilgileri</h2><p>Kesin teknik gereklilikleri önerilerden ayırıyoruz; sıklık kararlarını resmi platform kuralı gibi göstermiyoruz.</p></div></div>
        <div className="rule-grid">{officialRules.map((rule) => <article key={rule.id}><span>{platformLabels[rule.platform]}</span><strong>{rule.ruleKey}</strong><p>{rule.category.replaceAll("_", " ")} · {rule.recommendationType.replaceAll("_", " ")}</p>{rule.sourceUrl && <a href={rule.sourceUrl} target="_blank" rel="noreferrer">Resmi kaynağı aç ↗</a>}<small>Güven: {Math.round(rule.confidence * 100)}% · İnceleme: {rule.reviewedAt.toLocaleDateString("tr-TR")}</small></article>)}</div>
      </section>
    </>
  );
}
