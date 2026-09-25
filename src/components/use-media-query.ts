"use client";

import { useSyncExternalStore } from "react";

// P5.5B: telefon ve masaüstü yüzeylerini ayırmak için tek kaynak. Kırılma noktası CSS'teki
// `@media (max-width: 820px)` ile aynıdır. Sunucuda ekran bilinmediği için sunucu değeri
// `false` kabul edilir; yalnızca istemcide kurulan katmanlar (FullCalendar, çekmece) buna bağlanır.
export const mobileMediaQuery = "(max-width: 820px)";
export const desktopMediaQuery = "(min-width: 821px)";

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
