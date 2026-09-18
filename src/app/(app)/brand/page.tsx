import { redirect } from "next/navigation";
import { updateBrandAction, updateBusinessAction, updateGoalsAction } from "@/actions/business";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { EmptyBusiness } from "@/components/empty-business";
import { PageHeader } from "@/components/page-header";

const goalOptions = ["RESERVATIONS", "FOOT_TRAFFIC", "DELIVERY", "PRODUCT_SALES", "BRAND_AWARENESS", "EVENT", "FOLLOWER_GROWTH"];

export default async function BrandPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  if (!business) return <EmptyBusiness />;
  const [brand, goals] = await Promise.all([
    prisma.brandProfile.findUnique({ where: { businessId: business.id } }),
    prisma.businessGoal.findMany({ where: { businessId: business.id } }),
  ]);
  const tones = (brand?.toneDimensions ?? {}) as Record<string, number>;
  const primary = goals.find((goal) => goal.priority === "PRIMARY")?.type ?? "";
  const secondary = new Set(goals.filter((goal) => goal.priority === "SECONDARY").map((goal) => goal.type));
  return (
    <>
      <PageHeader eyebrow="Brand memory" title="İşletme ve marka" description="Sistemin markanızı doğru tanıması için kalıcı işletme bağlamını yönetin." />
      <div className="settings-grid">
        <section className="panel"><div className="panel-title"><div><span className="eyebrow dark">İşletme</span><h2>Temel bilgiler</h2></div></div>
          <form action={updateBusinessAction} className="form-grid">
            <input type="hidden" name="businessId" value={business.id} />
            <label>İşletme adı<input name="name" defaultValue={business.name} required /></label><label>Sektör<input name="sector" defaultValue={business.sector} required /></label>
            <label>Konum<input name="location" defaultValue={business.location ?? ""} /></label><label>Web sitesi<input name="website" defaultValue={business.website ?? ""} /></label>
            <label>Instagram<input name="instagramHandle" defaultValue={business.instagramHandle ?? ""} /></label><label>Saat dilimi<input name="timezone" defaultValue={business.timezone} required /></label>
            <button className="button secondary span-2" type="submit">İşletmeyi güncelle</button>
          </form>
        </section>
        <section className="panel"><div className="panel-title"><div><span className="eyebrow dark">Marka profili</span><h2>Kimlik ve ses</h2></div></div>
          <form action={updateBrandAction} className="stack-form compact">
            <input type="hidden" name="businessId" value={business.id} />
            <label>Marka açıklaması<textarea name="description" rows={4} defaultValue={brand?.description ?? ""} /></label><label>Hedef kitle<textarea name="targetAudience" rows={3} defaultValue={brand?.targetAudience ?? ""} /></label>
            <label>Ürünler / hizmetler<textarea name="productsSummary" rows={3} defaultValue={brand?.productsSummary ?? ""} /></label><label>Diller<input name="languages" defaultValue={brand?.languages.join(", ") ?? "tr"} /></label>
            <div className="tone-grid"><label>Samimi <input type="range" name="friendly" min="0" max="100" defaultValue={tones.friendly ?? 70} /></label><label>Premium <input type="range" name="premium" min="0" max="100" defaultValue={tones.premium ?? 70} /></label><label>Modern <input type="range" name="modern" min="0" max="100" defaultValue={tones.modern ?? 65} /></label><label>Eğlenceli <input type="range" name="playful" min="0" max="100" defaultValue={tones.playful ?? 35} /></label></div>
            <button className="button secondary" type="submit">Marka profilini güncelle</button>
          </form>
        </section>
        <section className="panel span-panel"><div className="panel-title"><div><span className="eyebrow dark">İş hedefleri</span><h2>Bir ana, en fazla iki ikincil hedef</h2></div></div>
          <form action={updateGoalsAction} className="goals-form"><input type="hidden" name="businessId" value={business.id} />
            <label>Ana hedef<select name="primary" defaultValue={primary}><option value="">Seçilmedi</option>{goalOptions.map((goal) => <option key={goal}>{goal.replaceAll("_", " ")}</option>)}</select></label>
            <fieldset><legend>İkincil hedefler</legend><div className="check-grid">{goalOptions.map((goal) => <label key={goal}><input type="checkbox" name="secondary" value={goal} defaultChecked={secondary.has(goal)} />{goal.replaceAll("_", " ")}</label>)}</div></fieldset>
            <button className="button primary" type="submit">Hedefleri kaydet</button>
          </form>
        </section>
      </div>
    </>
  );
}
