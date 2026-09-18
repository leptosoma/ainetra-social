import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ainetra Social", template: "%s · Ainetra Social" },
  description: "İşletmeler için yapay zekâ destekli sosyal medya operasyon platformu.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
