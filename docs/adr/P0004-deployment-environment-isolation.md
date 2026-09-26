# ADR-P0004 — Dev, Staging, Prod ayrı deployment sınırlarıdır

- Tarih: 2026-09-26
- Durum: Kabul edilen v1 hedef politikası; mevcut prod topolojisi doğrulanmadı
- Referans: Claude C/L; Gemini C/L; Social S11

## Bağlam

Social repo'sunda development Postgres Compose tanımı var. Serve `DeploymentProfile`/`DatabaseRouter` ile shared, dedicated ve on-premise rotalarını destekler; shared rotada birden çok Serve tenant'ı aynı RLS DB'sindedir. HotelOps Compose bot, webhook ve tunnel tanımlar; Zammad ile ürün içi JSON durumu kullanır. Üç ürünün production DB/kalıcılık/secret ayrılığına dair canlı kanıt yok. Bir environment alanı tek başına erişim sınırı oluşturmaz.

## Karar

Her ortamın uygulama/worker/bot deployment'ı, DB/database user'ı veya HotelOps durum konumu, storage'ı, secret projesi/kapsamı, machine identity'si ve callback/origin/webhook'u ayrılır. Serve'in runtime/migration DB rolü, `DatabaseRouter` ve shared/dedicated/on-premise modeli korunur. Ürünler aynı cluster'ı paylaşabilir ancak Social ile Serve ürün/ortam DB erişimi ayrı kullanıcı ve izinlerle sınırlandırılır; HotelOps'un Zammad/JSON erişimi de ürün ve ortam kapsamında tutulur. Fiziksel sunucu sayısı veya Serve tenant başına ayrı DB bu belgeyle zorunlu kılınmaz.

Dev/staging kimliği prod kaynağına erişemez. Provider test/prod hesap ve uygulama ayrımı envanterde açık olur; mevcut tek sağlayıcı hesabı varsa hemen değiştirilmez, kontrollü görev hazırlanır. Prod verisi staging'e otomatik kopyalanmaz. Secret manager'ın ortam etiketi tek başına yeterli sayılmaz; çapraz erişim reddi test edilir.

## Alternatifler

Tek DB'de environment satırları reddedildi: güvenlik sınırı sağlamaz. Şimdiden Kubernetes/Nomad veya yeni altyapı taşıması reddedildi: gereksinim kanıtı yok. Mevcut Compose/hosting düzeni uygun ayrımlarla değerlendirilebilir.

## Sonuç ve doğrulama

Ortam başına bağımsız dağıtım, geri dönüş ve yedek/restore kaydı gerekir. Ortak kaynak bulunursa belgede hedefe aykırılık olarak yazılır; bu inceleme onu otomatik taşımaz. Social web+worker aynı ortamdaki gerekli DB/storage ve anahtar sürümleriyle birlikte değerlendirilir.

Yeniden değerlendirme: deployment envanteri ve pilot sonuçları. Görevler: P0-04–07, P0-10–11.
