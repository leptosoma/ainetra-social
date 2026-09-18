import Link from "next/link";
import { signUpAction } from "@/actions/auth";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth-card">
      <span className="eyebrow dark">Yeni hesap</span>
      <h2>Ainetra Social’a başlayın</h2>
      <p>Önce hesabınızı, ardından işletmenizi oluşturun.</p>
      {error && <div className="alert error">{error}</div>}
      <form action={signUpAction} className="stack-form">
        <label>Ad soyad<input name="name" autoComplete="name" required /></label>
        <label>E-posta<input name="email" type="email" autoComplete="email" required /></label>
        <label>Parola<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <button className="button primary" type="submit">Hesap oluştur</button>
      </form>
      <p className="auth-switch">Zaten hesabınız var mı? <Link href="/sign-in">Giriş yapın</Link></p>
    </div>
  );
}
