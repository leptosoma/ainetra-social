"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import multiMonthPlugin from "@fullcalendar/multimonth";
import trLocale from "@fullcalendar/core/locales/tr";
import type { EventContentArg, EventInput, MoreLinkArg } from "@fullcalendar/core";
import { uploadMediaAction } from "@/actions/media";
import {
  calendarContentTypeLabels,
  calendarMediaLabels,
  calendarPlatformLabels,
  calendarStatusClass,
  calendarStatusIcons,
  calendarStatusLabels,
  formatCalendarDayLong,
} from "@/features/calendar/labels";
import type { CalendarEvent, CalendarView } from "@/features/calendar/projection";

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
// ODAK TUZAĞI: çekmece `aria-modal="true"` ile kipli olduğunu söyler; bunun klavyede de doğru
// olması gerekir. Açıkken Tab/Shift+Tab çekmecenin odaklanabilir öğeleri arasında döner ve
// arkadaki takvim düğmelerine geçmez, aksi hâlde kipli olduğu duyurulan bir katmanın arkasında
// görünmez bir gezinme olurdu.

const acceptByRequirement: Record<string, string> = {
  PHOTO_PRODUCT: "image/jpeg,image/png,image/webp",
  PHOTO_ATMOSPHERE: "image/jpeg,image/png,image/webp",
  PHOTO_PEOPLE: "image/jpeg,image/png,image/webp",
  CUSTOM_GRAPHIC: "image/jpeg,image/png,image/webp",
  VIDEO_VERTICAL: "video/mp4,video/quicktime,video/webm",
  VIDEO_KITCHEN: "video/mp4,video/quicktime,video/webm",
};

/** Çekmece içinde Tab ile durulabilecek öğeler; odak tuzağının sınırlarını bunlar belirler. */
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Ainetra görünümü → FullCalendar Standard görünümü. */
const fullCalendarViews: Record<CalendarView, string> = {
  day: "timeGridDay",
  week: "timeGridWeek",
  month: "dayGridMonth",
  year: "multiMonthYear",
};

function StatusBadge({ status }: { status: CalendarEvent["status"] }) {
  return (
    <span className={`calendar-status ${calendarStatusClass[status]}`}>
      <b aria-hidden="true">{calendarStatusIcons[status]}</b>
      {calendarStatusLabels[status]}
    </span>
  );
}

export function CalendarGrid({ businessId, view, anchor, today, events, initialEventId }: {
  businessId: string;
  view: CalendarView;
  /** İşletme-yerel çapa günü; FullCalendar'ın açılacağı dönem. */
  anchor: string;
  today: string;
  events: CalendarEvent[];
  initialEventId?: string;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEventId && events.some((event) => event.id === initialEventId) ? initialEventId : null,
  );
  const triggers = useRef(new Map<string, HTMLButtonElement | null>());
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerTitleId = useId();
  const selected = events.find((event) => event.id === selectedId) ?? null;

  const close = useCallback(() => {
    const previous = selectedId;
    setSelectedId(null);
    if (previous) triggers.current.get(previous)?.focus();
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); return; }
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const drawer = drawerRef.current;
      if (!drawer) return;
      // Gizli öğeler (kapalı <details> içeriği gibi) sırada yer almamalıdır.
      const stops = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((node) => !node.hasAttribute("disabled") && node.tabIndex >= 0 && node.getClientRects().length > 0);
      if (stops.length === 0) { event.preventDefault(); return; }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !drawer.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected, close]);

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

      {/* FullCalendar ızgarayı yalnızca tarayıcıda kurar; JavaScript çalışmadığında bu dönemin
          olayları düz bir liste olarak yine de okunabilir kalır. */}
      <noscript>
        <ul className="calendar-noscript" aria-label="Bu dönemin planlı içerikleri">
          {events.map((event) => (
            <li key={event.id}>
              <strong>{formatCalendarDayLong(event.date)} · {event.time}</strong>
              {" — "}{calendarPlatformLabels[event.platform]} · {event.title}
              {" — "}<span aria-hidden="true">{calendarStatusIcons[event.status]}</span> {calendarStatusLabels[event.status]}
              {event.need ? ` — ${event.need}` : ""}
            </li>
          ))}
        </ul>
      </noscript>

      {selected && (
        <div className="calendar-drawer-layer">
          <div className="calendar-drawer-backdrop" onClick={close} aria-hidden="true" />
          <aside ref={drawerRef} className="calendar-drawer" role="dialog" aria-modal="true" aria-labelledby={drawerTitleId}>
            <header>
              <div>
                <StatusBadge status={selected.status} />
                <p className="calendar-drawer-when">{formatCalendarDayLong(selected.date)} · {selected.time} · {calendarPlatformLabels[selected.platform]}{selected.contentType ? ` · ${calendarContentTypeLabels[selected.contentType]}` : ""}</p>
                <h2 id={drawerTitleId}>{selected.title}</h2>
              </div>
              <button type="button" ref={closeRef} className="icon-button static" onClick={close} aria-label="Kapat">×</button>
            </header>
            <p className="calendar-drawer-summary">{selected.summary}</p>
            <dl className="calendar-drawer-facts">
              <div><dt>Durum</dt><dd>{selected.statusReason}</dd></div>
              {selected.need && <div><dt>İhtiyaç</dt><dd>{selected.need}</dd></div>}
              {selected.mediaRequirement && <div><dt>Medya ihtiyacı</dt><dd>{calendarMediaLabels[selected.mediaRequirement]}</dd></div>}
              {selected.mediaFilename && <div><dt>Bağlı medya</dt><dd>{selected.mediaFilename}{selected.designedCreative ? " (tasarım)" : ""}</dd></div>}
              {selected.accountName && <div><dt>Hesap</dt><dd>{selected.accountName}</dd></div>}
            </dl>

            {selected.captureGuidance && (
              <details className="calendar-drawer-guidance">
                <summary>Nasıl çekeyim?</summary>
                <strong>{selected.captureGuidance.title}</strong>
                <p>{selected.captureGuidance.instructions}</p>
              </details>
            )}

            {selected.mediaRequirement && selected.mediaRequirement !== "NO_NEW_MEDIA_REQUIRED" && selected.requiresUserAction && (
              <form action={uploadMediaAction} className="calendar-drawer-upload" encType="multipart/form-data">
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="tags" value={selected.mediaRequirement} />
                <label>Medya ekle<input name="file" type="file" accept={acceptByRequirement[selected.mediaRequirement]} required /></label>
                <button className="mini-button accept" type="submit">Yükle</button>
              </form>
            )}

            <div className="calendar-drawer-actions">
              {selected.contentItemId && <Link className="mini-button" href={`/content/${selected.contentItemId}`}>İçeriği aç</Link>}
              {selected.fallbackEligible && selected.planId && (
                <Link className="mini-button" href={`/content-plan?plan=${selected.planId}`}>
                  {selected.fallbackProposalPending ? "Ainetra önerisini incele" : "Çekemiyorum → Ainetra yardım et"}
                </Link>
              )}
              {selected.mediaAssetId && selected.mediaType === "IMAGE" && <Link className="mini-button" href={`/media/${selected.mediaAssetId}/analysis`}>Görsel araçları</Link>}
            </div>
            <small className="calendar-drawer-note">Bu ekran hiçbir onayı veya yayın zamanını kendi başına değiştirmez.</small>
          </aside>
        </div>
      )}
    </>
  );
}
