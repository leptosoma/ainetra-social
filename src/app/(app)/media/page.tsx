import { redirect } from "next/navigation";
import Image from "next/image";
import { deleteMediaAction, updateMediaPlanningTagsAction, uploadMediaAction } from "@/actions/media";
import { imagePlanningTags, videoPlanningTags } from "@/features/media/service";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";
import { MediaAnalysisSummaryCard } from "@/components/media-analysis-summary";
import { listMediaAnalysisSummaries } from "@/features/visual-analysis/service";
import { SafeEnhanceSummaryLine } from "@/components/safe-enhance-summary";
import { listSafeEnhanceSummaries } from "@/features/safe-enhance/service";
import { BrandStyleSummaryLine } from "@/components/brand-style-summary";
import { listBrandStyleSummaries } from "@/features/brand-style/service";

const noticeLabels: Record<string, { text: string; tone: "success" | "warning" }> = {
  "analysis-complete": { text: "Görsel analizi tamamlandı.", tone: "success" },
  "analysis-failed": { text: "Görsel analizi tamamlanamadı; önceki sonuç korundu.", tone: "warning" },
  "analysis-invalid": { text: "Analiz sonucu doğrulanamadı ve kaydedilmedi; önceki sonuç korundu.", tone: "warning" },
  "analysis-rejected": { text: "Bu medya için görsel analizi çalıştırılamadı (yalnızca fotoğraflar desteklenir, saatlik sınır olabilir).", tone: "warning" },
  "analysis-error": { text: "Görsel analizi başlatılamadı.", tone: "warning" },
};

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const params = await searchParams;
  const [assets, analyses, enhancements, brandStyles] = await Promise.all([
    prisma.mediaAsset.findMany({ where: { businessId: business.id }, include: { _count: { select: { variants: true } } }, orderBy: { createdAt: "desc" } }),
    listMediaAnalysisSummaries(user.id, business.id),
    listSafeEnhanceSummaries(user.id, business.id),
    listBrandStyleSummaries(user.id, business.id),
  ]);
  const notice = params.notice ? noticeLabels[params.notice] : undefined;
  return (
    <>
      <PageHeader eyebrow="Asset library" title="Medya" description="İşletmenize ait görselleri güvenle yükleyin ve içeriklerde yeniden kullanın." />
      {notice && <div className={`brain-notice ${notice.tone}`} role="status">{notice.text}</div>}
      <section className="upload-zone">
        <div><span className="upload-icon">＋</span><h2>Yeni görsel veya video yükleyin</h2><p>JPEG, PNG, WebP (en fazla 8 MB) veya MP4, MOV, WebM (en fazla 80 MB)</p></div>
        <form action={uploadMediaAction} className="media-upload-form"><input type="hidden" name="businessId" value={business.id} /><input name="file" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" required /><p className="media-tag-heading">Görsel etiketleri</p><div className="media-tag-options">{imagePlanningTags.map((tag) => <label key={tag}><input type="checkbox" name="tags" value={tag} />{tag.replaceAll("_", " ")}</label>)}</div><p className="media-tag-heading">Video etiketleri</p><div className="media-tag-options">{videoPlanningTags.map((tag) => <label key={tag}><input type="checkbox" name="tags" value={tag} />{tag.replaceAll("_", " ")}</label>)}</div><button className="button primary" type="submit">Kütüphaneye ekle</button></form>
      </section>
      <section className="media-grid">
        {assets.map((asset, index) => (
          <article className="media-card" key={asset.id}>
            {asset.type === "VIDEO"
              ? <video controls preload="metadata" src={`/media/${asset.id}`} />
              : <Image unoptimized loading={index === 0 ? "eager" : "lazy"} src={`/media/${asset.id}`} alt={asset.originalFilename} width={asset.width ?? 1200} height={asset.height ?? 1200} />}
            <div><strong title={asset.originalFilename}>{asset.originalFilename}</strong><small>{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}{(asset.size / 1024 / 1024).toFixed(1)} MB</small><small>{asset._count.variants} içerikte kullanılıyor</small><MediaAnalysisSummaryCard mediaAssetId={asset.id} summary={analyses.get(asset.id)} /><SafeEnhanceSummaryLine mediaAssetId={asset.id} origin={asset.origin} summary={enhancements.get(asset.id)} /><BrandStyleSummaryLine mediaAssetId={asset.id} origin={asset.origin} summary={brandStyles.get(asset.id)} /><form action={updateMediaPlanningTagsAction} className="media-tag-form"><input type="hidden" name="mediaAssetId" value={asset.id} /><div className="media-tag-options">{(asset.type === "IMAGE" ? imagePlanningTags : videoPlanningTags).map((tag) => <label key={tag}><input type="checkbox" name="tags" value={tag} defaultChecked={asset.tags.includes(tag)} />{tag.replaceAll("_", " ")}</label>)}</div><button className="mini-button" type="submit">Etiketleri kaydet</button></form></div>
            <form action={deleteMediaAction}><input type="hidden" name="mediaAssetId" value={asset.id} /><button className="icon-button" type="submit" aria-label="Medyayı sil" disabled={asset._count.variants > 0}>×</button></form>
          </article>
        ))}
        {!assets.length && <div className="empty-state wide"><h3>Kütüphane henüz boş.</h3><p>İlk marka görselinizi yükleyerek başlayın.</p></div>}
      </section>
    </>
  );
}
