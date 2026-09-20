import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment } from "react";
import { approveContentPlanAction, generateContentPlanAction, regenerateContentPlanAction, regenerateContentPlanItemAction } from "@/actions/content-planning";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { getCurrentUser } from "@/features/auth/session";
import { getContentPlanningState } from "@/features/content-planning/service";
import { listCaptureRequests } from "@/features/capture-engine/service";
import { CaptureList } from "@/components/capture-list";
import { getFirstBusinessForUser } from "@/lib/authorization";

const noticeLabels: Record<string, string> = {
  "plan-ready": "Plan hazırlandı.", "plan-approved": "Plan onaylandı. Yayın onayı ayrıca verilecektir.",
  "plan-regenerated": "Yeni plan sürümü oluşturuldu; strateji tercihleriniz korundu.", "item-regenerated": "Plan öğesi yenilendi; plan tekrar taslak durumuna alındı.",
};

const planStatusLabels = { DRAFT: "Taslak", APPROVED: "Onaylı", SUPERSEDED: "Önceki sürüm" } as const;
const contentTypeLabels = { POST: "Gönderi", REEL: "Dikey video", STORY: "Hikâye", CAROUSEL: "Çoklu görsel" } as const;
const pillarLabels: Record<string, string> = { PRODUCT: "Ürün / hizmet", ATMOSPHERE: "Atmosfer", PEOPLE: "Ekip", SOCIAL_PROOF: "Sosyal kanıt", EDUCATIONAL: "Bilgilendirici", PROMOTIONAL: "Tanıtım", BEHIND_THE_SCENES: "Kamera arkası", EVENT: "Etkinlik", COMMUNITY: "Topluluk", TREND: "Trend" };
const goalLabels: Record<string, string> = { RESERVATIONS: "Rezervasyon", FOOT_TRAFFIC: "Ziyaret", DELIVERY: "Paket servis", PRODUCT_SALES: "Ürün satışı", BRAND_AWARENESS: "Marka bilinirliği", EVENT: "Etkinlik", FOLLOWER_GROWTH: "Takipçi artışı" };
const mediaLabels: Record<string, string> = { PHOTO_PRODUCT: "Ürün fotoğrafı", PHOTO_ATMOSPHERE: "Mekân fotoğrafı", PHOTO_PEOPLE: "Ekip fotoğrafı", VIDEO_VERTICAL: "Dikey video", VIDEO_KITCHEN: "Hazırlık videosu", CUSTOM_GRAPHIC: "Özel tasarım", NO_NEW_MEDIA_REQUIRED: "Yeni medya gerekmiyor" };

export default async function ContentPlanPage({ searchParams }: { searchParams: Promise<{ plan?: string; notice?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const [state, captureRequests, params] = await Promise.all([getContentPlanningState(user.id, business.id), listCaptureRequests(user.id, business.id), searchParams]);
  const selected = state.plans.find((plan) => plan.id === params.plan) ?? state.plans.find((plan) => plan.status !== "SUPERSEDED") ?? state.plans[0];
  const overlappingPlan = selected ? state.plans.find((plan) => plan.id !== selected.id && plan.status !== "SUPERSEDED" && plan.period !== selected.period && plan.startDate <= selected.endDate && plan.endDate >= selected.startDate) : null;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return (
    <>
      <PageHeader eyebrow="Sosyal medya planlaması" title="İçerik planı" description="İş hedeflerinize bağlı 7 günlük uygulama planı veya 30 günlük stratejik görünüm oluşturun." />
      {params.notice && noticeLabels[params.notice] && <div className="brain-notice success" role="status">{noticeLabels[params.notice]}</div>}
      {!state.strategy?.approvedAt && <section className="brain-notice warning"><strong>Önce sosyal stratejiyi onaylayın.</strong> <Link href="/strategy">Strateji ekranına git →</Link></section>}

      <CaptureList requests={captureRequests} />

      <section className="plan-command panel">
        <div><span className="eyebrow dark">Yeni plan</span><h2>Plan dönemini seçin</h2><p>Mevcut aynı plan varsa gereksiz sağlayıcı çağrısı yapılmaz.</p></div>
        <form action={generateContentPlanAction} className="plan-generate-form">
          <input type="hidden" name="businessId" value={business.id} />
          <label>Dönem<select name="period" defaultValue="SEVEN_DAYS"><option value="SEVEN_DAYS">7 günlük uygulama planı</option><option value="THIRTY_DAYS">30 günlük stratejik plan</option></select></label>
          <label>Başlangıç<input type="date" name="startDate" defaultValue={today} required /></label>
          <PendingSubmitButton idle="Planı oluştur" pending="Plan hazırlanıyor…" disabled={!state.strategy?.approvedAt} />
        </form>
      </section>

      {state.plans.length > 0 && <div className="plan-history" aria-label="Plan geçmişi">{state.plans.map((plan) => <Link key={plan.id} href={`/content-plan?plan=${plan.id}`} className={selected?.id === plan.id ? "active" : ""}><strong>{plan.period === "SEVEN_DAYS" ? "7 gün" : "30 gün"} · v{plan.version}</strong><small>{plan.startDate.toLocaleDateString("tr-TR")} · {planStatusLabels[plan.status]}</small></Link>)}</div>}

      {selected ? <>
        {overlappingPlan && <div className="brain-notice warning" role="status">Aynı tarih aralığında ayrıca {overlappingPlan.period === "SEVEN_DAYS" ? "7 günlük" : "30 günlük"} bir plan var. İki plan korunur; uygulamaya geçerken kartları karşılaştırın.</div>}
        <section className="plan-summary panel">
          <div><span className="eyebrow dark">{selected.period === "SEVEN_DAYS" ? "Uygulama planı" : "Stratejik plan"}</span><h2>{selected.strategySummary}</h2><p>{selected.timezone} · {selected.items.length} plan öğesi</p></div>
          <div className="plan-actions"><span className={`status ${selected.status.toLowerCase()}`}>{planStatusLabels[selected.status]}</span>{selected.status !== "SUPERSEDED" && <><form action={regenerateContentPlanAction}><input type="hidden" name="planId" value={selected.id} /><PendingSubmitButton idle="Tüm planı yenile" pending="Yenileniyor…" className="button secondary" /></form>{selected.status !== "APPROVED" && <form action={approveContentPlanAction}><input type="hidden" name="planId" value={selected.id} /><PendingSubmitButton idle="Planı onayla" pending="Onaylanıyor…" /></form>}</>}</div>
        </section>
        <div className="plan-day-list">{selected.items.map((item, index) => {
          const week = Math.floor((item.plannedDate.getTime() - selected.startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
          const previousWeek = index > 0 ? Math.floor((selected.items[index - 1].plannedDate.getTime() - selected.startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) : -1;
          return <Fragment key={item.id}>{selected.period === "THIRTY_DAYS" && week !== previousWeek && <h3 className="plan-week-heading">{week + 1}. hafta</h3>}<article className="plan-item panel">
          <div className="plan-date"><strong>{item.plannedDate.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })}</strong><span>{item.recommendedTime}</span></div>
          <div className="plan-copy"><div className="plan-badges"><span>{item.platform === "INSTAGRAM" ? "Instagram" : item.platform === "FACEBOOK" ? "Facebook" : "TikTok"}</span><span>{contentTypeLabels[item.contentType]}</span><span>{pillarLabels[item.pillar] ?? item.pillar}</span><span>{goalLabels[item.goal.type] ?? item.goal.type}</span></div><h3>{item.topic}</h3><p>{item.concept}</p><div className="plan-detail"><b>Açılış fikri</b><span>{item.hook}</span><b>Metin yönü</b><span>{item.captionDirection} <i>Bu son paylaşım metni değildir.</i></span><b>Harekete çağrı</b><span>{item.cta}</span><b>Neden?</b><span>{item.reasoning}</span></div></div>
          <aside className="media-callout"><span className={item.mediaAvailability === "MISSING" ? "missing" : "available"}>{item.mediaAvailability === "MISSING" ? "Medya gerekli" : item.mediaAvailability === "AVAILABLE" ? "Medya hazır" : "Yeni medya gerekmiyor"}</span><strong>{mediaLabels[item.mediaRequirement] ?? item.mediaRequirement}</strong>{item.mediaAsset && <small>{item.mediaAsset.originalFilename}</small>}<details><summary>Dikkate alınan kurallar</summary><ul>{Array.isArray(item.platformRulesApplied) && item.platformRulesApplied.map((rule) => <li key={String(rule)}>{String(rule)}</li>)}</ul></details>{selected.status !== "SUPERSEDED" && <form action={regenerateContentPlanItemAction}><input type="hidden" name="planId" value={selected.id} /><input type="hidden" name="itemId" value={item.id} /><PendingSubmitButton idle="Bu öğeyi yenile" pending="Yenileniyor…" className="mini-button" /></form>}</aside>
        </article></Fragment>;
        })}</div>
        <section className="approval-separation"><strong>Plan onayı yayın izni değildir.</strong><p>Bu onay yalnızca stratejik takvimi sabitler. İçerik varyantı, son metin ve yayın zamanı Phase 1 onay akışından ayrıca geçer.</p></section>
      </> : <section className="panel brain-empty"><span>✦</span><h2>Henüz içerik planı yok</h2><p>Stratejinizi onaylayıp ilk 7 veya 30 günlük planı oluşturun.</p></section>}
    </>
  );
}
