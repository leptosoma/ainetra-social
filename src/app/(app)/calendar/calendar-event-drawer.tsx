"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import { uploadMediaAction } from "@/actions/media";
import { useModalFocus } from "@/components/use-modal-focus";
import {
  calendarContentTypeLabels,
  calendarMediaLabels,
  calendarPlatformLabels,
  calendarStatusClass,
  calendarStatusIcons,
  calendarStatusLabels,
  formatCalendarDayLong,
} from "@/features/calendar/labels";
import type { CalendarEvent } from "@/features/calendar/projection";

// P5.5A olay çekmecesi; P5.5B'de masaüstü takvimi ile telefon takvimi arasında paylaşılmak üzere
// ayrı bileşene alındı (davranış aynı). Telefonda CSS ile alt sayfa gibi açılır.
//
// ODAK TUZAĞI: çekmece `aria-modal="true"` ile kipli olduğunu söyler; bunun klavyede de doğru
// olması gerekir. Açıkken Tab/Shift+Tab çekmecenin odaklanabilir öğeleri arasında döner, Esc
// kapatır ve odak tetikleyen düğmeye geri döner (çağıranın `onClose`'u). Çekmecede yalnızca
// GERÇEKTEN ÇALIŞAN ve bağlama uygun eylemler gösterilir.

const acceptByRequirement: Record<string, string> = {
  PHOTO_PRODUCT: "image/jpeg,image/png,image/webp",
  PHOTO_ATMOSPHERE: "image/jpeg,image/png,image/webp",
  PHOTO_PEOPLE: "image/jpeg,image/png,image/webp",
  CUSTOM_GRAPHIC: "image/jpeg,image/png,image/webp",
  VIDEO_VERTICAL: "video/mp4,video/quicktime,video/webm",
  VIDEO_KITCHEN: "video/mp4,video/quicktime,video/webm",
};

export function StatusBadge({ status }: { status: CalendarEvent["status"] }) {
  return (
    <span className={`calendar-status ${calendarStatusClass[status]}`}>
      <b aria-hidden="true">{calendarStatusIcons[status]}</b>
      {calendarStatusLabels[status]}
    </span>
  );
}

export function CalendarEventDrawer({ event: selected, businessId, onClose }: {
  event: CalendarEvent;
  businessId: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerTitleId = useId();
  useModalFocus(drawerRef, true, onClose, closeRef);

  return (
    <div className="calendar-drawer-layer">
      <div className="calendar-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside ref={drawerRef} className="calendar-drawer" role="dialog" aria-modal="true" aria-labelledby={drawerTitleId}>
        <header>
          <div>
            <StatusBadge status={selected.status} />
            <p className="calendar-drawer-when">{formatCalendarDayLong(selected.date)} · {selected.time} · {calendarPlatformLabels[selected.platform]}{selected.contentType ? ` · ${calendarContentTypeLabels[selected.contentType]}` : ""}</p>
            <h2 id={drawerTitleId}>{selected.title}</h2>
          </div>
          <button type="button" ref={closeRef} className="icon-button static" onClick={onClose} aria-label="Kapat">×</button>
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
  );
}
