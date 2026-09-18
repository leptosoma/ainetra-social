import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { approveVariantAction, exportVariantAction, scheduleVariantAction, updateVariantAction } from "@/actions/content";
import { getCurrentUser } from "@/features/auth/session";
import { deriveWorkflowLabel } from "@/features/content/service";
import { prisma } from "@/lib/db";

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;
  const item = await prisma.contentItem.findFirst({
    where: { id, business: { memberships: { some: { userId: user.id } } } },
    include: {
      business: true,
      goal: true,
      variants: { include: { approvals: { orderBy: { approvedAt: "desc" } }, scheduledPosts: { orderBy: { createdAt: "desc" } }, mediaAsset: true } },
    },
  });
  if (!item) notFound();
  const [media, accounts] = await Promise.all([
    prisma.mediaAsset.findMany({ where: { businessId: item.businessId }, orderBy: { createdAt: "desc" } }),
    prisma.socialAccount.findMany({ where: { businessId: item.businessId }, orderBy: { platform: "asc" } }),
  ]);

  return (
    <>
      <Link href="/content" className="back-link">← İçeriklere dön</Link>
      <header className="detail-header"><div><span className="eyebrow dark">{item.contentType} · {item.goal?.type ?? "HEDEFSİZ"}</span><h1>{item.title}</h1><p>{item.topic}</p></div></header>
      <div className="variant-grid">
        {item.variants.map((variant) => {
          const status = deriveWorkflowLabel(variant);
          const currentApproval = variant.approvals.find((approval) => approval.approvedVersion === variant.version);
          const currentSchedule = variant.scheduledPosts.find((post) => post.status === "SCHEDULED" && post.contentVersion === variant.version);
          return (
            <article className="variant-card" key={variant.id}>
              <div className="variant-top"><div><span className="platform-pill">{variant.platform}</span><h2>Platform varyantı</h2></div><div><span className={`status ${status.toLowerCase()}`}>{status}</span><span className="version-pill">Sürüm {variant.version}</span></div></div>
              <div className="variant-body">
                <div className="variant-preview">
                  <div className="phone-frame">
                    {variant.mediaAsset ? <Image unoptimized src={`/media/${variant.mediaAsset.id}`} alt={variant.mediaAsset.originalFilename} width={variant.mediaAsset.width ?? 1200} height={variant.mediaAsset.height ?? 1500} /> : <div className="media-placeholder">Görsel eklenmedi</div>}
                    <div><strong>{item.business.instagramHandle ?? item.business.name}</strong><p>{variant.caption}</p>{variant.cta && <b>{variant.cta}</b>}</div>
                  </div>
                </div>
                <div className="variant-controls">
                  <form action={updateVariantAction} className="stack-form compact">
                    <input type="hidden" name="variantId" value={variant.id} /><input type="hidden" name="contentId" value={item.id} />
                    <label>Caption<textarea name="caption" rows={6} defaultValue={variant.caption} required /></label>
                    <label>CTA<input name="cta" defaultValue={variant.cta ?? ""} /></label>
                    <div className="two-cols"><label>Dil<input name="language" defaultValue={variant.language} /></label><label>Oran<select name="aspectRatio" defaultValue={variant.aspectRatio ?? "4:5"}><option>4:5</option><option>1:1</option><option>9:16</option><option>16:9</option></select></label></div>
                    <label>Medya<select name="mediaAssetId" defaultValue={variant.mediaAssetId ?? ""}><option value="">Medya yok</option>{media.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalFilename}</option>)}</select></label>
                    <button className="button secondary" type="submit">Değişiklikleri kaydet</button>
                    <small className="form-note">Caption, CTA veya medya değişirse sürüm artar; mevcut onay ve plan geçersizleşir.</small>
                  </form>
                  <div className="workflow-actions">
                    <div className="workflow-step"><span>1</span><div><strong>Onay</strong><small>{currentApproval ? `Sürüm ${currentApproval.approvedVersion} onaylandı` : "Güncel sürüm onay bekliyor"}</small></div><form action={approveVariantAction}><input type="hidden" name="variantId" value={variant.id} /><input type="hidden" name="contentId" value={item.id} /><button className="button small" type="submit">{currentApproval ? "Yeniden onayla" : "Onayla"}</button></form></div>
                    <div className="workflow-step"><span>2</span><div><strong>Planlama</strong><small>{currentSchedule ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(currentSchedule.scheduledAt) : "Bir hesap ve gelecek tarih seçin"}</small></div></div>
                    <form action={scheduleVariantAction} className="inline-schedule">
                      <input type="hidden" name="variantId" value={variant.id} /><input type="hidden" name="contentId" value={item.id} /><input type="hidden" name="expectedVersion" value={variant.version} />
                      <select name="socialAccountId" required defaultValue=""><option value="" disabled>Sosyal hesap</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.platform} · {account.displayName}</option>)}</select>
                      <input name="scheduledAt" type="datetime-local" required />
                      <button className="button primary" type="submit" disabled={!currentApproval}>Planla</button>
                    </form>
                    <form action={exportVariantAction}><input type="hidden" name="variantId" value={variant.id} /><input type="hidden" name="contentId" value={item.id} /><button className="text-button" type="submit">Dışa aktarımı kaydet</button>{variant.exportedAt && <small className="inline-note"> Son dışa aktarım: v{variant.exportedVersion}</small>}</form>
                  </div>
                </div>
              </div>
              {variant.scheduledPosts.some((post) => post.status === "INVALIDATED") && <div className="alert warning">İçerik değiştiği için eski plan geçersizleştirildi. Güncel sürümü onaylayıp yeniden planlayın.</div>}
            </article>
          );
        })}
      </div>
    </>
  );
}
