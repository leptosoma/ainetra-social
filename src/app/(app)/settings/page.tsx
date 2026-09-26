import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { getMetaConnectionOverview } from "@/features/meta-connection/service";
import { META_ACCOUNT_STATE_LABELS, META_FAILURE_MESSAGES, META_NOTICES, isMetaFailureCode, isMetaNotice, type MetaAccountConnectionState } from "@/features/meta-connection/labels";
import { disconnectMetaAccountAction, startMetaConnectionAction, validateMetaConnectionAction } from "@/actions/meta-connection";

const stateClass: Record<MetaAccountConnectionState, string> = { CONNECTED: "connected", REAUTH_REQUIRED: "failed", DISCONNECTED: "disconnected", NOT_LINKED: "" };
const platformLabel = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TIKTOK: "TikTok" } as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ metaError?: string; metaNotice?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const [meta, params] = await Promise.all([getMetaConnectionOverview(user.id, business.id), searchParams]);
  const errorCode = isMetaFailureCode(params.metaError) ? params.metaError : null;
  const notice = isMetaNotice(params.metaNotice) ? META_NOTICES[params.metaNotice] : null;
  return (
    <>
      <PageHeader eyebrow="Workspace" title="Ayarlar" description="Hesap, üyelik ve sosyal kanal bağlantıları." />
      <div className="settings-grid">
        <section className="panel"><div className="panel-title"><div><span className="eyebrow dark">Hesap</span><h2>{user.name}</h2></div></div><dl className="detail-list"><div><dt>E-posta</dt><dd>{user.email}</dd></div><div><dt>Oturum</dt><dd>Güvenli sunucu oturumu</dd></div></dl></section>
        <section className="panel"><div className="panel-title"><div><span className="eyebrow dark">Çalışma alanı</span><h2>{business.name}</h2></div></div><dl className="detail-list"><div><dt>Sektör</dt><dd>{business.sector}</dd></div><div><dt>Saat dilimi</dt><dd>{business.timezone}</dd></div><div><dt>Rol</dt><dd>{meta.canManage ? "OWNER" : "MEMBER"}</dd></div></dl></section>
        <section className="panel span-panel" id="meta"><div className="panel-title"><div><span className="eyebrow dark">Sosyal hesaplar</span><h2>Kanallar</h2></div>
          {meta.canManage && meta.configured && <form action={startMetaConnectionAction}><PendingSubmitButton idle="Meta hesabı bağla" pending="Meta'ya yönlendiriliyor…" /></form>}
        </div>
          {errorCode && <p className="alert error" role="alert">{META_FAILURE_MESSAGES[errorCode]}</p>}
          {!errorCode && meta.lastFailure && isMetaFailureCode(meta.lastFailure) && !notice && <p className="alert warning">Son bağlantı denemesi tamamlanmadı: {META_FAILURE_MESSAGES[meta.lastFailure]}</p>}
          {notice && <p className="alert warning" role="status">{notice}</p>}
          {!meta.configured && <p className="form-note">Meta (Facebook/Instagram) bağlantısı bu ortamda henüz yapılandırılmamış; gerçek hesap bağlanamaz.</p>}
          {!meta.canManage && <p className="form-note">Hesap bağlantılarını yalnızca işletme sahibi değiştirebilir.</p>}
          <div className="account-list">{meta.accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <span className="account-logo">{account.platform.slice(0, 1)}</span>
              <div>
                <strong>{account.displayName}</strong>
                <small>{platformLabel[account.platform]}{account.state === "NOT_LINKED" ? " · Demo kayıt, gerçek bağlantı değil" : account.platform === "INSTAGRAM" && account.pageName ? ` · ${account.pageName} sayfasına bağlı` : ""}{account.state === "CONNECTED" && account.lastValidatedAt ? ` · Son doğrulama ${account.lastValidatedAt.toLocaleDateString("tr-TR")}` : ""}</small>
              </div>
              <span className={`status ${stateClass[account.state]}`}>{META_ACCOUNT_STATE_LABELS[account.state]}</span>
              {meta.canManage && account.state === "CONNECTED" && <>
                <form action={validateMetaConnectionAction}><input type="hidden" name="socialAccountId" value={account.id} /><PendingSubmitButton className="button small" idle="Doğrula" pending="Doğrulanıyor…" disabled={!meta.configured} /></form>
                <form action={disconnectMetaAccountAction}><input type="hidden" name="socialAccountId" value={account.id} /><PendingSubmitButton className="button small" idle="Bağlantıyı kes" pending="Kesiliyor…" /></form>
                {!account.publishPermission && meta.configured && <form action={startMetaConnectionAction}><input type="hidden" name="socialAccountId" value={account.id} /><input type="hidden" name="requestPublishing" value="1" /><PendingSubmitButton className="button small" idle="Yayın izni ver" pending="Yönlendiriliyor…" /></form>}
              </>}
              {meta.canManage && meta.configured && account.reconnectable && account.state !== "CONNECTED" && <form action={startMetaConnectionAction}><input type="hidden" name="socialAccountId" value={account.id} /><PendingSubmitButton className="button small" idle="Yeniden bağla" pending="Yönlendiriliyor…" /></form>}
            </div>
          ))}</div>
          <p className="form-note">Bağlantı yalnızca hesap erişimini kurar. Yayın için hesap başına ayrıca Meta yayın izni gerekir; gönderiler yalnızca içerik sayfasındaki Yayınla ile, onaylı ve zamanı gelmiş planlar için gönderilir.</p>
        </section>
      </div>
    </>
  );
}
