import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { deriveWorkflowLabel } from "@/features/content/service";
import { EmptyBusiness } from "@/components/empty-business";
import { CaptureList } from "@/components/capture-list";
import { ContentStockSummary } from "@/components/content-stock-summary";
import { calculateBusinessBrainCompleteness, getBusinessBrainState } from "@/features/business-brain/service";
import { listCaptureRequests, listCurrentCaptureRequests } from "@/features/capture-engine/service";
import { buildCapturePrompt, type CapturePrompt } from "@/features/capture-engine/prompt";
import { MobileToday } from "@/components/mobile-today";
import { getContentStock } from "@/features/content-stock/service";
import { getCalendarWeekSummary, getTodayAgenda } from "@/features/calendar/service";
import { calendarEventHref } from "@/features/calendar/projection";
import { calendarPlatformLabels, calendarStatusClass, calendarStatusIcons, calendarStatusLabels, formatCalendarDay, formatCalendarDayShort } from "@/features/calendar/labels";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <><div className="topbar"><span>Production workspace</span></div><EmptyBusiness /></>;

  const [variants, brainState, captureRequests, contentStock, week, agenda, currentCaptures] = await Promise.all([
    prisma.contentVariant.findMany({ where: { contentItem: { businessId: business.id } }, include: { approvals: true, scheduledPosts: true } }),
    getBusinessBrainState(user.id, business.id),
    listCaptureRequests(user.id, business.id),
    getContentStock(user.id, business.id),
    getCalendarWeekSummary(user.id, business.id),
    getTodayAgenda(user.id, business.id),
    listCurrentCaptureRequests(user.id, business.id, { limit: 3 }),
  ]);
  const prompts = currentCaptures.map(buildCapturePrompt).filter((prompt): prompt is CapturePrompt => prompt !== null);
  const brain = calculateBusinessBrainCompleteness(brainState);
  const awaitingConfirmation = brainState.attributes.filter((item) => item.verificationStatus === "INFERRED" || item.verificationStatus === "NEEDS_CONFIRMATION").length;
  const labels = variants.map(deriveWorkflowLabel);
  const counts = {
    draft: labels.filter((label) => label === "DRAFT").length,
    approved: labels.filter((label) => label === "APPROVED").length,
    scheduled: labels.filter((label) => label === "SCHEDULED").length,
  };
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";

  return (
    <>
      <MobileToday agenda={agenda} prompts={prompts} firstName={user.name.split(" ")[0]} />
      {/* P5.5B: telefonda yukarıdaki Bugün yüzeyi gösterilir; masaüstü panosu değişmeden kalır. */}
      <div className="desktop-only">
      <div className="topbar"><span>{business.location ?? "Ainetra Social"}</span><span className="live-dot">Foundation aktif</span></div>
      <section className="dashboard-hero">
        <div><span className="eyebrow">Bugünün çalışma alanı</span><h1>{greeting}, {user.name.split(" ")[0]}.</h1><p><strong>{business.name}</strong> için içerik operasyonunuz hazır.</p></div>
        <div className="hero-orbit"><span>Bu hafta</span><strong>{week.counts.total}</strong><small>planlı içerik</small></div>
      </section>
      <section className="week-brief panel" aria-label="Bu haftanın operasyon özeti">
        <div className="week-brief-copy">
          <span className="eyebrow dark">Bu hafta</span>
          <h2>{week.counts.total ? `Bu hafta ${week.counts.total} içerik planlandı. ${week.counts.ready} hazır. ${week.counts.userAction} senden bir şey bekliyor.` : "Bu hafta için planlı içerik yok."}</h2>
          <p>{week.counts.total ? `${formatCalendarDayShort(week.weekStart)} – ${formatCalendarDay(week.weekEnd)} · ${week.timezone}` : "İçerik planı oluşturduğunuzda bu hafta burada özetlenir."}</p>
        </div>
        <ul className="week-brief-actions">
          {week.nextActions.map((event) => (
            <li key={event.id}>
              <Link href={calendarEventHref(event)}>
                <span className={`calendar-status ${calendarStatusClass[event.status]}`}><b aria-hidden="true">{calendarStatusIcons[event.status]}</b>{calendarStatusLabels[event.status]}</span>
                <strong>{formatCalendarDayShort(event.date)} · {event.time} · {calendarPlatformLabels[event.platform]}</strong>
                <small>{event.need ?? event.statusReason}</small>
              </Link>
            </li>
          ))}
          {!week.nextActions.length && <li className="week-brief-clear">Sizden bekleyen bir iş yok.</li>}
        </ul>
        <Link href="/calendar" className="week-brief-link">Takvimi aç →</Link>
      </section>
      <Link href="/business-brain" className="brain-dashboard-cta">
        <div><span className="eyebrow">Ainetra Business Brain</span><h2>{brain.percent === 100 ? "İşletme hafızası hazır." : "Ainetra'nın işletmenizi daha iyi tanımasını sağlayın."}</h2><p>{awaitingConfirmation ? `${awaitingConfirmation} bilgi onayınızı bekliyor.` : brain.missing.length ? `Eksik: ${brain.missing.join(", ")}` : "Onaylanmış bilgiler güvenilir bağlam olarak hazır."}</p></div>
        <strong>{brain.percent}%<small> tamamlandı</small></strong>
      </Link>
      <ContentStockSummary stock={contentStock} />
      <CaptureList requests={captureRequests} variant="compact" />
      <section className="section-heading secondary"><div><span className="eyebrow dark">Detaylar</span><h2>İçerik varyantı durumları</h2></div></section>
      <section className="metrics-grid secondary">
        <article><span className="metric-icon cream">✎</span><div><small>Taslak</small><strong>{counts.draft}</strong><p>Üzerinde çalışılacak</p></div></article>
        <article><span className="metric-icon gold">✓</span><div><small>Onaylı</small><strong>{counts.approved}</strong><p>Planlamaya hazır</p></div></article>
        <article><span className="metric-icon green">↗</span><div><small>Planlandı</small><strong>{counts.scheduled}</strong><p>Yayın sırasını bekliyor</p></div></article>
      </section>
      <section className="section-heading"><div><span className="eyebrow dark">Hızlı başlangıç</span><h2>Sıradaki işiniz ne?</h2></div></section>
      <div className="quick-grid">
        <Link href="/media" className="quick-card"><span>01</span><h3>Medya yükleyin</h3><p>Markanızın görsel arşivini güvenle oluşturun.</p><b>Medya kütüphanesine git →</b></Link>
        <Link href="/content" className="quick-card dark"><span>02</span><h3>İçerik oluşturun</h3><p>Platforma özel metin, CTA ve görseli tek yerde yönetin.</p><b>Yeni içerik oluştur →</b></Link>
        <Link href="/brand" className="quick-card"><span>03</span><h3>Markayı netleştirin</h3><p>Hedef kitlenizi, ses tonunuzu ve amaçlarınızı güncelleyin.</p><b>Marka ayarlarını aç →</b></Link>
      </div>
      </div>
    </>
  );
}
