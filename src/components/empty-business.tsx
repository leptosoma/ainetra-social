import { createBusinessAction } from "@/actions/business";

export function EmptyBusiness() {
  return (
    <section className="empty-onboarding">
      <span className="eyebrow dark">İlk adım</span>
      <h2>İşletmenizi tanımlayın</h2>
      <p>İçerik, medya ve marka ayarları bu güvenli çalışma alanında tutulacak.</p>
      <form action={createBusinessAction} className="form-grid">
        <label>İşletme adı<input name="name" placeholder="Mimoza Bodrum Restaurant" required /></label>
        <label>Sektör<input name="sector" placeholder="RESTAURANT" required /></label>
        <label>Konum<input name="location" placeholder="Bodrum, Muğla" /></label>
        <label>Web sitesi<input name="website" placeholder="https://..." /></label>
        <label>Instagram<input name="instagramHandle" placeholder="@mimozabodrum" /></label>
        <label>Saat dilimi<input name="timezone" defaultValue="Europe/Istanbul" required /></label>
        <button className="button primary span-2" type="submit">Çalışma alanını oluştur</button>
      </form>
    </section>
  );
}
