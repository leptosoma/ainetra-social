import Link from "next/link";
import { signInAction } from "@/actions/auth";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth-card">
      <span className="eyebrow dark">Tekrar hoş geldiniz</span>
      <h2>Hesabınıza giriş yapın</h2>
      <p>İçerik akışınız kaldığı yerden devam etsin.</p>
      {error && <div className="alert error">{error}</div>}
      <form action={signInAction} className="stack-form">
        <label>E-posta<input name="email" type="email" autoComplete="email" required /></label>
        <label>Parola<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
        <button className="button primary" type="submit">Giriş yap</button>
      </form>
      <p className="auth-switch">Hesabınız yok mu? <Link href="/sign-up">Ücretsiz başlayın</Link></p>
      <div className="demo-box"><strong>Demo:</strong> owner@mimoza.test · Ainetra123!</div>
    </div>
  );
}
