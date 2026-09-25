"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

/** Katman içinde Tab ile durulabilecek öğeler; odak tuzağının sınırlarını bunlar belirler. */
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Kipli katmanların (takvim çekmecesi, çekim sayfası) ortak klavye davranışı: açılınca ilk odak,
 * Esc ile kapanma ve Tab/Shift+Tab'ın katman içinde dönmesi. `aria-modal="true"` bildiren bir
 * katmanın arkasında görünmez bir gezinme kalmaz. Kapanınca odağı geri vermek çağıranın işidir.
 */
export function useModalFocus(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  // Kapatma işlevi her çizimde yeniden oluşsa bile ilk odak yalnızca katman açıldığında verilir.
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    (initialFocusRef?.current ?? container?.querySelector<HTMLElement>(focusableSelector))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const layer = containerRef.current;
      if (!layer) return;
      // Gizli öğeler (kapalı <details> içeriği, görsel olarak gizli dosya girdisi hariç) sıraya girmez.
      const stops = Array.from(layer.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((node) => !node.hasAttribute("disabled") && node.tabIndex >= 0 && node.getClientRects().length > 0);
      if (stops.length === 0) { event.preventDefault(); return; }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (!current || !layer.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, containerRef, initialFocusRef]);
}
