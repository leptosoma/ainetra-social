# ADR-P0003 — Hazır secret manager ve ürün credential sahipliği

- Tarih: 2026-09-26
- Durum: Kabul edilen v1 mimari kararı; sağlayıcı kurulmadı/seçilmedi
- Referans: Claude G; Gemini G; Social S04–S10/S13

## Bağlam

Platform Meta App Secret ile işletmenin Meta Page token'ı farklı sahiplik ve yaşam döngülerine sahip. Social'da token çözümleme ürün içi opaque ref, AES-GCM ve keyring ile mevcut. Env loader'ları web ve ayrı worker tarafından kullanılıyor. Serve'de platform ve tenant AI key'leri `encrypted_secrets` içinde; sürümlü AES-GCM keyring, rotasyon servisi ve AI Gateway çözümlemesi bugün çalışır. HotelOps bot/webhook/Zammad secret'larını ortamından okur; çoklu otel credential deposu doğrulanmadı ve kod içindeki admin credential varsayılanları ayrı güvenlik işidir.

## Karar

Bootstrap, platform provider/ürün anahtarı, tenant credential ve non-secret config dört ayrı sınıftır. Hazır manager hedefi önce deployment secret'ları ve yeni platform secret'larının yönetimidir. Serve'in bugün DB'de bulunan şifreli platform AI key'i ve tenant BYOK'u yerinde kalır; platform key'ini ileride dışarı almak ayrı dönüşüm kararıdır. Tenant token'ı kullanan ürünün güvenli deposunda kalır; HotelOps'un mevcut env/JSON sınırını sessizce ortak kasaya taşımayız. Gelecek Core veya Control için yeni bir secret kasası ve runtime resolver API'si kurulmaz.

İlk pilot mevcut env isimlerini kullanır; Social koduna manager bağımlılığı veya SecretProvider eklemek ön koşul değildir. Gerekirse sonra yalnızca yerel ince adapter değerlendirilir. Manager'ın kendi UI'si yeterlidir. Infisical adaydır; hosting/operasyon seçimi P0-05'tir. [Resmî injection belgesi](https://infisical.com/docs/cli/commands/run) bu teknik yolu destekler.

## Alternatifler

Core üzerinden secret/proxy reddedildi: merkezi arıza noktası. Token'ları manager'a topluca taşımak reddedildi: OAuth yaşam döngüsünün sahibi ürün. Redis Pub/Sub, kendi vault ve zorunlu envelope encryption ertelendi: mevcut problemi çözmek için gerekli değiller.

## Sonuç, rotasyon ve sınırlar

Mevcut AES-GCM ciphertext biçimleri korunur; bugün KMS/wrapped DEK varmış gibi anlatılmaz. Social yeni anahtarı web+worker'a verir; eski keyId ve yedek erişimi korunur. Serve farklı key version ve idempotent rotasyon yolunu kullanır; yeni/önceki keyring sürümleri ve `pending=0` doğrulanmadan eski sürüm çıkarılmaz. Ürünlerin keyring/rotasyon biçimleri tek bir ortak şemaya zorlanmaz.

Startup injection güncel çalışan process'i sıcak yenilemez. Provider overlap desteği doğrulanır; kontrollü restart ve geri dönüş runbook'u gerekir. Manager kesintisinde mevcut değerler bir süre yeterli olabilir, cold start garanti değildir. 401/403 veya belirsiz yayın kör retry sebebi değildir. Secret browser/log/Git/build image/AI prompt'una çıkmaz.

Yeniden değerlendirme: aynı bağlantının iki ürünce gerçekten kullanılması veya kanıtlanmış KMS/yenileme ihtiyacı; ayrı ADR. Görevler: P0-03, P0-05–07.
