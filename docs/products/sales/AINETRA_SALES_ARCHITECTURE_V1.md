# Ainetra Sales — Architecture v1

**Durum:** İncelemeye açık teknik tasarım; uygulanmış sistem veya APPROVED ürün kararı değildir · 26 Eylül 2026  
**Yetki:** `00_PRODUCT_SPEC.md` v1.1 APPROVED ürün davranışını; [Platform Architecture v1 FINAL](../../AINETRA_PLATFORM_ARCHITECTURE_V1.md) ürünler arası sınırı belirler. [Konumlandırma](AINETRA_SALES_PRODUCT_POSITIONING.md), [uyum incelemesi](AINETRA_SALES_COMPATIBILITY_REVIEW.md) ve [aşama planı](AINETRA_SALES_PHASE_PLAN.md) bu tasarımı tamamlar.

## 1. Hedef ve ilk dilim

Sales'in hedef sistemi Product Spec'teki Prospecting, Advertising Manager, Sales Agent ve gerçek satış/gelir öğrenme döngüsüdür. **İlk pilot**, yalnız Ainetra'nın kendi satış ihtiyacı için Bodrum restoran prospecting akışıdır: kaynak/provenance → normalize/deduplicate → araştırma ve temel rakip bağlamı → açıklanabilir Fit Score → Top 20 → outreach draft ve ondan **ayrı** Outreach Eligibility → insanın kalite değerlendirmesi. Product Spec §52.3'te pilotta zorunlu olmayan otomatik outbound, production Sales Agent, tam Advertising Manager, ads write, ödeme, karmaşık attribution vb. bu ilk dilime eklenmez.

## 2. Bileşen ve veri topolojisi

```text
Sales UI / authenticated operator
             │
             ▼
Sales application (modular monolith: API + domain/policy modules)
        ├── Sales DB (authoritative product state)
        ├── aynı domain kodunu kullanan, gerekirse ayrı worker process
        ├── izinli AI/provider adapter'ları
        └── ürün sınırından versioned API/webhook → gerektiğinde Social/Serve/HotelOps

Core/Control bugün çalışma yolunda değildir. Ürünler arası SQL, ortak ORM veya FK yoktur.
```

Pilot için monolith **domain organizasyonudur**, belirli framework/hosting kombinasyonuna zorunlu bağlılık değildir. Eski taslağın Next.js/FastAPI/PostgreSQL önerisi uygulanabilir adaydır; kurulum ve bakım yükü pilot öncesi kararda doğrulanır. UI, API ve arka plan işi farklı process olabilir, fakat ayrı microservice ya da bağımsız domain otoritesi değildir. Kalıcı iş/job durumu Sales DB'dedir; kısa ömürlü cache/queue authoritative değildir. Uzun araştırma için worker gerekli olabilir; Redis ancak DB tabanlı güvenilir iş kuyruğunun pilot hacmi, gecikmesi veya concurrency'si yetmezse eklenir. n8n ancak onaylı sağlayıcı entegrasyonunda somut hız/operasyon yararı varsa, state ve policy sahibi olmadan kullanılır. Kafka, platform broker, yeni Core, ortak contracts paketi ve Connection Hub kurulmaz. pgvector yalnız kanıtlanmış semantic retrieval ihtiyacında; knowledge/fact kaydının yerine geçmez.

Sales modül sınırları: tenancy/access; prospect/company/contact ve provenance; research/deduplication/fit score; outreach eligibility/suppression/approval; lead/conversation/opportunity/offer; campaign/ads intelligence; attribution/revenue; reactivation/leakage; AI runtime; integrations/audit. İlk pilot yalnız gerektirdiği modüllerin dar kesitini uygular; gelecekteki domain listesinin olması bütün tabloları veya servisleri şimdi kurma talimatı değildir.

## 3. Domain ownership ve veri sınırı

| Sales'e ait | Başka yerde kalır |
|---|---|
| Prospect, Sales `Company`, Contact, Lead, Conversation, Opportunity, Offer, Campaign, Attribution, Revenue | Platform `Organization` ve ilerideki platform Membership/Activation |
| Reactivation, Leakage Protection, Advertising Intelligence, Sales Agent state, outreach/compliance state, Sales audit/AI usage | Social içerik, creative planning, publishing, MetaConnection ve organik kanal credential'ları |
| Sales connector eşlemeleri ve tenant credential'ları | Serve sipariş, rezervasyon/operasyon kaydı, tenant/branch, subscription/entitlement; HotelOps oda/bilet/Zammad/WhatsApp operasyon durumu |

`Organization` = Ainetra müşterisi. Sales `Company` = o müşterinin müşterisi/prospect'i. Sales'in yerel tenant kökü müşteriye göre ayrı yetki ve veri kapsamı sağlar; `Company` tenant kökü değildir. Aynı prospect şirket farklı Sales tenant'larında ayrı müşteri verisi olarak bulunabilir. Client'ın sağladığı tenant/Company ID'si yetki kanıtı sayılmaz. API, worker, export, webhook ve credential çözümleme server-side tenant context'i uygular; testlerde çapraz tenant erişimi reddedilir. PostgreSQL seçilirse RLS savunma katmanı olabilir; RLS'nin varlığı tek başına yetkilendirme değildir. Sales DB rolü yalnız Sales DB'ye erişir. Diğer ürünlerle veri alışverişi izinli, en aza indirilmiş API/event contract'larıyla olur.

Kaynak gözlemi/raw snapshot veya güvenli referans ile normalize edilmiş veri ayrılır. Provenance, gözlem zamanı, FACT/INFERENCE/CONFLICT/UNKNOWN, confidence ve kural/sürüm referansı saklanır. Şüpheli duplicate `POSSIBLE DUPLICATE` olarak kalır; insan/kanal kimliği belirsizken geri döndürülemez otomatik birleşme yapılmaz. Skor, eligibility, onay, attribution ve gelir olguları açıklanabilir ve audit edilebilir. Tam saklama süreleri, export biçimi, tenant silme ve veri bölgesi ayrı compliance/ürün kararlarına bağlıdır; burada uydurulmaz.

## 4. Auth ve tenant karar kapısı

Eski taslaktaki Supabase Auth, `organizations/users/memberships/roles` ve tüm tenant verisinde `organization_id` modeli **Sales-local provisional** bir taslak olarak yeniden konumlandırılır. `organizations` adı platform `Organization` otoritesini çağrıştırdığı için Sales-local kökün adı ve ID biçimi ilk Sales implementasyon kararıyla seçilir; ilerideki Core eşlemesi ayrı kapıda kararlaştırılır. Supabase Auth/IdP seçimi, rol sözlüğü ve RLS deseni platform çapında karar olarak sabitlenmez. Pilot erişimi dar tutulabilir; gerçek yetki/rol davranışı Product Spec §58 açık ürün kararıyla uyumlu olmak zorundadır.

**Karar kapısı:** Sales pilotu ile, özellikle üçüncü/sonraki production ürün olarak yayına alınması arasında gerçek ortak müşteri, ortak login/üyelik, bundle/aktivasyon veya tekrar yazılan tenancy kanıtı toplanır. [Platform Architecture §8](../../AINETRA_PLATFORM_ARCHITECTURE_V1.md)'deki tetikleyicilerden biri kayıtlıysa, daha küçük alternatif, bakım sahibi, etkilenen ürünler, Serve kesinti sınırı, HotelOps entegrasyon sınırı, başarı ölçüsü ve geri dönüş planıyla **dar Core Phase 1** kararı açılır. Böyle bir kanıt yoksa Sales, server-side doğrulanan yerel auth/tenant ile ilerler. Takvim veya “üçüncü ürün” etiketi tek başına Core geliştirme emri değildir. Core devreye girerse mevcut Sales tenant ID'si korunur; insan onaylı, namespaced `(environment, product, deployment/route, localTenantId)` eşlemesi additive yapılır. E-posta/ada göre sessiz birleştirme, çapraz DB FK ve kimlik/credential toplu taşıma yoktur. Core/Control erişilemezken Sales'in mevcut ana işlemleri yeni platform çağrısı beklemez; yeni login ve kritik yetki iptali için güvenli başarısızlık kuralı ayrı tasarlanır.

## 5. Secret ve credential modeli

| Sınıf | Yer ve erişim |
|---|---|
| Platform/provider/deployment secret'ı: AI provider key, Google/Meta uygulama sırrı, DB bootstrap, credential encryption key | Hazır secret manager'da ürün+ortam kapsamlı yönetim ve deployment/startup injection hedefi. Sağlayıcı seçimi/rotasyon planı operasyon işidir. |
| Tenant credential'ı: müşterinin Google Ads, Meta Ads, CRM, WhatsApp hesabı token'ı vb. | **Sales encrypted credential store**. Opaque `credentialRef` Sales içinde yetkili, tenant/account/provider/scope bağlamıyla çözülür. Şifreleme anahtarı manager'dan verilir; ciphertext, nonce/tag ve key version ürün içinde tutulur. |
| Secret olmayan config | Sürümlü deploy config; credential ile karıştırılmaz. |

CredentialRef, API/event/job/log/AI prompt'unda token değerinin yerini tutar; ref başka tenant'ta çözülemez. Key rotasyonunda eski sürümler ve yedek okunabilirliği doğrulanmadan silinmez. Browser, Git, image, log ve AI provider'a secret çıkmaz. Social Meta token'ı Sales tarafından okunmaz veya kopyalanmaz. İki ürünün aynı hesap bağlantısını gerçekten kullanması Connection Hub için ayrı ADR tetikler. Secret manager kesilirse çalışan process yalnız halen geçerli enjekte edilmiş değerlerle devam edebilir; cold start/yenileme garanti değildir, eksik secret'a bağlı işlem kapalı kalır.

## 6. Entegrasyon, API ve event sözleşmesi

İlk pilot kaynak araştırma adapter'ları ve gerekirse dış AI sağlayıcısı kullanır. Sağlayıcının kullanım izni, kaynak/provenance koşulları, rate limit ve veri işleme sınırı doğrulanmadan intake açılmaz. Dış sonuçlar ham/normalize aşamalardan geçer; callback doğrudan domain state yazmaz. Sales API'si tüm command/state transition ve tenant/policy denetiminin kapısıdır. Uzun iş isteği kalıcı iş kaydı ve idempotency key ile izlenir; retry duplicate prospect/outreach üretmez.

İleride Serve/HotelOps'tan ticari sonuç, booking/appointment veya operasyon kapasitesi sinyali gerekirse yalnız ilgili ürünün izin verdiği dar API/event contract'ı kullanılır. Sales, kendi attribution/revenue yorumunu bu sinyalden üretir; Serve order veya HotelOps ticket sahibi olmaz. Social ile paid/organic rapor bağlantısı da aynı ilkeye uyar. İlk gerçek ürünler arası contract: environment/product/local tenant eşlemesi, event ID, schema version, oluşma zamanı, correlation ID, minimum payload, audience/scope ve imza içerir; replay, sırasız/eski sürüm, idempotent tüketim, bounded retry ve hata görünürlüğü tanımlanır. Credential/ciphertext taşınmaz. Gerçek tüketici yokken event bus veya shared SDK açılmaz.

## 7. AI runtime ve karar yetkisi

AI araştırma sentezi, score açıklaması ve outreach draft için task sınıfları kullanabilir. Model/router seçimi config ve ölçülen kalite/maliyet/gecikme ile yapılır; pilotta karmaşık çok sağlayıcılı router zorunlu değildir. İzinli tool listesi, tenant context, veri minimizasyonu, task başına bütçe/timeout ve audit zorunludur. Agent/LLM doğrudan SQL, credential çözümleme veya dış sisteme sınırsız yazma yetkisi almaz. Fit Score sayısı, eligibility, suppression, legal basis, onay, bütçe/harcama sınırı ve önemli state transition deterministik domain/policy katmanındadır. AI FACT icat etmez; yetersiz veri `UNKNOWN` veya human review'a döner. Provider/model fallback yalnız aynı gizlilik, bölge, izin ve kalite sınırını sağlıyorsa yapılır. Product Spec'teki approval ve guardrail precedence tüm AI eylemlerinde korunur.

## 8. Compliance ve ürün guardrail'leri

Fit Score, iletişim izni değildir. Outbound ve kişisel veri içeren advertising audience export için tek Outreach Eligibility gate; retention, suppression/opt-out, provenance, recipient/jurisdiction, kayıtlı legal basis/permission, kanal, sektör/sensitive data, platform kuralı ve gerekli insan onayını denetler. `UNKNOWN ≠ ALLOW`; belirsizlikte gönderim/export yok, review gerekir. AI hukuki dayanak üretmez. Draft/onay otomatik gönderim değildir; ilk pilotta otomatik e-posta/WhatsApp yoktur. Approval süre sonu ve durum değişikliği eski izni yeniden kullanmaz. Health/sensitive data için Product Spec'in daha sıkı guardrail'leri geçerlidir. Import, export, silme ve geçmiş kampanya verisi tenant/purpose sınırıyla audit edilir; kanal/ülke bazlı kesin hukuk kararı burada verilmez.

Advertising ileriki aşamada önce read-only Advisor olarak değer üretir. Write/execute ancak Product Spec'in automation level, açık tenant izni, platform permission, fresh approval, süre sonu ve guardrail şartlarıyla tasarlanır. Veri yetersizse öneri üretmeme davranışı korunur. AI Sales Agent daha sonra doğrulanmış bilgiyle qualification ve human handoff yapar; orijinal konuşma geçmişi özetle değiştirilmez, belirsiz müşteri kimliği `POSSIBLE MATCH` olur.

## 9. Hata halleri ve operasyon

| Durum | Hedef davranış |
|---|---|
| Kaynak/provider/AI erişilemiyor veya oran sınırı var | İş açık hata/partial state ile kalır; provenance veya FACT uydurulmaz, kontrollü retry ve idempotency uygulanır. |
| Worker kapanıyor / callback tekrar geliyor | Kalıcı job/state korunur; lease/tekrar işleme aynı domain sonucu iki kez üretmez; belirsiz dış yazma kör tekrar edilmez. |
| Credential iptal/401/403 | Bağlantı ilgili tenant için durur, yeniden yetkilendirme istenir; başka tenant token'ına fallback yoktur. |
| Sales DB yok | Authoritative karar verilmez; sahte başarı/izin gösterilmez. Restore ve geri dönüş provası production kapısıdır. |
| Core/Control yok | Yerel Sales ana akışı sürer; yeni ortak aktivasyon/üyelik değişikliği bekler. Bilinen güvenlik iptali ticari grace ile aşılmaz. |
| Secret manager yok | Çalışan süreçteki geçerli değerler devam edebilir; yeni cold start/rotation başarısı varsayılmaz. |
| Entegrasyon olayı gecikmiş/çelişkili | Gelir/attribution sonucu provisional/unknown görünür; kaynak ve zaman korunur, mutabakat gerekir. |

Log, audit ve uyarılar tenant, correlation/job ID, provider, sürüm, maliyet ve hata sınıfını taşır; kişisel veri ve secret'ı taşımaz. RPO/RTO, retention, alert sahibi ve kapasite eşikleri pilot hazırlığında ölçülüp kararlaştırılır.

## 10. Ortamlar, dağıtım ve test stratejisi

Dev, Staging ve Prod ayrı Sales uygulama/worker deployment'ı, DB/DB kullanıcısı, storage, secret scope/machine identity, callback/origin ve provider test/prod bağlantılarına sahiptir. Staging prod credential veya verisine erişmez. Bu hedef politika, mevcut Sales deployment'ı bulunduğu iddiası değildir. Küçük, geri alınabilir pilot dağıtımı; health/readiness, yedek ve restore provası, sürümlü config, izleme, tenant izolasyon ve credential rotasyon kontrolüyle production'a aday olur. Hosting, bölge, Supabase/PostgreSQL seçimi, auth sağlayıcısı, migration authority ve kesin RPO/RTO uygulama öncesi kararlardır.

Testler: (1) normalize/dedupe, aynı input+skor sürümünden aynı sayı ve açıklama faktörü, fact/inference ayrımı; (2) tenant A'nın B'nin veri/ref/job/export'unu okuyamaması ve dev'in prod secret/DB'sine erişememesi; (3) eligibility/opt-out/retention/human approval olmadan outbound veya audience export olmaması; (4) tekrarlanan job/callback, provider timeout, worker restart, secret rotasyonu ve restore; (5) insanın Top 20 kalite değerlendirmesi, AI çıktı doğruluğu/maliyeti ve Product Spec §52 başarı ölçütü. Pilot dışı Sales Agent/Ads write uçtan uca testi, o yetenek implementation'a alındığında eklenir.

## 11. Karar kaydı sınırı

Bu tasarım ürün spec'ini veya FINAL platform ADR'lerini değiştirmez. Sales'e özgü ADR adayları [uyum incelemesinin sonunda](AINETRA_SALES_COMPATIBILITY_REVIEW.md) yalnız öneridir; henüz açılmış/kabul edilmiş kayıt değildir.
