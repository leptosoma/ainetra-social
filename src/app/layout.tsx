import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ainetra Social", template: "%s · Ainetra Social" },
  description: "İşletmeler için yapay zekâ destekli sosyal medya operasyon platformu.",
};

// P5.5B: iPhone ana ekran çubuğu ve Android hareket çubuğu alanına kadar çizilir; alt gezinme
// `env(safe-area-inset-*)` ile bu alanın üstünde kalır. Yakınlaştırma engellenmez (erişilebilirlik).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#17372e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
