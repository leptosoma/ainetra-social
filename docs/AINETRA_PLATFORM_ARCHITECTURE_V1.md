# Ainetra Platform Architecture v1

Tarih: 26 Eylül 2026 · Kapsam: Platform Phase 0 · **Durum: FINAL — kaynak incelemesi tamamlandı; operasyon doğrulamaları açık.**

## Bir dakikalık karar özeti

- Büyük bir Core servisi şimdi yazılmayacak. Phase 0, mimari kararlar ve ayrı görevlerle yapılacak operasyon hazırlığıdır.
- Social, Serve ve HotelOps ayrı ürün/domain sınırlarıdır. Her ürün kendi veri erişimi, iş kuralları ve ürün içi yetkilerinin sahibi kalır; çapraz ürün DB erişimi kurulmaz. Serve kendi deployment/DB rotası içinde birden çok tenant'ı RLS ile barındırabilir. HotelOps'un bugünkü kalıcılığı Zammad ve ürün içi JSON dosyalarıdır; ayrı ilişkisel DB'si varmış gibi anlatılmaz.
- Platform secret'ları için hazır secret manager hedefi korunacak; Serve'in bugün DB'de şifreli tuttuğu platform AI anahtarları ayrı geçiş kararı olmadan taşınmayacak. Tenant token'ları kullanan üründe kalacak.
- Dev, Staging ve Prod ayrı deployment, ürününe uygun DB/kalıcılık, storage ve erişim kimliklerine sahip olacak.
- İleride Core, Organization, platform Membership, Product Activation ve ürünler arası ticari Entitlement sınırında değerlendirilecek. Serve'in mevcut paket/abonelik ve etkili entitlement kararları Core kesintisinde de yerel kalacak; ayrı geçiş olmadan değişmeyecek.
- Geçiş ilkesi **link, don't move**: mevcut kimlikler, tablolar ve Serve akışları taşınmayacak.

Bu çalışma yalnızca Markdown belgeleri üretir. Kod, migration, gerçek secret, DB, deployment ve çalışan süreçler değiştirilmez. Aşağıdaki hedefler mevcut sistemde uygulanmış özellikler değildir.

## 1. Kanıt ve doğrulama sınırı

Social domain kaynakları `29c1db171f32c17279aab67ec058951fb82fb171` revizyonunda ayrı çalışma kopyasında incelendi; belgelerin yazıldığı aktif yerel checkout `fix/calendar-fullcalendar-render` dalında `1e5ba6a` revizyonundadır. Bu fark ve korunmuş yerel değişiklikler [inceleme kaydındadır](platform/REPOSITORY_REVIEW.md). Aktif yollar, remotelar ve diğer kopyalar [proje envanterindedir](platform/AINETRA_PROJECT_INVENTORY.md).

Serve için `C:\Users\admin\Documents\Codex\Ops` reposunun `24c1d79ce715993d953d4808ee48ac357109ccb4` revizyonu source of truth olarak alındı; şema, auth, entitlement, secret, DB routing ve entegrasyon yolları [Serve incelemesinde](platform/SERVE_REVIEW.md) karşılaştırıldı. HotelOps için aktif `feature/whatsapp-room-conversation` dalındaki `33c3ad6` dokümantasyon commit'i ve README/CURRENT_STATE/ARCHITECTURE esas alındı. Ayrı çalışan Control repo'su bulunamadı; Control yalnız gelecek staff-only yüzeyidir. Gerçek production/staging topolojileri, HotelOps'un canlı commit'i ve canlı entegrasyonlar doğrulanmadı.

Temel referanslar kullanıcının sağladığı Claude ve Gemini raporlarıdır. Karşılaştırma, kaynak kimlikleri ve bilinçli sapmalar [referans karar kaydındadır](platform/REFERENCE_DECISIONS.md). Raporlar öneridir; gerçek kod ve kullanıcının koruma sınırları önceliklidir.

## 2. Bugün doğrulanan Social yapısı

| Alan | Kaynakta görülen durum | Mimari sonucu |
|---|---|---|
| Uygulama | Next.js / React / TypeScript, Prisma / PostgreSQL | Yeni platform framework'ü gerekmiyor |
| Tenant kökü | `Business.id` bir `cuid`; `Membership(userId,businessId)` | ID'ler yeniden üretilmeyecek; `businessId` kapsamı korunacak |
| Oturum | Ürün DB'sinde hash'li token ve süre sonu; httpOnly cookie | Mevcut sistemi JWT/OIDC varmış gibi anlatmayacağız |
| Meta credential | Social `MetaConnection`: opaque `credentialRef`, ciphertext, nonce, authTag, keyId | Token ve çözümleme Social'da kalacak |
| Şifreleme | AES-256-GCM, tenant/hesap/sağlayıcı bağlamlı AAD, mevcut/önceki anahtarlar | Envelope encryption/DEK-KMS mevcut değil; bu çalışmada zorunlu dönüşüm yok |
| Config | `loadMetaConfig`, `loadCredentialKeyring`, `loadMediaDeliveryConfig` ortam değişkenlerini okuyor | İlk entegrasyon mevcut isimlere secret injection olabilir |
| Yayın | `PublishIntent`, `PublishAttempt`, ürün içi PG worker; `UNKNOWN` sonucu korunuyor | Broker veya Core'a taşınmayacak; belirsiz yayın otomatik tekrarlanmayacak |
| Worker | Web'den ayrı süreç; aynı Social DB, medya deposu ve ilgili secret'lar | Secret dağıtımında web ve worker birlikte kapsanmalı |
| Geliştirme altyapısı | Compose içinde Postgres; yerel dosya depolaması | Üç ayrı canlı ortamın hazır olduğuna kanıt değil |

Repo planı P6-01–P6-04'ü tamamlanmış, P6-05'i başlamamış gösteriyor. Önceki test sonuçları tarihsel raporlardır; bu incelemede yeniden çalıştırılmadı. Gerçek Meta OAuth/yayın doğrulamasının yapıldığı da iddia edilmiyor.

## 2a. Serve'de doğrulanan yapı

| Alan | Ops kaynaklarında görülen durum | v1'e etkisi |
|---|---|---|
| Tenant | `tenants.id uuid`; `branches(tenant_id,id)`; tenant verisinde RLS ve composite FK | Eşleme adayının kökü Serve **tenant**'ıdır, branch/outlet değildir; mevcut `tenant_id` değişmez |
| Domain | QR/menü, guest session, sipariş, servis talebi; order ve service request ayrı aggregate | Bütün bu veriler ve event akışları Serve'de kalır; NFC ses kanalı planlıdır |
| Auth | Personelde JWT cookie + DB `auth_sessions` ve tenant rolleri; misafirde hash'li opaque cookie token + DB guest session | Merkezi login geçişi yok; guest akışı Core/IdP istemez |
| Ticari hak | Serve DB'de `plans`, `plan_features`, `subscriptions`, `tenant_feature_overrides` ve sunucu tarafı entitlement | Serve bugün etkili hak kaynağıdır; pasif abonelik fail closed davranır |
| AI secret | `encrypted_secrets` içinde platform ve tenant AI key; AES-GCM sürümlü keyring ve rotasyon servisi | Tenant BYOK ve mevcut platform anahtarları yerinde; hazır manager ilk etapta deployment/keyring için değerlendirilebilir |
| Altyapı | `DeploymentProfile` + `DatabaseRouter`; shared/dedicated/on-premise modeli; Serve içi connector registry, AI Gateway, outbox | Bunlar çalışan ürün içi platform katmanlarıdır; yeni Core'a taşınmaz |
| Yönetim | Aynı repo içindeki Super Admin ve tenant yönetim paneli | Ayrı Ainetra Control repo'su ile eşitlenmez; panel şimdi taşınmaz |

`PROJECT_STATUS.md` son kaydı QR Menü v1'in bağımsız kabul incelemesini bekliyor; production/staging doğrulaması iddia etmiyor. Bu çalışma da yalnız kaynak incelemesidir.

## 2b. HotelOps'ta doğrulanan yapı

| Alan | Aktif repo/dokümanlarda görülen durum | v1'e etkisi |
|---|---|---|
| Domain | Telegram ve WhatsApp misafir talepleri, oda konuşması, QR, departman yönlendirmesi ve Zammad biletleri | HotelOps ayrı konaklama operasyonu ürünüdür; Serve servis talebi veya Social mesajlaşma modeline taşınmaz |
| Kalıcılık | Biletler Zammad'da; eşleme, konuşma, QR ve işlenmiş mesaj durumu HotelOps `config/*.json` dosyalarında | Bağımsız ürün veri sınırı korunur; ayrı HotelOps ilişkisel DB'si veya çapraz ürün FK'si varsayılmaz |
| Akış | Telegram polling; ayrı, imzalı WhatsApp metin webhook'u; atama/kapanış Telegram callback'iyle Zammad ve misafir bildirimine dönüşür | Core/Control bu isteklerin veya boot yolunun önüne konmaz |
| Kimlik ve credential | Admin HTTP Basic; Telegram/Zammad/Meta kimlik bilgileri ürün ortamında kullanılır; JSON eşlemeleri Git dışında | Hotel/tenant credential'ları HotelOps'ta kalır; platform secret injection hazır manager ile değerlendirilir |
| Dayanıklılık | Webhook kabulünden sonra `BackgroundTasks`; kalıcı teslim kuyruğu yok, çoklu proses idempotency doğrulanmadı | Teslim/yeniden deneme riski ayrı ürün görevidir; platform bus varmış gibi anlatılmaz |

Kaynak: HotelOps [README, CURRENT_STATE ve ARCHITECTURE](platform/AINETRA_PROJECT_INVENTORY.md). `main` geçmişte production baseline'ı olarak adlandırılmıştır; çalışan production commit'i görülmedi. Varsayılan admin credential kodda tanımlıdır; canlı ortamda kullanımı doğrulanmadı. Bu belge değerleri içermez.

## 3. Sahiplik sınırları

| Veri / sorumluluk | Phase 0 sahibi | Core geldiğinde |
|---|---|---|
| Social Business, BrandProfile, Business Brain, medya, içerik, onay, yayın | Social | Social; yalnızca yerel kök ile org eşlemesi |
| Serve `tenants.id` ve `branches`; menü, kaynak/QR, guest session, order, service request | Serve | Serve; tenant ve operasyon verisi taşınmaz. NFC ses kanalı planlıdır |
| HotelOps Zammad bilet akışı; Telegram/WhatsApp eşlemeleri, oda konuşması, QR ve yerel durum | HotelOps (bilet kalıcılığı Zammad'da) | HotelOps; Serve `service_request` veya Core ortak bilet modeline taşınmaz |
| Tenant OAuth token / POS credential / BYOK / otel entegrasyon credential'ı | Kullanan ürün | Aynı ürün; başka ürüne secret dağıtımı yok |
| Platform provider secret / ürün şifreleme anahtarı | Social env; Serve'de platform AI key şifreli `encrypted_secrets` ve deployment keyring | Hazır manager hedefi; Serve şifreli kayıtları taşımak ayrı karar, Core DB'si hedef değil |
| Ürün içi roller ve oturumlar | Social yerel; Serve personel JWT + DB session, misafir DB guest session; HotelOps admin Basic ve Telegram kullanıcı eşlemesi | Ürün yetkileri yerel; insan AuthN geçişi ayrı ADR |
| Organization ve org üyeliği | Henüz ortak kaynak tanımlanmıyor | Core, yalnızca devreye alınan/eşlenen org'lar için otorite |
| Ürün aktivasyonu ve ticari haklar | Serve etkili kararını kendi `subscriptions`/plan/override kayıtlarıyla verir; Social ve HotelOps için ortak platform kaydı yok | Core yalnız ürünler arası ticari kayıt adayı; Serve etkili hakları ancak ayrı güvenli cutover ile bağlanabilir |
| Feature flag / tenant tercihi | Ürün/deployment | Ürün; entitlement ile birleştirilmez |
| Audit / AI usage / retention uygulaması | Kendi işlemi için ilgili ürün | Yerel kalır; Core yalnızca kendi işlemini kaydeder |

Core Organization, Ainetra'nın müşteri/ticari sınırıdır. Social Business marka bağlamıdır. Serve'de `tenant` mevcut müşteri/ürün kökü, `branch` onun altındaki birimdir. Gelecek eşleme `Core Organization ↔ Serve tenants.id` üzerinden düşünülür; bir org'un birden fazla Serve tenant'ı veya Social Business'ı olabilir. HotelOps için bugün doğrulanmış tenant/hotel kök ID'si yoktur; eşleme anahtarı ayrıca tasarlanır. Şube/masa/oda, org'a doğrudan taşınmaz. Ad, e-posta veya aynı ID üzerinden otomatik eşleme yapılmaz.

Üç ürün arasında doğrudan SQL, ortak ORM modelleri veya çapraz DB foreign key hedeflenmez. Bu, Serve içinde shared modda birden çok tenant'ın aynı RLS veritabanında yaşamasıyla karıştırılmamalı. Serve'in mevcut `DatabaseRouter` ve runtime/migration DB yetki ayrımı korunur; canlı ortam izinleri ayrıca incelenir. HotelOps'un Zammad ve JSON veri sınırı korunur. Gelecek Control'a ürün DB erişimi tanımlanmış sayılmaz. Serve'in mevcut Super Admin paneli bu çalışmayla sökülmez.

## 4. Phase 0 hedef topolojisi

```text
Yetkili operatör → Hazır secret manager'ın kendi yönetim arayüzü
                            │
                  ürün + ortam bazlı izinler
                  deployment/startup injection
                  ┌─────────┼──────────┐
                  ▼         ▼          ▼
               Social     Serve     HotelOps
             web+worker   API/web   bot+webhook
                  │         │          │
              Social DB   Serve DB   Zammad + JSON
                          rotası     ürün durumu

Serve Super Admin: mevcut Serve repo ve API'sinde kalır.
Control: ayrı aktif repo bulunamadı; gelecekteki staff-only admin yüzeyi.
Core runtime: kurulmaz. Ürün isteklerinin önüne Control/Core konmaz.
```

Şema Dev, Staging ve Prod için birbirinden ayrı uygulanacak hedefi anlatır. Secret manager sunucusu ortak olsa bile ürün/ortam projeleri, kimlikler ve izinler ayrılır; prod yönetim sınırı ayrıca doğrulanır. Bu yalnızca ortam seçen bir UI veya DB satırıyla sağlanmış sayılmaz.

## 5. Secret ve config politikası

| Sınıf | Somut örnek | Konum / yaşam döngüsü |
|---|---|---|
| Bootstrap / altyapı secret'ı | `DATABASE_URL` içindeki parola, machine identity kimlik bilgisi | Deployment'ın güvenli injection mekanizması; mümkünse workload identity; loglanmaz |
| Platform provider secret'ı ve ürün anahtarı | Social `META_APP_SECRET`, `BUSINESS_BRAIN_API_KEY`, `META_CREDENTIAL_KEY`; Serve `SECRET_ENCRYPTION_KEY(S)`, `JWT_SECRET` ve şifreli platform AI API key | Hazır manager deployment anahtarları için hedef; Serve'in DB'deki AI key'ini taşıma ayrı karar |
| Tenant credential | Social Meta Page token; Serve tenant AI BYOK; HotelOps'ta varsa otel bazlı sağlayıcı credential'ları | Kullanan üründe kalır; HotelOps için çoklu otel credential depolama modeli doğrulanmadı |
| Kapsamı doğrulanacak HotelOps entegrasyon secret'ı | Bot, Zammad ve WhatsApp webhook/token değerleri | Üründe kalır; platform/otel sınıfı ve hazır manager injection'ı P0-03'te doğrulanır |
| Secret olmayan config | `META_APP_ID`, redirect URI, public origin, Graph version, scope, worker limitleri | Kod veya sürümlü deploy config; değişiklik test edilip dağıtılır |

`SESSION_SECRET` örnek env dosyasında bulunuyor; incelenen Social session kodunda kullanılmıyor. Bu örnek satırı aktif auth bağımlılığı sayıp hayali merkezi session tasarımı kurulmaz. Yeni envanter yalnızca değişken isimleri, sahipler, tüketiciler ve metadata içerir; gerçek değer içermez.

**İlk uygulama tercihi:** hazır manager'dan mevcut `process.env` isimlerine deploy/startup injection. Uygulama yeni bir Core endpoint'inden secret istemez. İnce bir `SecretProvider` adapter ancak injection'ın karşılayamadığı somut yenileme ihtiyacı çıkarsa ayrı görev olur; ortak SDK/vault yazılmaz.

Serve'de platform AI key'i de tenant BYOK da bugün `encrypted_secrets` tablosundadır; `tenant_id IS NULL` platform kapsamını, dolu değer tenant kapsamını belirtir. Serve'in `SecretStore` sözleşmesi, sürümlü keyring'i, rotasyon servisi ve AI Gateway'de çözümleme yolu korunur. Hazır manager seçimi bu verileri başka DB'ye aktarma talimatı değildir. Önce deployment'ın keyring/JWT gibi bootstrap değerlerini güvenle verme ihtiyacı değerlendirilir. Platform AI key'ini ileride manager'a çıkarmak istenirse geri dönüşlü ayrı mimari karar ve uygulama gerekir; bugünkü route, Super Admin ve sağlayıcı seçimi sessizce değiştirilmez.

Infisical ilk değerlendirilecek adaydır, sağlayıcı seçimi/kurulumu bu belgeyle yapılmış değildir. Resmî belgeler süreç ortamına injection ve machine identity erişimini doğrular. Production'da otomatik `--watch` restart yerine kontrollü dağıtım planlanır. [CLI injection](https://infisical.com/docs/cli/commands/run), [machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities).

Günlük operasyonda sunucuya girip `.env` düzenlemek hedef değildir. Yerel geliştirmede git dışı env dosyası kullanılabilir; production secret'ı yerel dev'e verilmez. Secret'lar browser, `NEXT_PUBLIC_*`, image/build katmanı, Git, log, hata çıktısı veya AI prompt'una konmaz. Control'a vault yetkisi vermek Phase 0 şartı değildir; manager'ın kendi UI'si yeterlidir.

Social'daki Graph varsayılanı kodda `v26.0`, env override ise halen mümkündür. Hedef politika sürümü release ile sabitlemektir; mevcut kodun override'ı engellediği iddia edilmez. Güncel Meta sürümü seçmek bu çalışmanın kapsamı değildir.

### Rotasyon ve kesinti

- Web ve worker aynı onaylı config/anahtar sürüm kümesini alır. Yeni anahtar dağıtılmadan eski anahtar kaldırılmaz.
- Mevcut keyring eski credential'ları okumak içindir; reconnect yeni anahtarla yazar. Otomatik tüm kayıtları yeniden şifreleme mevcut kabul edilmez.
- Eski ciphertext ve geri yüklenecek yedekler eski anahtara ihtiyaç duyarken anahtar silinmez. Restore denemesi ve geri dönüş planı rotasyonun kabul şartıdır.
- Provider'ın iki secret'ı aynı anda kabul ettiği varsayılmaz. Anında iptal durumuna uygun, provider'a özel geçiş planı gerekir.
- Startup injection sıcak yenileme sağlamaz. Değer değişimi kontrollü restart/redeploy gerektirebilir; yeni sürüm sağlık kontrolünü geçmeden eski süreç durdurulmaz.
- Manager kesilirse çalışan süreçteki mevcut değerler kullanılabilir; sağlayıcı iptali/süre sonu bunu geçersiz kılabilir. Cold start/restart garanti değildir; secret yoksa bağımlı entegrasyon kapalı kalır. Core'suz boot kuralı secret'sız veya DB'siz boot garantisi değildir.
- `401/403` tenant token iptali, scope veya izin problemi olabilir. Kör refresh/retry veya belirsiz publish tekrar gönderimi yapılmaz; Social'ın mevcut hata sınıflaması korunur.

## 6. Ortam ve tenant izolasyonu

Dev, Staging, Prod her ürün için ayrı uygulama/worker/bot deployment'larıdır. DB/database user, storage veya HotelOps runtime JSON konumu, secret erişim kimliği, callback/origin/webhook ve provider test/prod ayrımı ayrı tutulur. Staging prod secret'ını, DB'sini, Zammad verisini veya medya/durum deposunu kullanmaz. Prod verisini staging'e kopyalamak bu planın parçası değildir. Bu ayrım hedef politikadır; mevcut canlı ortamlar doğrulanmadı.

Yeni izolasyon denetimlerinin başlangıcı mevcut ürün tenant köküdür. Social'da `businessId` ve server-side Membership; Serve'de `tenants.id` / `tenant_id`, RLS, tenant bağlamı ve ilgili composite FK'ler korunur. Serve `branch_id` tenant'ın alt kapsamıdır. HotelOps'ta henüz genel bir çoklu otel tenant kökü doğrulanmadı; oda ve departman eşlemeleri platform Organization kimliği sayılmaz. Client'ın gönderdiği kimlik tek başına yetki sayılmaz; worker, medya URL'si, webhook ve credential çözümleme kendi ürün bağlamını doğrular. Serve'e ikinci bir `org_id` kolon seti, yeni RLS katmanı veya ORM dönüşümü bu çalışmanın kararı değildir.

## 7. Control sınırı

Control bugün ayrı aktif repo/deployment olarak bulunmadı. Hedef, gelecekte Ainetra çalışanlarına özel (staff-only) platform admin konsoludur. Müşteri self-servisi ayrı bir sorumluluktur.

Serve'in kendi reposunda çalışan Super Admin ve tenant yönetimi var; paket, tenant, AI ayarı ve ürün operasyonlarını yerel API/DB üzerinden yönetiyor. Bu ekran Control değildir. Gelecek Control tasarımı Serve'in mevcut yönetim ekranı veya backend'ini taşımayı varsayamaz; ileride ayrı uygulama işi açılırsa API ve yetki sınırı o tasarımda kaydedilir.

İleride Organization, üyelik, aktivasyon ve entitlement yönetimini Core API'si üzerinden sunabilir. Platform secret kasası, AI proxy veya tenant token çözümleme servisi olmaz. Staff yetkileri, MFA/SSO ve ağ erişimi ayrı operasyon göreviyle doğrulanır; bugün var oldukları söylenmez. Secret yönetimi UI'si eklemek gerekirse değer geri okunmaz; yalnızca durum/sürüm/rotasyon metadata'sı görünür.

Henüz korunacak veya birleştirilecek ayrı Control deployable'ı doğrulanmadı. Gelecekte Core ile aynı veya ayrı deployment seçeneği somut ihtiyaçla değerlendirilebilir; bu belge Control geliştirme emri vermez.

## 8. Gelecekteki Core: sınır ve başlama kapısı

Şunlardan en az biri kayıtlı gerçek ihtiyaç olarak ortaya çıktığında değerlendirme açılır:

1. Aynı ödeme yapan müşteri iki ürünü birlikte kullanır ve ortak org/üyelik yönetimi ister.
2. Social + Serve bundle satışı ortak aktivasyon/hak senkronizasyonunu gerektirir.
3. Üçüncü bir production ürünü aynı platform tenancy/üyelik mantığını tekrar yazma ihtiyacı gösterir. HotelOps'un ayrı ürün olarak varlığı tek başına bu kanıt değildir.
4. Ürünler arası yönetim için tekrarlanan manuel DB işlemleri ölçülür ve yerel çözüm yetersiz kalır.
5. Müşteriden doğrulanmış ortak login talebi vardır.

Takvim veya ürün sayısı tek başına geliştirme emri değildir. Tetikleyici kaydı; müşteri/problem kanıtı, daha küçük alternatif, bakım sahibi, dar kapsam ve başarı ölçüsü içerir. Core başlamadan üç aktif ürünün etkilenecek sınırları, Serve kesinti bütçesi, HotelOps entegrasyon/teslim sınırı ve izolasyon/geri dönüş planı incelenir. Ayrı Control repo incelemesi, mevcut olmayan bir repoyu bekleme şartı değildir.

| Core v1 içinde | Core dışında |
|---|---|
| Organization ve minimal ticari profil | Ortak Business/Location/Universal Brain |
| IdP subject bağlantısı; org Membership, sınırlı platform rolleri | Parola/MFA motoru; Serve guest/device session ve ürün rolleri |
| Ürünler arası Product Activation ve ticari Plan/Entitlement sınırı | Serve'in bugünkü `subscriptions`, plan/feature/override çözümlemesini otomatik devralma; teknik feature flag ve tenant tercih motoru |
| Ürün başına versioned snapshot ve kendi audit kaydı | Platform secret store, tenant credential, AI proxy |
| Gerekirse transactional outbox + imzalı webhook | Şimdiden broker, billing, usage ledger, merkezi retention veya tüm audit verisi |

AuthN ileride hazır OIDC IdP ile değerlendirilir. Membership platform yetkisidir; Serve garson izni veya Social yayın onayı değildir. Ortak profile güncellemesi ürünün kullanıcı tarafından doğrulanmış marka/menü bilgisini otomatik ezmez.

Entitlement ticari haktır; feature flag teknik dağıtım kontrolü; tenant setting kullanıcı tercihidir. Serve mevcut ürün hakkını abonelik, plan, override ve global default sırasıyla kendi DB'sinden çözer; pasif abonelikte hak kapalıdır. Core veya Control kesintisi Serve paket/abonelik kararını değiştiremez; paket haklarını genel fail-open ile açmaz veya yanlışlıkla topluca kapatmaz. Gelecek Core önce ürünler arası satın alma/aktivasyon bilgisini koordine edebilir. Serve'e etkili hak sağlama yetkisi ancak mevcut semantiği koruyan veri eşlemesi, çift okuma karşılaştırması, kesinti deneyi ve geri dönüşü olan ayrı ADR ile aktarılabilir. Social ve HotelOps için bugünkü ortak platform abonelik kaydı varsayılmaz.

## 9. Core kesintisinde hedef davranış

Bu tablo gelecekteki kabul kriteridir; bugünkü sistemde çalıştırılmış test sonucu değildir.

| Kesinti / değişiklik | Beklenen davranış |
|---|---|
| Core kapalı | Social, Serve ve HotelOps mevcut yerel DB/config/entegrasyon yollarıyla devam eder; gelecekteki org/ürünler arası aktivasyon işlemleri bekler. Serve mevcut abonelik denetimi kendi DB'sinden uygulanır |
| Control kapalı | Ürünlerin ana işlemleri ve startup'ı Control çağrısı beklemez |
| IdP kapalı | Geçerli yerel oturumlar süre/politikaları içinde devam eder; yeni login yetkisiz açılmaz; Serve guest akışı IdP istemez |
| Gelecekteki ticari snapshot gecikmiş | Serve'in bugünkü entitlement motoru değiştirilmez. Yeni projection ancak ayrı cutover kararıyla ve mevcut abonelik semantiğiyle uyumlu olarak kullanılabilir |
| Üyelik/admin yetkisi iptal edilmiş | Ticari grace yetki iptaline uygulanmaz; admin/kritik işlem güncellik sınırı aşıldığında kapalı başarısız olur |
| İlk platform aktivasyonu için hiç snapshot yok | Yeni platform aktivasyonu bekler; eşlenmemiş Serve tenant'ının mevcut yerel abonelik/hak yolu sürer |
| Secret manager kapalı | Mevcut process değerleri izin verdiği sürece devam; yeni deployment durdurulur; provider-dependent işlem için sahte başarı yok |
| Serve AI sağlayıcısı kapalı | Mevcut ürün kararı: klasik menü ve ticari olarak açık sipariş/servis akışı AI olmadan yürür; kapalı paket özellikleri açılmaz. Üretim kesinti deneyi ayrıca yapılmalı |
| HotelOps için Core/Control kapalı | Telegram polling, WhatsApp webhook, Zammad bilet akışı, oda konuşması ve bildirimler yeni platform çağrısı beklemez. Bu hedef, Meta/Telegram/Zammad veya yerel config kesintisine dayanıklılık garantisi değildir |
| Core hatalı toplu downgrade yayıyor | Sürüm/şema/tenant doğrulaması, tenant bazlı rollout ve alarm; sessiz geniş çaplı kilitleme yok |

Grace süreleri, güvenlik yetkisi güncellik sınırı ve RTO/RPO sayılarını kanıt olmadan sabitlemiyoruz; Core görevi açılmadan sorumlu kişi belirleyip test planına yazılacak. Serve'in mevcut `resolveEntitlement` davranışı pasif abonelikte kapalıdır; genel fail-open veya otomatik grace burada karar değildir. Bilinen güvenlik iptali hiçbir ticari grace ile atlanmaz. Core DB kaybında yerel snapshot tam yedek değildir; Core'un kendi yedek/restore planı gerekir.

## 10. Link, don't move

Bugün schema değişikliği yok. Gelecekte yeni Organization için UUIDv7 hedeflenir; mevcut Social `cuid` ve Serve UUID kimlikleri korunur. Ürünler arası referans `(environment, product, deployment/route, localTenantId)` şeklinde isim alanıyla taşınır; Social tarafındaki `localTenantId` Business ID, Serve tarafındaki `tenants.id`'dir. HotelOps için güvenilir yerel hotel/tenant ID tanımlanmadan böyle bir kayıt üretilmez; oda numarası veya Zammad bilet ID'si org anahtarı değildir. ID gizliliği yetkilendirme değildir.

İleride ürünün tenant köküne nullable `platform_org_id` veya ayrı eşleme tablosu eklemek additive bir seçenek olabilir. Serve'de bağlanacak kök `tenants.id`'dir; `branches`, kaynak/masa, QR, guest session, order veya service request değildir. Shared/dedicated/on-premise rotaları ve bir org'a birden çok Serve tenant eşlenmesi düşünülmeden kolon biçimi seçilmez. HotelOps için önce otel kimliği ve veri sahipliği incelenir; sırf eşleme için Zammad bileti veya JSON kayıtları taşınmaz. Core ile DB foreign key kurulmaz. Ürün Business/tenant, branch, menü, session, içerik, credential ve operasyon satırları kendi ürün veri sınırında kalır.

1. Gerçek müşteri, pilot, demo/seed ve test kayıtlarını ayır; demo kayıtlarını kendiliğinden ticari org yapma.
2. İnsan tarafından onaylanmış N:1 eşleme envanteri hazırla; isim/e-posta eşitliğine güvenme.
3. Tenant bazlı dry-run, idempotent uygulama, satır sayısı ve referans bütünlüğü kontrolünü tasarla.
4. Küçük pilotla bağlantıyı aç; ürün içi ID ve URL'leri değiştirme. Login sırasında gizli/lazy org birleştirmesi yapma.
5. Geri dönüş eşlemeyi/projection okumasını kapatır; eski yerel yol ve veriler çalışabilir kalır. Otomatik unlink/delete yok.
6. Kimlik/OIDC geçişini ayrı ele al; yalnızca e-posta eşitliğiyle hesap birleştirme. Mevcut credential şifreleme anahtarlarını ID değişimiyle bozma.

Serve için servis saatleri dışındaki pencere, backup/restore provası ve gerçek menü → QR/guest session → sipariş → personel operasyonu ile ayrı servis talebi regresyon listesi olmadan hiçbir gelecek geçiş görevi hazır sayılmaz. Bu belge Serve için bugün böyle bir geçiş gerektirmez.

## 11. İletişim, contracts ve yeni ürünler

Bugün ürünler arası ortak event bus veya `@ainetra/contracts` yok. **Serve'in kendi** order/service-request event ve notification outbox'ı, **Social'ın kendi** PublishIntent outbox'ı vardır; bunlar yerinde kalır. HotelOps'un WhatsApp kabul sonrası `BackgroundTasks` ve JSON dedupe yolu kalıcı outbox değildir; teslim hataları ayrı HotelOps işi olarak ele alınır. İlk gerçek ürünler arası akışta versioned API/webhook ve gerektiğinde ürünün mevcut outbox'ına uyumlu ayrı teslim sınırı tasarlanır. Mevcut event kayıtlarını genel platform kuyruğu diye yeniden yorumlamayız.

Gelecek sözleşmeler tenant/product bağlamı, event ID, schema version, zaman, correlation ID ve minimum payload taşır. İmza, audience/scope, replay penceresi, idempotent tüketim, sırasız/eski sürüm reddi, retry ve hata kuyruğu tanımlanır. Secret/ciphertext event payload'ına girmez. İkinci gerçek tüketici aynı sözleşmeyi kullanınca yalnızca şema/tip içeren semver'li contracts paketi düşünülür; ORM ve iş mantığı paylaşılmaz.

Mevcut ürünler Social, Serve ve HotelOps'tur. Inbox/Reviews araştırma adayıdır; bu belge yeni ürün başlatmaz. Gelecek ürün ayrı persona, iş akışı, domain ve bağımsız satılabilir değer gerektirir. Serve servis talebi HotelOps'un bilet/oda operasyonunu yutmaz. Aynı bağlantıya iki ürün gerçekten ihtiyaç duyarsa Connection Hub için yeni ADR hazırlanır; bugünkü ürün token'larına başka ürün erişemez.

## 12. Karar kayıtları ve uygulama sırası

[ADR dizini](adr/README.md) bu kararları gerekçe ve alternatifleriyle sabitler. [Phase 0 görev planı](AINETRA_PLATFORM_PHASE_0_TASK_PLAN.md) belge çalışması ile henüz başlanmamış uygulama işlerini ayırır.

**Sonraki adım:** Ürün/ortam secret ve deployment envanterlerini tamamlamak; HotelOps production commit'i, credential yapılandırması ve gerçek departman/Telegram eşlemelerini salt okunur doğrulamak; ardından Social staging için sınırlı manager injection görevini somutlaştırmak. Serve'in şifreli AI key deposunu, entitlement motorunu veya DB router'ını değiştirecek iş Phase 0'ın otomatik parçası değildir. Ayrı Control geliştirmesi, ancak somut platform yönetim ihtiyacında açılır.

### Doğrulanmamış noktalar

- Üç ürünün gerçek Dev/Staging/Prod deployment, DB/kalıcılık erişimi ve secret ayrımı.
- HotelOps production'da çalışan commit, canlı webhook/Zammad/Telegram akışı ve departman/grup eşlemeleri; varsayılan admin credential'ın production'da kullanılıp kullanılmadığı.
- Serve'in canlı kesinti davranışı ve paket/abonelik kararlarının Core yokluğundaki kabul testi; Social canlı Meta OAuth/yayın.
- Hazır secret manager sağlayıcısı, kurulum ve rotasyon/restore runbook'u. Ayrı Control repo/deployment'ı bulunmadı.
