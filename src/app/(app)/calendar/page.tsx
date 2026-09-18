import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";

export default async function CalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const posts = await prisma.scheduledPost.findMany({
    where: { businessId: business.id },
    include: { socialAccount: true, contentVariant: { include: { contentItem: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  return (
    <>
      <PageHeader eyebrow="Publishing queue" title="Takvim" description="Yayın planınızı ve içerik değişiklikleri nedeniyle geçersizleşen kayıtları izleyin." actions={<Link href="/content" className="button primary">İçerik planla</Link>} />
      <section className="timeline">
        {posts.map((post) => (
          <article className={`timeline-row ${post.status.toLowerCase()}`} key={post.id}>
            <time><strong>{new Intl.DateTimeFormat("tr-TR", { day: "2-digit" }).format(post.scheduledAt)}</strong><span>{new Intl.DateTimeFormat("tr-TR", { month: "short" }).format(post.scheduledAt)}</span><small>{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(post.scheduledAt)}</small></time>
            <div className="timeline-line"><i /></div>
            <div className="timeline-card"><div><span className="platform-pill">{post.socialAccount.platform}</span><span className={`status ${post.status.toLowerCase()}`}>{post.status}</span></div><h3>{post.contentVariant.contentItem.title}</h3><p>{post.contentVariant.caption.slice(0, 150)}</p><small>İçerik sürümü: v{post.contentVersion} · Hesap: {post.socialAccount.displayName}</small><Link href={`/content/${post.contentVariant.contentItemId}`}>İçeriği aç →</Link></div>
          </article>
        ))}
        {!posts.length && <div className="empty-state wide"><h3>Takvim henüz boş.</h3><p>Onaylanmış bir içerik varyantını planladığınızda burada görünecek.</p></div>}
      </section>
    </>
  );
}
