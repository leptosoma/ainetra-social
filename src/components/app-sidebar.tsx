import Link from "next/link";
import { signOutAction } from "@/actions/auth";
import { BrandMark } from "./brand-mark";

const navigation = [
  ["⌂", "Dashboard", "/dashboard"],
  // P5.5A: takvim birincil çalışma alanı olduğu için panodan hemen sonra gelir.
  ["□", "Takvim", "/calendar"],
  ["✦", "İçerikler", "/content"],
  ["◫", "İçerik Planı", "/content-plan"],
  ["▧", "Medya", "/media"],
  ["◨", "Kreatif", "/creative"],
  ["◇", "Marka", "/brand"],
  ["◎", "Sosyal Strateji", "/strategy"],
  ["◈", "Business Brain", "/business-brain"],
  ["⚙", "Ayarlar", "/settings"],
];

export function AppSidebar({ userName, businessName }: { userName: string; businessName?: string }) {
  return (
    <aside className="sidebar">
      <BrandMark />
      <div className="workspace-chip">
        <span className="workspace-icon">{businessName?.slice(0, 1) ?? "+"}</span>
        <span><small>Çalışma alanı</small><strong>{businessName ?? "İşletme oluştur"}</strong></span>
      </div>
      <nav>
        {navigation.map(([icon, label, href]) => (
          <Link href={href} key={href}><span>{icon}</span>{label}</Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="user-row"><span className="avatar">{userName.slice(0, 1)}</span><span><strong>{userName}</strong><small>Üye</small></span></div>
        <form action={signOutAction}><button className="text-button" type="submit">Çıkış yap</button></form>
      </div>
    </aside>
  );
}
