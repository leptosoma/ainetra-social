"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import multiMonthPlugin from "@fullcalendar/multimonth";
import trLocale from "@fullcalendar/core/locales/tr";
import type { EventContentArg, EventInput, MoreLinkArg } from "@fullcalendar/core";
import { desktopMediaQuery, useMediaQuery } from "@/components/use-media-query";
import {
  calendarPlatformLabels,
  calendarStatusClass,
  calendarStatusIcons,
  calendarStatusLabels,
  formatCalendarDayLong,
} from "@/features/calendar/labels";
import type { CalendarEvent, CalendarView } from "@/features/calendar/projection";
import { CalendarEventDrawer } from "./calendar-event-drawer";

// P5.5A: takvim yüzeyi ve olay çekmecesi; yalnızca /calendar rotasında yüklenir.
//
// YERLEŞİM: docs/oss-architecture-spike.md kararı uyarınca gün/hafta/ay/yıl ızgarasını
// FullCalendar **Standard (MIT)** çizer: timeGridDay / timeGridWeek / dayGridMonth /
// multiMonthYear. Premium (Scheduler, resource, timeline) eklenti KULLANILMAZ.
// Kütüphaneye kalan tek iş yerleşimdir: olay verisi, durum sözlüğü, etiketler, çekmece ve
// eylemler Ainetra'ya aittir ve olay kimliği her zaman bir Ainetra alan kimliğidir.
//
// SAAT DİLİMİ: izdüşüm tarih/saati zaten İŞLETME saat diliminde üretir. Bu yüzden takvime
// bölgesiz (naif) bir zaman dizgesi verilir ve FullCalendar `timeZone="UTC"` ile çalıştırılır;
// böylece tarayıcının saat dilimi hiçbir olayı kaydıramaz. Aynı nedenle `now` da işletme-yerel
// bugünden türetilir ve tarayıcı saatine dayanan `nowIndicator` kapalıdır.
//
// SÜRÜKLE-BIRAK bilinçli olarak KAPALIDIR (interaction eklentisi kurulu bile değildir): güvenli
// bir yeniden planlama kiracı, sürüm, onay, saat dilimi ve çakışma kontrollerinden geçen sunucu
// tarafı bir mutasyon gerektirir; bu P5.5A kapsamını genişletirdi. İstemci hiçbir şeyi yeniden
// planlamaz.
//
// ERİŞİLEBİLİRLİK: FullCalendar'ın varsayılan olay öğesi href'siz bir <a>'dır ve klavyeyle
// odaklanamaz. Bu yüzden olay içeriğini kendimiz basıyoruz ve tıklanabilir öğe gerçek bir
// <button>'dır: Tab ile odaklanır, Enter/Space ile çekmeceyi açar, Esc ile kapanır ve odak
// tetikleyen düğmeye geri döner. Durum renk DIŞINDA simge ve düz Türkçe metinle de anlatılır.
// Çekmecede yalnızca GERÇEKTEN ÇALIŞAN ve bağlama uygun eylemler gösterilir.
//
// P5.5B: FullCalendar yalnızca masaüstü/tablette (>820px) kurulur; telefonda Ainetra'nın hafif
// `MobileCalendar` sunumu gösterilir. Çekmece `calendar-event-drawer.tsx` içindedir.

/** Ainetra görünümü → FullCalendar Standard görünümü. */
const fullCalendarViews: Record<CalendarView, string> = {
  day: "timeGridDay",
  week: "timeGridWeek",
  month: "dayGridMonth",
  year: "multiMonthYear",
};

type CalendarGridProps = {
  businessId: string;
  view: CalendarView;
  /** İşletme-yerel çapa günü; FullCalendar'ın açılacağı dönem. */
  anchor: string;
  today: string;
  events: CalendarEvent[];
  initialEventId?: string;
};

/** Masaüstü/tablet takvimi; telefonda yalnızca JavaScript'siz düz liste yedeği kalır. */
export function CalendarGrid(props: CalendarGridProps) {
  const desktop = useMediaQuery(desktopMediaQuery);
  return (
    <>
      {desktop && <DesktopCalendar {...props} />}
      {/* FullCalendar ızgarayı yalnızca tarayıcıda kurar; JavaScript çalışmadığında bu dönemin
          olayları düz bir liste olarak yine de okunabilir kalır. */}
      <noscript>
        <ul className="calendar-noscript" aria-label="Bu dönemin planlı içerikleri">
          {props.events.map((event) => (
            <li key={event.id}>
              <strong>{formatCalendarDayLong(event.date)} · {event.time}</strong>
              {" — "}{calendarPlatformLabels[event.platform]} · {event.title}
              {" — "}<span aria-hidden="true">{calendarStatusIcons[event.status]}</span> {calendarStatusLabels[event.status]}
              {event.need ? ` — ${event.need}` : ""}
            </li>
          ))}
        </ul>
      </noscript>
    </>
  );
}

function DesktopCalendar({ businessId, view, anchor, today, events, initialEventId }: CalendarGridProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEventId && events.some((event) => event.id === initialEventId) ? initialEventId : null,
  );
  const triggers = useRef(new Map<string, HTMLButtonElement | null>());
  const selected = events.find((event) => event.id === selectedId) ?? null;

  const close = useCallback(() => {
    const previous = selectedId;
    setSelectedId(null);
    if (previous) triggers.current.get(previous)?.focus();
  }, [selectedId]);

  // Kütüphaneye yalnızca yerleşim için gereken alanlar verilir; Ainetra olayı extendedProps'ta
  // olduğu gibi taşınır ve olay kimliği Ainetra kimliğidir.
  const fcEvents = useMemo<EventInput[]>(() => events.map((event) => ({
    id: event.id,
    title: event.title,
    start: `${event.date}T${event.time}:00`,
    classNames: [`calendar-fc-event`, calendarStatusClass[event.status]],
    extendedProps: { ainetra: event },
  })), [events]);

  // Gün/hafta görünümü tam günü kapsar; hiçbir olay saat aralığı dışında kalmasın diye ilk
  // olayın saatine kaydırılır.
  const scrollTime = useMemo(() => {
    const earliest = events.map((event) => event.time).sort()[0];
    return earliest ? `${earliest.slice(0, 2)}:00:00` : "08:00:00";
  }, [events]);

  const compact = view === "month" || view === "year";

  const renderEvent = (arg: EventContentArg) => {
    const event = arg.event.extendedProps.ainetra as CalendarEvent;
    return (
      <button
        type="button"
        ref={(node) => { triggers.current.set(event.id, node); }}
        className={`calendar-chip ${calendarStatusClass[event.status]}${compact ? " compact" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={selectedId === event.id}
        onClick={() => setSelectedId(event.id)}
      >
        <span aria-hidden="true">{calendarStatusIcons[event.status]}</span>
        <strong>{event.time}</strong>
        <span className="calendar-chip-title">{compact ? calendarPlatformLabels[event.platform] : event.title}</span>
        <small>{compact ? calendarStatusLabels[event.status] : `${calendarPlatformLabels[event.platform]} · ${calendarStatusLabels[event.status]}`}</small>
      </button>
    );
  };

  // "+N daha" kütüphane açılır kutusu yerine Ainetra'nın gün görünümüne götürür; gün görünümünde
  // olayın tüm bağlamı ve çekmecesi vardır.
  const openDay = (arg: MoreLinkArg) => {
    router.push(`/calendar?view=day&date=${arg.date.toISOString().slice(0, 10)}`);
  };

  return (
    <>
      <div className={`calendar-surface calendar-surface-${view}`}>
        <FullCalendar
          // Görünüm ya da dönem değiştiğinde takvim yeniden kurulur; initialView/initialDate
          // yalnızca kuruluşta okunur.
          key={`${view}:${anchor}`}
          plugins={[dayGridPlugin, timeGridPlugin, multiMonthPlugin]}
          initialView={fullCalendarViews[view]}
          initialDate={anchor}
          now={`${today}T00:00:00`}
          timeZone="UTC"
          locale={trLocale}
          firstDay={1}
          headerToolbar={false}
          height="auto"
          events={fcEvents}
          eventContent={renderEvent}
          eventClick={(arg) => { arg.jsEvent.preventDefault(); setSelectedId((arg.event.extendedProps.ainetra as CalendarEvent).id); }}
          moreLinkClick={openDay}
          moreLinkContent={(arg) => `+${arg.num} daha`}
          nowIndicator={false}
          navLinks={false}
          selectable={false}
          editable={false}
          eventStartEditable={false}
          eventDurationEditable={false}
          defaultTimedEventDuration="00:45:00"
          allDaySlot={false}
          expandRows
          scrollTime={scrollTime}
          slotDuration="01:00:00"
          slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          fixedWeekCount
          views={{
            timeGridDay: { dayHeaderFormat: { weekday: "long", day: "numeric", month: "long" } },
            dayGridMonth: { dayMaxEvents: 3 },
            multiMonthYear: { multiMonthMaxColumns: 4, dayMaxEvents: 1 },
          }}
        />
      </div>
      {events.length === 0 && <p className="calendar-empty-day">Bu dönem için planlı içerik yok.</p>}


      {selected && <CalendarEventDrawer event={selected} businessId={businessId} onClose={close} />}
    </>
  );
}
