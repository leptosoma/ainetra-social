import Link from "next/link";
import type { TodayAgenda } from "@/features/calendar/service";
import type { CalendarEvent } from "@/features/calendar/projection";
import { calendarEventHref } from "@/features/calendar/projection";
import type { CapturePrompt } from "@/features/capture-engine/prompt";
import { calendarPlatformLabels, calendarStatusClass, calendarStatusIcons, calendarStatusLabels, formatCalendarDayLong, formatCalendarDayShort } from "@/features/calendar/labels";
import { CaptureFileButton } from "./capture-file-button";

// P5.5B: telefonda Bugün yüzeyi (CSS ile yalnızca ≤820px). Veri takvimle aynı izdüşümden ve
// yalnızca GÜNCEL açık çekim görevlerinden gelir. Yardım bağlantıları yalnızca var olan akışlara
// gider: çekim görevi yükleme, takvim çekmecesi ve İçerik Planı'ndaki yedek öneri.

function TodayEventCard({ event }: { event: CalendarEvent }) {
  return (
    <li className="today-card">
      <Link href={calendarEventHref(event)}>
        <span className={`calendar-status ${calendarStatusClass[event.status]}`}><b aria-hidden="true">{calendarStatusIcons[event.status]}</b>{calendarStatusLabels[event.status]}</span>
        <strong>{event.time} · {calendarPlatformLabels[event.platform]} · {event.title}</strong>
        <small>{event.need ?? event.statusReason}</small>
      </Link>
      {event.fallbackEligible && event.planId && (
        <Link className="today-help" href={`/content-plan?plan=${event.planId}`}>
          {event.fallbackProposalPending ? "Ainetra önerisini incele" : "Çekemiyorum → Ainetra yardım et"}
        </Link>
      )}
    </li>
  );
}

export function MobileToday({ agenda, prompts, firstName }: { agenda: TodayAgenda; prompts: CapturePrompt[]; firstName: string }) {
  const [prompt] = prompts;
  const { todayEvents, todayCounts, upcomingActions } = agenda;
  return (
    <section className="mobile-today mobile-only" aria-labelledby="mobile-today-title">
      <header className="mobile-today-header">
        <span className="eyebrow dark">{formatCalendarDayLong(agenda.today)}</span>
        <h1 id="mobile-today-title">Bugün, {firstName}</h1>
        <p>
          {todayCounts.total
            ? `Bugün ${todayCounts.total} içerik var. ${todayCounts.ready} hazır${todayCounts.userAction ? `, ${todayCounts.userAction} senden bir şey bekliyor` : ""}.`
            : "Bugün için planlı içerik yok."}
        </p>
      </header>

      {prompt && (
        <section className="today-capture panel" aria-label="Şu an gereken çekim">
          <span className="eyebrow dark">Şu an gerekiyor</span>
          <CaptureFileButton
            variant="primary"
            icon={prompt.mediaType === "VIDEO" ? "◉" : "◎"}
            label={prompt.headline}
            hint={prompt.detail}
            accept={prompt.accept}
            capture="environment"
            captureRequestId={prompt.captureRequestId}
          />
          <details className="capture-guidance">
            <summary>Nasıl çekeyim?</summary>
            <strong>{prompt.title}</strong>
            <p>{prompt.instructions}</p>
          </details>
        </section>
      )}

      <section aria-labelledby="today-list-title">
        <h2 id="today-list-title" className="today-heading">Bugünün içerikleri</h2>
        {todayEvents.length
          ? <ul className="today-list">{todayEvents.map((event) => <TodayEventCard key={event.id} event={event} />)}</ul>
          : <p className="today-empty">Bugün yapılacak bir içerik yok.</p>}
      </section>

      {upcomingActions.length > 0 && (
        <section aria-labelledby="today-next-title">
          <h2 id="today-next-title" className="today-heading">Sıradaki işler</h2>
          <ul className="today-list">
            {upcomingActions.map((event) => (
              <li className="today-card" key={event.id}>
                <Link href={calendarEventHref(event)}>
                  <span className={`calendar-status ${calendarStatusClass[event.status]}`}><b aria-hidden="true">{calendarStatusIcons[event.status]}</b>{calendarStatusLabels[event.status]}</span>
                  <strong>{formatCalendarDayShort(event.date)} · {event.time} · {calendarPlatformLabels[event.platform]}</strong>
                  <small>{event.need ?? event.statusReason}</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/calendar?m=3day" className="today-calendar-link">Takvimi aç →</Link>
    </section>
  );
}
