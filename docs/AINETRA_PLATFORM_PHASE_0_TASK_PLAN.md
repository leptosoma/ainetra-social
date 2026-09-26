# Ainetra Platform Phase 0 — görev planı

26 Eylül 2026 · **Mimari belge FINAL; Phase 0 operasyon görevleri açık.** Plan, uygulama yetkisi değildir. Bu çalışmada yalnızca belge üretildi; Core, migration veya secret manager kurulmadı.

## Durum ve sıra

| ID | Görev | Durum | Bağımlılık | Sorumlu rol | Somut çıktı / kabul şartı |
|---|---|---|---|---|---|
| P0-01 | Üç aktif ürünün kaynak ve belge incelemesi | TAMAMLANDI: Social + Serve kaynak, HotelOps kaynak dokümanları/aktif Git; Control ayrı repo yok | Yok | Mimari inceleme sahibi | Üç aktif yol/HEAD, domain/veri sınırı ve [proje envanteri](platform/AINETRA_PROJECT_INVENTORY.md); canlı ortam iddiası yok |
| P0-02 | Architecture v1 + ADR seti | FINAL: mimari kararlar kaydedildi | P0-01 | Mimari karar sahibi | Üç ürünle çelişmeyen sınırlar; taşıma/Core zorunluluğu yok; açık operasyon doğrulamaları listeli |
| P0-03 | Secret/config envanteri | PLANLANDI | P0-01 | Ürün + deployment sahibi | Değer içermeyen ad/sınıf/sahip/ortam/tüketici/rotasyon tablosu |
| P0-04 | Ortam ve DB/kalıcılık erişim envanteri | PLANLANDI | P0-01 | Deployment sahibi | Social/Serve DB user/route; HotelOps Zammad/JSON yolu; storage/callback/webhook/process haritası; mevcut ortaklıklar açık |
| P0-05 | Hazır secret manager seçimi ve runbook taslağı | PLANLANDI | P0-03, P0-04 | Operasyon sahibi | Infisical ve mevcut hosting'in hazır alternatifi; yetki, maliyet, backup/restore, rotasyon ve kesinti karşılaştırması |
| P0-06 | Social staging injection pilotu | BAŞLATILMADI | P0-02–05; ayrı uygulama görevi | Deployment + Social sahibi | Mevcut env isimleriyle web/worker; prod erişimi yok; çekirdek kod/DB biçimi değişmiyor |
| P0-07 | Keyring rotasyon ve restore provası | BAŞLATILMADI | P0-06 | Social + operasyon sahibi | Eski/yeni ciphertext okunur; iptal edilen anahtara sessiz fallback yok; backup restore anahtarları doğrulanır |
| P0-08 | Serve kesinti ve regresyon görev paketi | KAYNAK TESPİTİ TAMAM; deney yapılmadı | P0-04, ayrı uygulama görevi | Serve sahibi | QR/guest session, menü, sipariş, servis talebi, personel ve paket/abonelik; Core kesintisi yerel kararı etkilemez, pasif abonelik fail closed; servis saatleri dışı deney |
| P0-09 | Gelecek Control erişim/sorumluluk tasarımı | KOŞULLU: ayrı aktif repo yok, geliştirme tetiklenmedi | Somut staff platform yönetim ihtiyacı | Platform + operasyon sahibi | Staff-only yetki/API sınırı, Serve Super Admin ile ilişki; secret read API'si ve doğrudan ürün DB erişimi varsayılmaz |
| P0-10 | Tenant scope ve kaynak izolasyonu denetimi | PLANLANDI | P0-01, P0-04 | Ürün sahipleri | Social/Serve ürünler arası DB erişimi reddi; yanlış tenant credential/media/job reddi; HotelOps webhook/oda ve Zammad/JSON erişimi için ürün bağlamı test planı |
| P0-11 | Kademeli deployment uygulama planı | BAŞLATILMADI | P0-06–08, P0-10; HotelOps için P0-13 | Operasyon sahibi | Ürün başına staging kanıtı, yedek/geri dönüş, gözlem ve ayrı prod geçiş görevi |
| P0-12 | Phase 0 kapanışı ve Core tetikleyici kaydı | PLANLANDI | İlgili pilot/doğrulamalar | Ürün/mimari sahibi | Gerçek sonuçlar; açık riskler; Core tetikleyicisi yoksa Core işi açılmaz |
| P0-13 | HotelOps canlı durum ve teslim riski doğrulaması | PLANLANDI: kaynak belgeleri mevcut, canlı kontrol yok | P0-04; ayrı operasyon görevi | HotelOps + operasyon sahibi | Çalışan commit, webhook/Zammad/Telegram/QR eşlemeleri, admin credential override, JSON yedekleme/çoklu proses/kalıcı retry ihtiyacı; değerler belgelere alınmaz |

Rol isimleri atanmış kişi anlamına gelmez. Uygulama görevini üstlenen kişi kayıt altına alınmadan görev READY olmaz. Serve ve HotelOps kaynakları okundu; uygulama/kesinti testi yapılmadı. Ayrı Control repo'su olmaması P0-01/02'yi açık bırakmaz; P0-09 yalnız ihtiyaç doğarsa başlar.

## İlk operasyon görevi: P0-03 envanter

P0-01 kapandı. Yalnızca isim/metadata içeren şu tablo P0-03 kapsamında doğrulanır:

| Ürün | Ad | Sınıf | Tüketici | Mevcut kaynak | Hedef | Geri dönüş |
|---|---|---|---|---|---|---|
| Social | META_APP_SECRET | Platform secret | Web + worker | process.env | Ürün/ortam scoped manager injection | Önceki geçerli config sürümüne kontrollü dönüş |
| Social | META_CREDENTIAL_KEY / PREVIOUS_KEYS | Şifreleme anahtarı | Web + worker | process.env keyring | Aynı anahtar biçimiyle injection | Eski keyId'lerin okunabilirliğini koru |
| Social | MEDIA_DELIVERY_SECRET | İmza anahtarı | Web + worker | process.env | Scoped injection | İmzalı URL süresi ve eski sürüm uyumunu sınamadan iptal etme |
| Social | BUSINESS_BRAIN_API_KEY | Platform secret | Business Brain provider | process.env | Scoped injection | Provider bazlı geri dönüş |
| Social | Meta Page token | Tenant credential | Meta connection/publish | Social MetaConnection | Aynı ürün DB'si | Taşıma yapılmaz |
| Serve | SECRET_ENCRYPTION_KEY(S), JWT_SECRET | Deployment/bootstrap | API | Env schema + Serve keyring | Hazır manager injection adayı; şifreli kayıt biçimi aynı | Eski key version okunur |
| Serve | Platform/tenant AI API key | Platform secret / tenant credential | Serve AI Gateway | Serve `encrypted_secrets` | Yerinde kalır; platform key taşınması ayrı ADR | Mevcut çözümleme/rotasyon korunur |
| Serve | Tenant connector/AI seçimi, paket, bütçe | Tenant config/ticari karar | Serve API | Serve DB | Yerinde kalır | DB kaynak semantiği korunur |
| HotelOps | TELEGRAM_BOT_TOKEN, ZAMMAD_API_TOKEN, WHATSAPP_* secret adları | Ürün entegrasyonu / platform veya hotel kapsamı ayrıca doğrulanacak | Bot + webhook | Ürün env'i; gerçek değerler incelenmedi | Hazır manager injection adayı, mevcut adlarla | Mevcut geçerli config ile kontrollü dönüş |
| HotelOps | ADMIN_USERNAME, ADMIN_PASSWORD | Admin erişimi | Admin UI | Kodda varsayılan değer var; canlı override doğrulanmadı | Ayrı güvenlik işinde zorunlu güvenli yapılandırma | Değerler ve prod durumu doğrulanmadan geçiş yok |
| Control | Ayrı aktif repo yok | Gelecek staff-only konsol | Belirlenecek | Uygulanmadı | İhtiyaç doğarsa ayrı tasarım | Ürün akışları ona bağlanmaz |

DATABASE_URL ve machine identity bootstrap'ı ayrıca ele alınır. App ID, URL ve Graph version secret sınıfına konmaz. İsim dışında token/key, token parçası veya prod müşteri verisi task paketine girmez.

## P0-06 pilotunun sınırları

- Yalnızca seçilmiş staging ortamı ve ayrı uygulama görevi; Core repo/servis, yeni business modeli, credential ciphertext dönüşümü veya migration yok.
- Yönetim manager'ın kendi UI'si üzerinden; injection mevcut Social loader'larına uyacak. SecretProvider ancak kanıtlanmış eksik varsa ayrı göreve bölünür.
- Web ve worker için gerekli izinler ayrı belirlenir; başka ürüne/prod'a erişim reddi gösterilir.
- Manager kesintisinde çalışan süreç, cold start, restart ve eksik secret davranışları ayrı sınanır.
- Sağlık kontrolü başarısız olursa rollout durur; çalışan eski süreçleri topluca kapatma yok.
- Prod'a veya Serve'e otomatik yayılma yok; her ürün için kendi kaynak incelemesi ve staging sonucu gerekir.

## Gelecek uygulama doğrulamaları

| Senaryo | Kabul ölçüsü |
|---|---|
| Tenant A, B'nin credentialRef/media/job kimliğini gönderiyor | B'nin verisi veya secret'ı çözülmüyor; sonuç tenant-safe |
| Social dev/staging identity prod veya Serve secret'ını istiyor | Manager erişimi reddediyor |
| Social DB kullanıcısı Serve DB'sine bağlanıyor | DB izinleri reddediyor; varsa mevcut istisna kayıtlı dönüşüm işi |
| Manager kesik, mevcut process çalışıyor | Geçerli değerlerle ana işler sürüyor; cold start sınırı açık, alarm var |
| Bir web/worker eski anahtar sürümünde | Rotasyon sırası hatası algılanıyor; eski kayıt/backup erişimi kaybolmuyor |
| Publish sonucu belirsiz | `UNKNOWN` korunuyor; secret retry gerekçesiyle yeniden gönderilmiyor |
| Serve Core veya AI erişimi kapalı | Mevcut pakette açık klasik menü, sipariş ve servis talebi Core/AI beklemeden çalışır; pakette kapalı özellik açılmaz. Paket/abonelik kararı Serve DB'den verilir. Bu kaynak kararı üretim kesinti testiyle ayrıca sınanır |
| Serve aboneliği pasif | `resolveEntitlement` gibi haklar kapalı kalır; Core kesintisi bunu genel fail-open'a çeviremez |
| Gelecek org eşlemesi | `(deployment/route, tenants.id)` aynı Serve tenant'ını doğru org'a bağlar; branch/QR/session/order ID'leri ve auth korunur |
| HotelOps Core/Control kapalı | Bot polling, imzalı webhook, Zammad biletleri ve misafir bildirimleri yeni platform çağrısı gerektirmez; gerçek harici servis kesintileri ayrı test edilir |
| HotelOps webhook kabulü sonrası hata | Mesaj/bilet/yanıt kaybı ve tekrar işleme sınırı ölçülür; kalıcı retry ihtiyacı P0-13'te karara bağlanır |
| Core sonradan eklendiğinde kapalı | Önceden aktif ürün yerel snapshot ve belirlenen politika ile boot/ana iş yapıyor |
| Üyelik/admin yetkisi iptal edilmiş | Ticari grace yetkisiz erişim açmıyor |

Bu senaryoların hiçbiri bu belge çalışmasında çalıştırılmış değildir. Yalnızca belge diff'i, kapsam, iç bağlantılar ve kaynak referansları kontrol edilir; uygulama test suite'i gereksiz yere çalıştırılmaz.

## Phase 0 tamamlanma ölçütleri

Üç aktif ürünün sahiplik/bağımlılık kaydı tamam; ortamlar ve secret sınıfları somut; manager seçimi kayıtlı; pilot ve geri dönüş kanıtı mevcut; Serve regresyon planı ve HotelOps canlı doğrulama paketi kapalı; görev sahipleri belirli. Kaynak incelemesi canlı ortam veya kabul testi tamamlandığı anlamına gelmez. Belge yazılması operasyon işlerinin tamamlandığı anlamına gelmez.

## Phase 0 dışında

Core runtime, org/identity migration, her tabloya org_id, cuid→UUID dönüşümü, tenant credential taşıma, Redis/RabbitMQ/Kafka, contracts paketi, Control-Core repo birleşimi, billing, universal Business Brain ve yeni ürün geliştirme. Bunlar yalnızca kanıtlanmış ihtiyaç ve ayrı kapsamla ele alınır.

## Önerilen sonraki adım

P0-03/P0-04 ürün ve ortam envanterini, HotelOps için P0-13 salt okunur canlı doğrulama kapsamını hazırla. Sonra dar Social staging pilotu için somut görev paketi çıkar. Serve secret/entitlement değişikliği veya Control geliştirmesi otomatik pilot kapsamı değildir.
