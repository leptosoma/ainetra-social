import Link from "next/link";
import { redirect } from "next/navigation";
import {
  acceptBusinessAttributeAction,
  acceptSuggestedGoalAction,
  addManualBusinessAttributeAction,
  analyzeBusinessBrainAction,
  editBusinessAttributeAction,
  rejectBusinessAttributeAction,
} from "@/actions/business-brain";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { calculateBusinessBrainCompleteness, getBusinessBrainState } from "@/features/business-brain/service";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";

const categoryLabels: Record<string, string> = {
  DESCRIPTION: "Hakkında",
  PRODUCTS_SERVICES: "Ürünler ve hizmetler",
  TARGET_AUDIENCE: "Hedef kitle",
  LANGUAGE: "Diller",
  BRAND_TONE: "Marka tonu",
  BRAND_PERSONALITY: "Marka kişiliği",
  LOCATION_CONTEXT: "Konum bağlamı",
  WEBSITE: "Web sitesi",
  INSTAGRAM_IDENTITY: "Instagram kimliği",
  BUSINESS_GOAL: "İş hedefleri",
  FACT: "Önemli bilgiler",
  RESTRICTION: "İçerik kısıtları",
  AVOID_WORD: "Kaçınılacak kelimeler / iddialar",
  NOTE: "Marka notları",
};

const categoryOrder = Object.keys(categoryLabels);
const manualCategories = ["DESCRIPTION", "PRODUCTS_SERVICES", "TARGET_AUDIENCE", "LANGUAGE", "BRAND_TONE", "LOCATION_CONTEXT", "FACT", "RESTRICTION", "AVOID_WORD", "NOTE"];

const statusLabels: Record<string, string> = {
  CONFIRMED: "Onaylandı",
  INFERRED: "Otomatik öneri",
  NEEDS_CONFIRMATION: "Onay bekliyor",
  REJECTED: "Reddedildi",
};

const sourceLabels: Record<string, string> = {
  USER: "Siz eklediniz",
  WEBSITE: "Web sitesi",
  INSTAGRAM: "Instagram",
  AI_INFERENCE: "Yapay zekâ tahmini",
  IMPORT: "İçe aktarıldı",
};

function confidenceLabel(confidence: number | null) {
  if (confidence === null) return null;
  if (confidence >= 0.8) return "Yüksek güven";
  if (confidence >= 0.6) return "Orta güven";
  return "Düşük güven";
}

function valueText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "type" in value) {
    const goal = value as { type: string; rationale?: string };
    return `${goal.type.replaceAll("_", " ")}${goal.rationale ? ` — ${goal.rationale}` : ""}`;
  }
  return JSON.stringify(value);
}

export default async function BusinessBrainPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const state = await getBusinessBrainState(user.id, business.id);
  const completeness = calculateBusinessBrainCompleteness(state);
  const latestRun = state.analysisRuns[0];
  const inputSources = Array.isArray(latestRun?.inputSources) ? latestRun.inputSources as Array<Record<string, unknown>> : [];
  const websiteFailed = inputSources.some((source) => source.type === "WEBSITE" && source.status === "FAILED");
  const pending = state.attributes.filter((item) => item.verificationStatus === "INFERRED" || item.verificationStatus === "NEEDS_CONFIRMATION");
  const visible = state.attributes.filter((item) => item.verificationStatus !== "REJECTED");
  const grouped = categoryOrder.map((category) => ({ category, items: visible.filter((item) => item.category === category) })).filter((group) => group.items.length);
  const { notice } = await searchParams;

  return (
    <>
      <PageHeader eyebrow="Ainetra Business Brain" title="İşletmeni tanıyalım" description="Web sitenizden çıkarılan bilgileri siz onaylamadan doğru kabul etmeyiz. Güvenilir işletme hafızasını birlikte oluşturun." />

      {notice && <div className={`brain-notice ${notice === "analysis-complete" ? "success" : "warning"}`} role="status">
        {notice === "analysis-complete" ? "Analiz tamamlandı. Aşağıdaki önerileri kontrol edin." : "Analiz tamamlanamadı; işletme bilgilerinizi elle ekleyerek devam edebilirsiniz."}
      </div>}

      <section className="brain-progress panel">
        <div><span className="eyebrow dark">Profil durumu</span><h2>İşletme hafızası {completeness.percent}% hazır</h2><p>Bu oran yalnızca temel alanların tamamlanmasını gösterir.</p></div>
        <div className="progress-rail" aria-label={`İşletme hafızası yüzde ${completeness.percent} tamamlandı`}><i style={{ width: `${completeness.percent}%` }} /></div>
        {completeness.missing.length > 0 && <small>Eksik: {completeness.missing.join(", ")}</small>}
      </section>

      <div className="onboarding-steps" aria-label="Business Brain adımları">
        {["Temel bilgiler", "Online varlık", "Analiz", "Doğrulama", "Kaydet"].map((step, index) => <span key={step} className={index < 3 || latestRun ? "active" : ""}><b>{index + 1}</b>{step}</span>)}
      </div>

      <section className="panel brain-intake">
        <div className="panel-title"><div><span className="eyebrow dark">1–3 · İşletmeni tanıtalım</span><h2>Temel bilgiler ve online varlık</h2><p>Web sitesi yoksa veya okunamazsa süreç durmaz; bilgileri elle ekleyebilirsiniz.</p></div></div>
        <form action={analyzeBusinessBrainAction} className="form-grid">
          <input type="hidden" name="businessId" value={state.id} />
          <label>İşletme adı<input name="name" defaultValue={state.name} required /></label>
          <label>Sektör<input name="sector" defaultValue={state.sector} required /></label>
          <label>Konum<input name="location" defaultValue={state.location ?? ""} /></label>
          <label>Web sitesi<input name="website" type="url" placeholder="https://..." defaultValue={state.website ?? ""} /></label>
          <label>Instagram kullanıcı adı / URL<input name="instagramHandle" defaultValue={state.instagramHandle ?? ""} /><small className="field-note">Not connected · Bu aşamada Instagram verisi çekilmez.</small></label>
          <label>Saat dilimi<input name="timezone" defaultValue={state.timezone} required /></label>
          <div className="span-2 brain-analyze-row">
            <PendingSubmitButton idle={latestRun ? "Yeniden analiz et" : "İşletmemi analiz et"} pending="Güvenli analiz yapılıyor…" />
            <small>Her yeni sonuç öneri olarak gelir; onayladığınız bilgiler değiştirilmez.</small>
          </div>
        </form>
        {latestRun && <div className="analysis-meta"><span className={`status-pill ${latestRun.status.toLowerCase()}`}>{latestRun.status.replaceAll("_", " ")}</span><span>{latestRun.provider} / {latestRun.model}</span><span>{latestRun.createdAt.toLocaleString("tr-TR")}</span>{websiteFailed && <span>Web sitesine ulaşılamadı; diğer bilgilerle devam edildi.</span>}</div>}
      </section>

      <section className="section-heading brain-review-heading"><div><span className="eyebrow dark">4 · Doğrulama</span><h2>İşletmeni böyle anladım</h2><p>{pending.length ? `${pending.length} bilgi sizin onayınızı bekliyor.` : "Şu anda bekleyen öneri yok."}</p></div></section>

      {grouped.length ? <div className="brain-card-grid">{grouped.map((group) => (
        <section className="panel brain-card" key={group.category}>
          <div className="panel-title"><div><span className="eyebrow dark">{group.items.length} kayıt</span><h2>{categoryLabels[group.category]}</h2></div></div>
          <div className="attribute-list">{group.items.map((item) => {
            const text = valueText(item.value);
            const isGoal = item.category === "BUSINESS_GOAL";
            const goalType = isGoal && item.value && typeof item.value === "object" && "type" in item.value ? String((item.value as { type: unknown }).type) : "";
            const existingGoal = state.goals.find((goal) => goal.type === goalType);
            const hasPrimary = state.goals.some((goal) => goal.priority === "PRIMARY");
            const secondaryCount = state.goals.filter((goal) => goal.priority === "SECONDARY").length;
            const canPrimary = !hasPrimary || existingGoal?.priority === "PRIMARY";
            const canSecondary = secondaryCount < 2 || existingGoal?.priority === "SECONDARY";
            return <article className={`attribute-row ${item.verificationStatus.toLowerCase()}`} key={item.id}>
              <div className="attribute-copy"><p>{text}</p><div className="attribute-badges"><span>{sourceLabels[item.source]}</span><span>{statusLabels[item.verificationStatus]}</span>{confidenceLabel(item.confidence) && <span>{confidenceLabel(item.confidence)}</span>}</div></div>
              {!item.isCanonical && <div className="attribute-actions">
                {isGoal ? <form action={acceptSuggestedGoalAction}><input type="hidden" name="attributeId" value={item.id} /><select name="priority" aria-label="Hedef önceliği" defaultValue={canPrimary ? "PRIMARY" : "SECONDARY"}><option value="PRIMARY" disabled={!canPrimary}>Ana hedef</option><option value="SECONDARY" disabled={!canSecondary}>İkincil hedef</option></select><button className="mini-button accept" type="submit" disabled={!canPrimary && !canSecondary}>Onayla</button></form>
                  : <form action={acceptBusinessAttributeAction}><input type="hidden" name="attributeId" value={item.id} /><button className="mini-button accept" type="submit">Onayla</button></form>}
                {!isGoal && <details><summary>Düzenle</summary><form action={editBusinessAttributeAction}><input type="hidden" name="attributeId" value={item.id} /><input name="value" defaultValue={text} required /><button className="mini-button" type="submit">Düzelt ve onayla</button></form></details>}
                <form action={rejectBusinessAttributeAction}><input type="hidden" name="attributeId" value={item.id} /><button className="mini-button reject" type="submit">Reddet</button></form>
              </div>}
            </article>;
          })}</div>
        </section>
      ))}</div> : <section className="panel brain-empty"><span>◇</span><h2>Henüz analiz sonucu yok</h2><p>Yukarıdaki bilgilerle analiz başlatın veya bildiğiniz bir bilgiyi elle ekleyin.</p></section>}

      <section className="panel brain-manual">
        <div><span className="eyebrow dark">Eksik bilgi</span><h2>İşletme hafızasına siz ekleyin</h2><p>Sizin eklediğiniz bilgi doğrudan onaylanmış kullanıcı verisi olur.</p></div>
        <form action={addManualBusinessAttributeAction}>
          <input type="hidden" name="businessId" value={state.id} />
          <label>Alan<select name="category">{manualCategories.map((category) => <option value={category} key={category}>{categoryLabels[category]}</option>)}</select></label>
          <label>Bilgi<input name="value" maxLength={500} required placeholder="Örn. Vegan seçeneklerimiz bulunur" /></label>
          <button className="button secondary" type="submit">Onaylanmış bilgi olarak ekle</button>
        </form>
      </section>

      <section className="brain-finish"><div><span className="eyebrow dark">5 · Kaydet</span><h2>{pending.length ? "Önerileri gözden geçirmeye devam edin" : completeness.percent === 100 ? "İşletme hafızanız hazır" : "Eksik alanları tamamlayın"}</h2><p>Yalnızca sizin onayladığınız kayıtlar gelecekteki Ainetra modüllerinin güvenilir bağlamına girer.</p></div><Link href="/dashboard" className="button primary">Dashboard’a dön</Link></section>
    </>
  );
}
