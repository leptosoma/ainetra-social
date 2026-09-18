import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <BrandMark />
        <div>
          <span className="eyebrow">Sosyal medya operasyon sistemi</span>
          <h1>Markanızın sesi,<br />her gün hazır.</h1>
          <p>İçerikleri planlayın, ekibinizle onaylayın ve doğru zamanda yayına hazırlayın.</p>
        </div>
        <p className="auth-note">Ainetra Social · Production Foundation</p>
      </section>
      <section className="auth-panel">{children}</section>
    </main>
  );
}
