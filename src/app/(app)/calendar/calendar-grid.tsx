"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { uploadMediaAction } from "@/actions/media";
import {
  calendarContentTypeLabels,
  calendarMediaLabels,
  calendarPlatformLabels,
  calendarStatusClass,
  calendarStatusIcons,
  calendarStatusLabels,
  formatCalendarDayLong,
  monthLabels,
  weekdayIndex,
  weekdayShortLabels,
} from "@/features/calendar/labels";
import { addCalendarDays, type CalendarEvent, type CalendarView } from "@/features/calendar/projection";

// P5.5A: takvim ızgarası ve olay çekmecesi; yalnızca /calendar rotasında yüklenir.
//
// YERLEŞİM NOTU: docs/oss-architecture-spike.md FullCalendar Standard (MIT) öneriyor ve bu
// dosya o kararı uygulayacak şekilde yalıtıldı: veri, durum sözlüğü, çekmece ve eylemler
// tamamen Ainetra'ya ait; kütüphaneye kalan iş yalnızca gün/hafta/ay/yıl ızgarasını çizmek.
// Bu ortamda @fullcalendar/* paketleri kurulamadığı için ızgara şimdilik Ainetra işaretlemesiyle
// çiziliyor; paket eklendiğinde değişecek tek yer aşağıdaki `grid` bloğudur (olay verisi,
// izdüşüm ve çekmece aynı kalır). Premium Scheduler kullanılmıyor.
//
// Sürükle-bırak bilinçli olarak KAPALIDIR: güvenli bir yeniden planlama kiracı, sürüm, onay,
// saat dilimi ve çakışma kontrollerinden geçen sunucu tarafı bir mutasyon gerektirir; bu P5.5A
// kapsamını genişletirdi. İstemci hiçbir şeyi yeniden planlamaz.
// Çekmecede yalnızca GERÇEKTEN ÇALIŞAN ve bağlama uygun eylemler gösterilir.

const acceptByRequirement: Record<string, string> = {
  PHOTO_PRODUCT: "image/jpeg,image/png,image/webp",
  PHOTO_ATMOSPHERE: "image/jpeg,image/png,image/webp",
  PHOTO_PEOPLE: "image/jpeg,image/png,image/webp",
  CUSTOM_GRAPHIC: "image/jpeg,image/png,image/webp",
  VIDEO_VERTICAL: "video/mp4,video/quicktime,video/webm",
  VIDEO_KITCHEN: "video/mp4,video/quicktime,video/webm",
};

function dayNumber(day: string) {
  return Number(day.slice(8, 10));
}

function daysBetween(from: string, count: number) {
  return Array.from({ length: count }, (_, index) => addCalendarDays(from, index));
}

function StatusBadge({ status }: { status: CalendarEvent["status"] }) {
  return (
    <span className={`calendar-status ${calendarStatusClass[status]}`}>
      <b aria-hidden="true">{calendarStatusIcons[status]}</b>
      {calendarStatusLabels[status]}
    </span>
  );
}

export function CalendarGrid({ businessId, view, range, today, events, initialEventId }: {
  businessId: string;
  view: CalendarView;
  range: { from: string; to: string };
  today: string;
  events: CalendarEvent[];
  initialEventId?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEventId && events.some((event) => event.id === initialEventId) ? initialEventId : null,
  );
  const triggers = useRef(new Map<string, HTMLButtonElement | null>());
  const closeRef = useRef<HTMLButtonElement | null>(null);
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
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected, close]);

  const chip = (event: CalendarEvent, compact: boolean) => (
    <button
      type="button"
      key={event.id}
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

  const dayColumn = (day: string) => {
    const dayEvents = events.filter((event) => event.date === day);
    return (
      <section className={`calendar-day${day === today ? " today" : ""}`} key={day} aria-label={formatCalendarDayLong(day)}>
        <h3><strong>{dayNumber(day)}</strong><span>{weekdayShortLabels[weekdayIndex(day)]}</span></h3>
        {dayEvents.length ? dayEvents.map((event) => chip(event, false)) : <p className="calendar-empty-day">Bu gün için plan yok.</p>}
      </section>
    );
  };

  let grid: ReactNode;
  if (view === "day") {
    grid = <div className="calendar-single">{dayColumn(range.from)}</div>;
  } else if (view === "week") {
    grid = <div className="calendar-week">{daysBetween(range.from, 7).map(dayColumn)}</div>;
  } else if (view === "month") {
    const month = addCalendarDays(range.from, 10).slice(0, 7);
    grid = (
      <div className="calendar-month">
        {weekdayShortLabels.map((label) => <span className="calendar-month-head" key={label}>{label}</span>)}
        {daysBetween(range.from, 42).map((day) => {
          const dayEvents = events.filter((event) => event.date === day);
          const visible = dayEvents.slice(0, 3);
          return (
            <div className={`calendar-cell${day.slice(0, 7) === month ? "" : " outside"}${day === today ? " today" : ""}`} key={day}>
              <span className="calendar-cell-day">{dayNumber(day)}</span>
              {visible.map((event) => chip(event, true))}
              {dayEvents.length > visible.length && <Link className="calendar-cell-more" href={`/calendar?view=day&date=${day}`}>+{dayEvents.length - visible.length} daha</Link>}
            </div>
          );
        })}
      </div>
    );
  } else {
    const year = range.from.slice(0, 4);
    grid = (
      <div className="calendar-year">
        {monthLabels.map((label, index) => {
          const prefix = `${year}-${String(index + 1).padStart(2, "0")}`;
          const monthEvents = events.filter((event) => event.date.startsWith(prefix));
          const action = monthEvents.filter((event) => event.requiresUserAction).length;
          const ready = monthEvents.filter((event) => event.status === "READY").length;
          return (
            <Link className="calendar-year-month" key={prefix} href={`/calendar?view=month&date=${prefix}-01`}>
              <strong>{label}</strong>
              <span>{monthEvents.length} planlı içerik</span>
              <small>{ready} hazır · {action} senden bir şey bekliyor</small>
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {grid}
      {selected && (
        <div className="calendar-drawer-layer">
          <div className="calendar-drawer-backdrop" onClick={close} aria-hidden="true" />
          <aside className="calendar-drawer" role="dialog" aria-modal="true" aria-labelledby={drawerTitleId}>
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
