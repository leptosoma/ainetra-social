import Link from "next/link";
import { redirect } from "next/navigation";
import { createContentAction } from "@/actions/content";
import { getCurrentUser } from "@/features/auth/session";
import { deriveWorkflowLabel } from "@/features/content/service";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";

const filters = ["ALL", "DRAFT", "APPROVED", "SCHEDULED"];

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const { filter = "ALL" } = await searchParams;
  const [items, goals, media] = await Promise.all([
    prisma.contentItem.findMany({
      where: { businessId: business.id },
      include: { goal: true, variants: { include: { approvals: true, scheduledPosts: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.businessGoal.findMany({ where: { businessId: business.id }, orderBy: { priority: "asc" } }),
    prisma.mediaAsset.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const visible = items.filter((item) =>
    filter === "ALL" || item.variants.some((variant) => deriveWorkflowLabel(variant) === filter),
  );

  return (
    <>
      <PageHeader eyebrow="Content studio" title="İçerikler" description="Fikirleri platform varyantlarına dönüştürün; sürüm, onay ve planlama akışını koruyun." />
      <div className="filter-row">
        {filters.map((entry) => <Link key={entry} className={filter === entry ? "active" : ""} href={`/content?filter=${entry}`}>{entry}</Link>)}
      </div>
      <div className="content-layout">
        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow dark">Kütüphane</span><h2>{visible.length} içerik</h2></div></div>
          <div className="content-list">
            {visible.map((item) => {
              const variant = item.variants[0];
              const status = variant ? deriveWorkflowLabel(variant) : "DRAFT";
              return (
                <Link href={`/content/${item.id}`} className="content-row" key={item.id}>
                  <div className="content-number">{item.contentType.slice(0, 1)}</div>
                  <div className="content-copy"><small>{item.goal?.type.replaceAll("_", " ") ?? "HEDEFSİZ"} · {variant?.platform ?? "—"}</small><strong>{item.title}</strong><p>{item.topic}</p></div>
                  <div className="content-meta"><span className={`status ${status.toLowerCase()}`}>{status}</span><small>v{variant?.version ?? 1}</small></div>
                </Link>
              );
            })}
            {!visible.length && <div className="empty-state"><h3>Bu görünümde içerik yok.</h3><p>Sağdaki formdan ilk içeriğinizi oluşturun.</p></div>}
          </div>
        </section>
        <aside className="panel sticky-panel" id="new-content">
          <div className="panel-title"><div><span className="eyebrow dark">Manuel üretim</span><h2>Yeni içerik</h2></div></div>
          <form action={createContentAction} className="stack-form compact">
            <input type="hidden" name="businessId" value={business.id} />
            <label>Başlık<input name="title" placeholder="Cuma akşamı rezervasyon" required /></label>
            <label>Konu<input name="topic" placeholder="Steak ve canlı müzik" required /></label>
            <div className="two-cols">
              <label>Tür<select name="contentType" defaultValue="POST"><option>POST</option><option>REEL</option><option>STORY</option><option>CAROUSEL</option></select></label>
              <label>Platform<select name="platform" defaultValue="INSTAGRAM"><option>INSTAGRAM</option><option>FACEBOOK</option><option>TIKTOK</option></select></label>
            </div>
            <label>Hedef<select name="goalId" defaultValue=""><option value="">Hedef seçilmedi</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.type}</option>)}</select></label>
            <label>Metin<textarea name="caption" rows={5} placeholder="İçerik metni…" required /></label>
            <label>CTA<input name="cta" placeholder="Rezervasyon için bize yazın" /></label>
            <div className="two-cols">
              <label>Dil<input name="language" defaultValue="tr" /></label>
              <label>Oran<select name="aspectRatio" defaultValue="4:5"><option>4:5</option><option>1:1</option><option>9:16</option><option>16:9</option></select></label>
            </div>
            <label>Medya<select name="mediaAssetId" defaultValue=""><option value="">Medya yok</option>{media.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalFilename}</option>)}</select></label>
            <button className="button primary" type="submit">İçerik oluştur</button>
          </form>
        </aside>
      </div>
    </>
  );
}
