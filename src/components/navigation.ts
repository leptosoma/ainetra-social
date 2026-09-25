// P5.5B: masaüstü kenar çubuğu ve mobil gezinme AYNI rota listesinden beslenir; böylece mobilde
// bir yetenek sessizce kaybolmaz. Masaüstü tüm listeyi gösterir. Mobil alt çubuk yalnızca
// `dock` işaretli dört rotayı ve ortadaki çekim düğmesini taşır; kalanlar `İşletmem` menüsündedir.

export type NavigationItem = {
  icon: string;
  label: string;
  /** Mobil alt çubukta kullanılan kısa ad. */
  mobileLabel?: string;
  href: string;
  dock?: boolean;
};

export const navigation: readonly NavigationItem[] = [
  { icon: "⌂", label: "Dashboard", mobileLabel: "Bugün", href: "/dashboard", dock: true },
  // P5.5A: takvim birincil çalışma alanı olduğu için panodan hemen sonra gelir.
  { icon: "□", label: "Takvim", href: "/calendar", dock: true },
  { icon: "✦", label: "İçerikler", href: "/content", dock: true },
  { icon: "◫", label: "İçerik Planı", href: "/content-plan" },
  { icon: "▧", label: "Medya", href: "/media", dock: true },
  { icon: "◨", label: "Kreatif", href: "/creative" },
  { icon: "◇", label: "Marka", href: "/brand" },
  { icon: "◎", label: "Sosyal Strateji", href: "/strategy" },
  { icon: "◈", label: "Business Brain", href: "/business-brain" },
  { icon: "⚙", label: "Ayarlar", href: "/settings" },
];

export const dockNavigation = navigation.filter((item) => item.dock);
export const businessNavigation = navigation.filter((item) => !item.dock);

/** Bir rota, gezinme öğesinin kendisi ya da alt sayfası mı (ör. /content/abc → /content). */
export function isNavigationActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
