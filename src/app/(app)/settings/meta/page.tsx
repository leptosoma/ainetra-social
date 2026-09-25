import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/features/auth/session";
import { PageHeader } from "@/components/page-header";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { getMetaSelection } from "@/features/meta-connection/service";
import { META_SELECTION_COOKIE } from "@/features/meta-connection/selection-cookie";
import { META_FAILURE_MESSAGES, META_INELIGIBILITY_MESSAGES } from "@/features/meta-connection/labels";
import { cancelMetaSelectionAction, completeMetaSelectionAction } from "@/actions/meta-connection";

export default async function MetaSelectionPage({ searchParams }: { searchParams: Promise<{ empty?: string }> }) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const handle = (await cookies()).get(META_SELECTION_COOKIE)?.value ?? "";
  const [selection, params] = await Promise.all([
    handle ? getMetaSelection({ userId: session.userId, sessionId: session.id }, handle).catch(() => null) : null,
    searchParams,
  ]);
  if (!selection) {
    return (
      <>
        <PageHeader eyebrow="Ayarlar" title="Meta hesabı seç" description="Bağlanacak Facebook sayfası ve Instagram hesabı." />
        <section className="panel"><p className="alert error" role="alert">{META_FAILURE_MESSAGES.SELECTION_EXPIRED}</p><Link className="button secondary" href="/settings#meta">Ayarlara dön</Link></section>
      </>
    );
  }
  return (
    <>
      <PageHeader eyebrow="Ayarlar" title="Meta hesabı seç" description="Ainetra'nın erişmesini istediğiniz hesapları açıkça seçin. Seçmediğiniz hesaplar bağlanmaz." />
      <section className="panel">
        {params.empty && <p className="alert error" role="alert">Bağlamak için en az bir hesap seçin.</p>}
        {selection.reconnect && <p className="form-note">Yeniden bağladığınız hesap önceden işaretlidir; mevcut planlı gönderileri korunur.</p>}
        <form action={completeMetaSelectionAction} className="stack-form">
          <div className="account-list">{selection.options.map((option) => (
            <fieldset className="account-row" key={option.key}>
              <legend className="visually-hidden">{option.pageName}</legend>
              <span className="account-logo">f</span>
              <div>
                <strong>{option.pageName}</strong>
                <span className="check-grid">
                <label><input type="checkbox" name="asset" value={`${option.key}:FACEBOOK`} disabled={!option.facebook.eligible} defaultChecked={option.reconnectPlatform === "FACEBOOK"} /> Facebook sayfası</label>
                {option.instagram && <label><input type="checkbox" name="asset" value={`${option.key}:INSTAGRAM`} disabled={!option.instagram.eligible} defaultChecked={option.reconnectPlatform === "INSTAGRAM"} /> Instagram{option.instagram.username ? ` · @${option.instagram.username}` : ""}</label>}
                </span>
                {!option.facebook.eligible && option.facebook.reason && <small>Facebook: {META_INELIGIBILITY_MESSAGES[option.facebook.reason]}</small>}
                {option.instagram
                  ? !option.instagram.eligible && option.instagram.reason && <small>Instagram: {META_INELIGIBILITY_MESSAGES[option.instagram.reason]}</small>
                  : <small>Bu sayfaya bağlı profesyonel Instagram hesabı yok.</small>}
              </div>
            </fieldset>
          ))}</div>
          <div className="meta-selection-actions">
            <PendingSubmitButton idle="Seçilenleri bağla" pending="Doğrulanıyor…" />
            <button className="button secondary" type="submit" formAction={cancelMetaSelectionAction} formNoValidate>Vazgeç</button>
          </div>
        </form>
      </section>
    </>
  );
}
