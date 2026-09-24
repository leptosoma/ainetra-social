import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";
import { CreativeCampaignWorkspace } from "@/components/creative-campaign-workspace";
import { getCreativeCampaignWorkspace } from "@/features/creative-campaign/service";

// P5-04B Kreatif Kampanya ekranı. Burada üretilen her şey TASARIMDIR; gerçek ürün, ekip, mekân veya
// hizmet fotoğrafı değildir ve medya kütüphanesinde de böyle etiketlenir. Metin yalnızca Business
// Brain'de onaylanmış kanonik bilgilerden gelir; bilgi eksikse tasarım hazırlanmaz.

const noticeLabels: Record<string, { text: string; tone: "success" | "warning" }> = {
  "creative-ready": { text: "Tasarım hazır; aşağıdan inceleyip saklayabilir veya atabilirsiniz.", tone: "success" },
  "creative-pending": { text: "Bu seçim için zaten bekleyen bir tasarım var; yeni bir iş başlatılmadı.", tone: "warning" },
  "creative-failed": { text: "Tasarım tamamlanamadı; işletme bilgileriniz ve kullanılan görsel olduğu gibi duruyor.", tone: "warning" },
  "creative-invalid": { text: "Tasarımın çıktısı doğrulanamadı ve kaydedilmedi.", tone: "warning" },
  "creative-missing-facts": { text: "Tasarım hazırlanmadı: seçtiğiniz tür için onaylanmış bir işletme bilginiz yok ya da bu hedef için tanımlı bir oran kuralı yok. Eksik bilgi aşağıda türün altında yazıyor; hiçbir bilgi uydurulmadı.", tone: "warning" },
  "creative-kept": { text: "Tasarım kütüphaneye ayrı bir görsel olarak eklendi. Yalnızca özel tasarım ihtiyacına işaretlenebilir; içerik onayı veya yayın değildir.", tone: "success" },
  "creative-discarded": { text: "Tasarım atıldı; kullanılan gerçek görsel olduğu gibi duruyor.", tone: "success" },
  "creative-decided": { text: "Bu tasarım için karar zaten verilmişti.", tone: "warning" },
  "creative-policy-blocked": { text: "Tasarım saklanmadı: sektörünüz için geçerli kreatif politikası bu tasarımı kabul etmiyor ya da gereken kabul beyanı verilmedi. Tasarım ve işletme bilgileriniz olduğu gibi duruyor.", tone: "warning" },
  "creative-error": { text: "Kreatif işlemi tamamlanamadı.", tone: "warning" },
};

export default async function CreativePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const [params, workspace] = await Promise.all([searchParams, getCreativeCampaignWorkspace(user.id, business.id)]);
  const notice = params.notice ? noticeLabels[params.notice] : undefined;
  return (
    <>
      <PageHeader
        eyebrow="Kreatif kampanya"
        title="Bilgi tasarımı"
        description="Onayladığınız işletme bilgilerinden sade, markalı bir tasarım hazırlayın. Bu bir tasarımdır; gerçek fotoğraf yerine geçmez."
      />
      {notice && <div className={`brain-notice ${notice.tone}`} role="status">{notice.text}</div>}
      <CreativeCampaignWorkspace workspace={workspace} />
    </>
  );
}
