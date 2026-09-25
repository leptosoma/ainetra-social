import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";
import { getCalendarWorkspace } from "@/features/calendar/service";
import { calendarStatusIcons, calendarStatusLabels, calendarViewLabels, formatCalendarDay, monthLabels } from "@/features/calendar/labels";
import { addCalendarDays, calendarViews, isCalendarDay, shiftCalendarAnchor, type CalendarView } from "@/features/calendar/projection";
import { CalendarGrid } from "./calendar-grid";

function parseView(value?: string): CalendarView {
  return calendarViews.includes(value as CalendarView) ? (value as CalendarView) : "week";
}

function periodLabel(view: CalendarView, range: { from: string; to: string }, anchor: string) {
  if (view === "day") return formatCalendarDay(range.from);
  if (view === "week") return `${formatCalendarDay(range.from)} – ${formatCalendarDay(addCalendarDays(range.to, -1))}`;
  if (view === "month") return `${monthLabels[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
  return `${anchor.slice(0, 4)} yılı`;
}

function href(view: CalendarView, date: string) {
  return `/calendar?view=${view}&date=${date}`;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; event?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const params = await searchParams;
  const view = parseView(params.view);
  // Çapa sunucuda doğrulanır; geçersiz bir tarih sessizce işletme-yerel bugüne düşer.
  const requestedAnchor = params.date && isCalendarDay(params.date) ? params.date : undefined;
  const workspace = await getCalendarWorkspace(user.id, business.id, { view, anchor: requestedAnchor });
  const { counts, range, anchor } = workspace;

  return (
    <>
      <PageHeader
        eyebrow="Çalışma alanı"
        title="Takvim"
        description="Planlanan içerikleriniz, hazır olanlar ve sizden bir şey bekleyenler tek takvimde."
        actions={<Link href="/content-plan" className="button primary">İçerik planı</Link>}
      />

      <section className="calendar-counts" aria-label="Bu dönemin özeti">
        <article><small>Planlı içerik</small><strong>{counts.total}</strong><p>{periodLabel(view, range, anchor)}</p></article>
        <article><small>{calendarStatusLabels.READY}</small><strong>{counts.ready}</strong><p><span aria-hidden="true">{calendarStatusIcons.READY}</span> Medya ve onay tamam</p></article>
        <article><small>Senden bir şey bekliyor</small><strong>{counts.userAction}</strong><p><span aria-hidden="true">{calendarStatusIcons.ACTION_NEEDED}</span> {counts.mediaNeeded} medya · {counts.ainetraCanHelp} öneri · {counts.actionNeeded} onay/düzeltme</p></article>
      </section>

      <section className="calendar-toolbar">
        <div className="calendar-views" role="group" aria-label="Görünüm">
          {calendarViews.map((candidate) => (
            <Link key={candidate} href={href(candidate, anchor)} className={candidate === view ? "active" : ""} aria-current={candidate === view ? "page" : undefined}>
              {calendarViewLabels[candidate]}
            </Link>
          ))}
        </div>
        <strong className="calendar-period">{periodLabel(view, range, anchor)}</strong>
        <div className="calendar-nav">
          <Link href={href(view, shiftCalendarAnchor(view, anchor, -1))} aria-label="Önceki dönem">←</Link>
          <Link href={href(view, workspace.today)}>Bugün</Link>
          <Link href={href(view, shiftCalendarAnchor(view, anchor, 1))} aria-label="Sonraki dönem">→</Link>
        </div>
      </section>

      <CalendarGrid
        businessId={business.id}
        view={view}
        anchor={anchor}
        today={workspace.today}
        events={workspace.events}
        initialEventId={params.event}
      />

      <section className="calendar-legend" aria-label="Durum açıklamaları">
        {(["READY", "MEDIA_NEEDED", "PLANNED", "ACTION_NEEDED", "AINETRA_CAN_HELP"] as const).map((status) => (
          <span key={status}><b aria-hidden="true">{calendarStatusIcons[status]}</b>{calendarStatusLabels[status]}</span>
        ))}
        <small>Saatler {workspace.timezone} saat diliminde gösterilir. Takvimde sürükleyerek tarih değiştirme kapalıdır; yeniden planlama mevcut onay ve sürüm kontrollerinden geçmelidir.</small>
      </section>
    </>
  );
}
