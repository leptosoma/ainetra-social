"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { mobileMediaQuery, useMediaQuery } from "@/components/use-media-query";
import {
  calendarPlatformLabels,
  calendarStatusClass,
  calendarStatusIcons,
  calendarStatusLabels,
  formatCalendarDay,
  formatCalendarDayLong,
  formatCalendarDayShort,
  monthLabels,
  weekdayIndex,
  weekdayShortLabels,
} from "@/features/calendar/labels";
import {
  addCalendarDays,
  mobileCalendarViews,
  shiftMobileCalendarAnchor,
  type CalendarCounts,
  type CalendarDayGroup,
  type CalendarView,
  type MobileCalendarView,
} from "@/features/calendar/projection";
import { CalendarEventDrawer } from "./calendar-event-drawer";

// P5.5B: telefon takvimi (CSS ile yalnızca ≤820px). Ainetra'ya ait hafif bir liste/ızgara; veri
// masaüstüyle aynı sunucu izdüşümünden gelir ve istemci hiçbir tarihi değiştirmez. Olay seçimi
// aynı çekmeceyi açar; çekmece yalnızca telefon genişliğinde kurulur ki masaüstünde FullCalendar'ın
// çekmecesiyle çakışmasın.

export const mobileViewLabels: Record<MobileCalendarView, string> = {
  day: "Gün",
  "3day": "3 gün",
  week: "Hafta",
  month: "Ay",
};

function periodLabel(view: MobileCalendarView, range: { from: string; to: string }, today: string) {
  if (view === "day") return range.from === today ? `Bugün · ${formatCalendarDayShort(range.from)}` : formatCalendarDayLong(range.from);
  if (view === "month") return `${monthLabels[Number(range.from.slice(5, 7)) - 1]} ${range.from.slice(0, 4)}`;
  return `${formatCalendarDayShort(range.from)} – ${formatCalendarDay(addCalendarDays(range.to, -1))}`;
}

function dayHeading(date: string, today: string) {
  const label = `${weekdayShortLabels[weekdayIndex(date)]} ${formatCalendarDayShort(date)}`;
  if (date === today) return `Bugün · ${label}`;
  if (date === addCalendarDays(today, 1)) return `Yarın · ${label}`;
  return label;
}

function countSentence(counts: CalendarCounts) {
  if (!counts.total) return "Bu dönemde planlı içerik yok.";
  return `${counts.total} içerik · ${counts.ready} hazır · ${counts.userAction} senden bir şey bekliyor`;
}

export function MobileCalendar({ businessId, view, desktopView, anchor, today, range, days, counts, initialEventId }: {
  businessId: string;
  view: MobileCalendarView;
  /** Bağlantılarda masaüstü görünümü korunur. */
  desktopView: CalendarView;
  anchor: string;
  today: string;
  range: { from: string; to: string };
  days: CalendarDayGroup[];
  counts: CalendarCounts;
  initialEventId?: string;
}) {
  const mobile = useMediaQuery(mobileMediaQuery);
  const events = days.flatMap((day) => day.events);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEventId && events.some((event) => event.id === initialEventId) ? initialEventId : null,
  );
  const triggers = useRef(new Map<string, HTMLButtonElement | null>());
  const selected = events.find((event) => event.id === selectedId) ?? null;
  const href = (nextView: MobileCalendarView, date: string) => `/calendar?view=${desktopView}&m=${nextView}&date=${date}`;

  const close = () => {
    const previous = selectedId;
    setSelectedId(null);
    if (previous) triggers.current.get(previous)?.focus();
  };

  return (
    <section className="mobile-calendar mobile-only" aria-labelledby="mobile-calendar-title">
      <header className="mobile-calendar-header">
        <h1 id="mobile-calendar-title">Takvim</h1>
        <p>{countSentence(counts)}</p>
      </header>

      <nav className="mobile-calendar-views" aria-label="Takvim görünümü">
        {mobileCalendarViews.map((candidate) => (
          <Link key={candidate} href={href(candidate, anchor)} className={candidate === view ? "active" : undefined} aria-current={candidate === view ? "page" : undefined}>
            {mobileViewLabels[candidate]}
          </Link>
        ))}
      </nav>

      <div className="mobile-calendar-nav">
        <Link href={href(view, shiftMobileCalendarAnchor(view, anchor, -1))} aria-label="Önceki dönem">←</Link>
        <strong>{periodLabel(view, range, today)}</strong>
        <Link href={href(view, shiftMobileCalendarAnchor(view, anchor, 1))} aria-label="Sonraki dönem">→</Link>
        {!(range.from <= today && today < range.to) && <Link href={href(view, today)} className="mobile-calendar-today">Bugün</Link>}
      </div>

      {view === "month" ? (
        <div className="mobile-month">
          <table>
            <caption className="visually-hidden">{periodLabel(view, range, today)} genel bakış</caption>
            <thead>
              <tr>{weekdayShortLabels.map((label) => <th key={label} scope="col">{label}</th>)}</tr>
            </thead>
            <tbody>
              {chunkMonth(days).map((week, index) => (
                <tr key={index}>
                  {week.map((day, cell) => day ? (
                    <td key={day.date}>
                      <Link
                        href={href("day", day.date)}
                        className={`mobile-month-day${day.date === today ? " today" : ""}`}
                        aria-label={`${formatCalendarDayLong(day.date)}: ${day.counts.total ? `${day.counts.total} içerik, ${day.counts.userAction} senden bir şey bekliyor` : "planlı içerik yok"}`}
                        aria-current={day.date === today ? "date" : undefined}
                      >
                        <span>{Number(day.date.slice(8, 10))}</span>
                        {day.counts.total > 0 && (
                          <i aria-hidden="true" className="mobile-month-dots">
                            {day.counts.userAction > 0 && <b className="action-needed" />}
                            {day.counts.ready > 0 && <b className="ready" />}
                            {day.counts.total - day.counts.userAction - day.counts.ready > 0 && <b className="planned" />}
                          </i>
                        )}
                      </Link>
                    </td>
                  ) : <td key={`blank-${cell}`} />)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mobile-month-legend">
            <span><b className="action-needed" aria-hidden="true" /> Senden bir şey bekliyor</span>
            <span><b className="ready" aria-hidden="true" /> Hazır</span>
            <span><b className="planned" aria-hidden="true" /> Planlandı</span>
          </p>
        </div>
      ) : (
        <ol className="mobile-agenda">
          {days.map((day) => (
            <li key={day.date} className={day.events.length ? undefined : "empty"}>
              <h2>{dayHeading(day.date, today)}</h2>
              {day.events.length ? (
                <ul>
                  {day.events.map((event) => (
                    <li key={event.id}>
                      <button
                        type="button"
                        ref={(node) => { triggers.current.set(event.id, node); }}
                        className={`mobile-event ${calendarStatusClass[event.status]}`}
                        aria-haspopup="dialog"
                        aria-expanded={selectedId === event.id}
                        onClick={() => setSelectedId(event.id)}
                      >
                        <span className="mobile-event-time">{event.time}</span>
                        <span className="mobile-event-body">
                          <strong>{event.title}</strong>
                          <small>{calendarPlatformLabels[event.platform]} · <span aria-hidden="true">{calendarStatusIcons[event.status]}</span> {calendarStatusLabels[event.status]}</small>
                          {event.need && <small className="mobile-event-need">{event.need}</small>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p>Planlı içerik yok.</p>}
            </li>
          ))}
        </ol>
      )}

      {mobile && selected && <CalendarEventDrawer event={selected} businessId={businessId} onClose={close} />}
    </section>
  );
}

/** Ay günlerini Pazartesi başlangıçlı haftalara böler; ay dışı hücreler boş kalır. */
function chunkMonth(days: CalendarDayGroup[]) {
  const cells: (CalendarDayGroup | null)[] = [];
  if (days.length) for (let index = 0; index < weekdayIndex(days[0].date); index += 1) cells.push(null);
  cells.push(...days);
  while (cells.length % 7) cells.push(null);
  const weeks: (CalendarDayGroup | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}
