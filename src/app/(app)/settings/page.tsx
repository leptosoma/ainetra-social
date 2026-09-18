import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const accounts = await prisma.socialAccount.findMany({ where: { businessId: business.id } });
  return (
    <>
      <PageHeader eyebrow="Workspace" title="Ayarlar" description="Hesap, üyelik ve ileride bağlanacak sosyal kanalların görünümü." />
      <div className="settings-grid">
        <section className="panel"><div className="panel-title"><div><span className="eyebrow dark">Hesap</span><h2>{user.name}</h2></div></div><dl className="detail-list"><div><dt>E-posta</dt><dd>{user.email}</dd></div><div><dt>Oturum</dt><dd>Güvenli sunucu oturumu</dd></div></dl></section>
        <section className="panel"><div className="panel-title"><div><span className="eyebrow dark">Çalışma alanı</span><h2>{business.name}</h2></div></div><dl className="detail-list"><div><dt>Sektör</dt><dd>{business.sector}</dd></div><div><dt>Saat dilimi</dt><dd>{business.timezone}</dd></div><div><dt>Rol</dt><dd>OWNER</dd></div></dl></section>
        <section className="panel span-panel"><div className="panel-title"><div><span className="eyebrow dark">Sosyal hesaplar</span><h2>Kanallar</h2></div><span className="phase-tag">Phase 1 · Mock</span></div>
          <div className="account-list">{accounts.map((account) => <div className="account-row" key={account.id}><span className="account-logo">{account.platform.slice(0, 1)}</span><div><strong>{account.displayName}</strong><small>{account.platform} · Gerçek OAuth bağlı değil</small></div><span className={`status ${account.status.toLowerCase()}`}>{account.status}</span></div>)}</div>
          <p className="form-note">Gerçek Instagram/Facebook bağlantısı Phase 2 sonrasında eklenecek. Buradaki hesaplar yalnızca domain akışını sınamak içindir.</p>
        </section>
      </div>
    </>
  );
}
