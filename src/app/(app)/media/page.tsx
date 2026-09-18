import { redirect } from "next/navigation";
import Image from "next/image";
import { deleteMediaAction, uploadMediaAction } from "@/actions/media";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";

export default async function MediaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const assets = await prisma.mediaAsset.findMany({ where: { businessId: business.id }, include: { _count: { select: { variants: true } } }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader eyebrow="Asset library" title="Medya" description="İşletmenize ait görselleri güvenle yükleyin ve içeriklerde yeniden kullanın." />
      <section className="upload-zone">
        <div><span className="upload-icon">＋</span><h2>Yeni görsel yükleyin</h2><p>JPEG, PNG veya WebP · en fazla 8 MB</p></div>
        <form action={uploadMediaAction}><input type="hidden" name="businessId" value={business.id} /><input name="file" type="file" accept="image/jpeg,image/png,image/webp" required /><button className="button primary" type="submit">Kütüphaneye ekle</button></form>
      </section>
      <section className="media-grid">
        {assets.map((asset, index) => (
          <article className="media-card" key={asset.id}>
            <Image unoptimized loading={index === 0 ? "eager" : "lazy"} src={`/media/${asset.id}`} alt={asset.originalFilename} width={asset.width ?? 1200} height={asset.height ?? 1200} />
            <div><strong title={asset.originalFilename}>{asset.originalFilename}</strong><small>{asset.width}×{asset.height} · {(asset.size / 1024 / 1024).toFixed(1)} MB</small><small>{asset._count.variants} içerikte kullanılıyor</small></div>
            <form action={deleteMediaAction}><input type="hidden" name="mediaAssetId" value={asset.id} /><button className="icon-button" type="submit" aria-label="Medyayı sil" disabled={asset._count.variants > 0}>×</button></form>
          </article>
        ))}
        {!assets.length && <div className="empty-state wide"><h3>Kütüphane henüz boş.</h3><p>İlk marka görselinizi yükleyerek başlayın.</p></div>}
      </section>
    </>
  );
}
