// Next 16 geliştirme sunucusu, dev kaynaklarına (HMR soketi vb.) yalnızca localhost'tan ve
// sunucunun başlatıldığı ana makineden izin verir. Uygulama başka bir ana makineden açıldığında
// (ör. Meta için gereken HTTPS tünel alan adı ya da ağ IP'si) istemci paketi hidrate olmaz:
// sunucuda çizilen bağlantılar çalışmaya devam eder ama yalnızca tarayıcıda kurulan masaüstü
// FullCalendar ızgarası hiç oluşmaz. Uygulamanın zaten yapılandırılmış genel adresleri bu yüzden
// geliştirme sunucusuna izinli köken olarak eklenir. Üretim derlemesini etkilemez.
export function devOriginHosts(env: Record<string, string | undefined> = process.env): string[] {
  const hosts = new Set<string>();
  for (const value of [env.PUBLIC_APP_URL, env.META_REDIRECT_URI]) {
    if (!value) continue;
    try {
      const { hostname } = new URL(value);
      if (hostname && hostname !== "localhost") hosts.add(hostname);
    } catch {
      // Geçersiz adres yok sayılır; ortam doğrulaması bu değişkenlerin kendi kullanım yerindedir.
    }
  }
  return [...hosts];
}
