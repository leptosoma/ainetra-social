"use client";

import { useEffect, useState } from "react";

// P5.5B: telefon ve masaüstü yüzeylerini ayırmak için tek kaynak. Kırılma noktası CSS'teki
// `@media (max-width: 820px)` ile aynıdır. Sunucuda ekran bilinmediği için ilk değer `false`
// kabul edilir; yalnızca istemcide kurulan katmanlar (FullCalendar, çekmece) buna bağlanır.
export const mobileMediaQuery = "(max-width: 820px)";
export const desktopMediaQuery = "(min-width: 821px)";

type MediaQueryListLike = Pick<MediaQueryList, "matches"> & {
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

/**
 * Sorguya abone olur ve GÜNCEL eşleşmeyi hemen bildirir; sonraki değişiklikleri de iletir.
 * İlk bildirim bir `change` olayını beklemez: sayfa kırılma noktasını hiç geçmeden açıldığında
 * da (ör. soğuk masaüstü yüklemesi) doğru değer ilk istemci kurulumunda elde edilir.
 */
export function subscribeMediaQuery(
  query: string,
  onMatch: (matches: boolean) => void,
  matchMedia: (query: string) => MediaQueryListLike = window.matchMedia.bind(window),
) {
  const list = matchMedia(query);
  const update = () => onMatch(list.matches);
  if (list.addEventListener) list.addEventListener("change", update);
  else list.addListener?.(update);
  update();
  return () => {
    if (list.removeEventListener) list.removeEventListener("change", update);
    else list.removeListener?.(update);
  };
}

export function useMediaQuery(query: string) {
  // Sunucu ve hidrasyon aynı `false` değeriyle çizer (uyuşmazlık uyarısı olmaz); kurulumdan
  // hemen sonra gerçek değer açıkça okunur.
  const [matches, setMatches] = useState(false);
  useEffect(() => subscribeMediaQuery(query, setMatches), [query]);
  return matches;
}
