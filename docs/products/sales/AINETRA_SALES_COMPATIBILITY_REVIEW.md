# Ainetra Sales — Platform v1 uyum incelemesi

**Durum:** Teknik değerlendirme; ürün kararı veya yeni platform ADR'si değildir · 26 Eylül 2026  
**Karşılaştırılan kaynaklar:** Kullanıcının sağladığı `00_PRODUCT_SPEC.md` v1.1 **APPROVED** ve sohbet ekindeki `02_TECHNICAL_ARCHITECTURE_DRAFT.md` v0.1 **DRAFT — REVIEW REQUIRED**; bu repodaki [Platform Architecture v1 FINAL](../../AINETRA_PLATFORM_ARCHITECTURE_V1.md), [ADR P0001–P0006](../../adr/README.md), [Phase 0 planı](../../AINETRA_PLATFORM_PHASE_0_TASK_PLAN.md), [proje envanteri](../../platform/AINETRA_PROJECT_INVENTORY.md). Yüklenen iki kaynak Social repo dışındadır; bu inceleme onları değiştirmez. Çalışma alanında teknik taslağın daha sonra genişletilmiş başka bir kopyası da vardır; aşağıdaki bölüm referansları **sohbet ekindeki 943 satırlık dosyaya** göredir (SHA-256: `06A6633EBBDF6027B954B2739C697075316EC810998E84B408536B64C55FE80D`).

**Ölçüt:** `KEEP` Sales içinde korunur; `CHANGE` mevcut taslaktaki teknik konum/ifade Sales ve platform sınırına göre düzeltilir; `DEFER` kanıt veya ayrı karar kapısına bırakılır. Ürün davranışı ve Product Spec §52 pilot sınırı hiçbir statüyle değiştirilmez. Bu matrisin hedef anlatımı [Sales Architecture v1](AINETRA_SALES_ARCHITECTURE_V1.md)'dedir.

| Eski teknik taslak (bölüm) | Statü | Platform v1'e göre karar / gerekçe |
|---|---|---|
| §1–2 Product Spec üstünlüğü ve Bodrum restoran prospecting pilotu | KEEP | APPROVED v1.1 ürün kaynağı ve §52 akışı aynen kalır; Sales adıyla okunur. |
| §3.1 tek repo içinde modular monolith; API/worker aynı domain kodu | KEEP | Sales ürün sınırında makul pilot biçimi; ayrı deployable/microservice zorunluluğu değildir. Core runtime eklenmez (P0001). |
| §3.2, §7.2–7.6 raw/provenance, normalize/dedupe, FACT/INFERENCE, deterministik score, Top 20, ayrı eligibility, human review | KEEP | Product Spec §8 ve §52 davranışını teknik olarak destekler. Açık tie-break ve değerlendirme alanları Product Spec'e aykırı olmayacak biçimde kararlaştırılır. |
| §4–6 ve §14'te Next.js + FastAPI + Supabase PostgreSQL + Redis + n8n + Nginx + Cloudflare + Sentry + Agents SDK'nın tümünü “sabit stack”/minimum Compose olarak zorunlu sayma | CHANGE | Stack uygulama adayıdır; pilot için gerekli bileşenler kanıtlanır. Sales DB ve güvenilir iş durumu şarttır; ayrı Redis/n8n/proxy ancak somut ihtiyaçta. Platform v1 gereksiz servis eklemez. |
| §6.4 `organizations`, users, memberships, roles ve her kayıtta `organization_id`'yi Sales DB otoritesi yapma | CHANGE | Sales-local tenant/auth ihtiyacı korunur; bu kayıtlar platform `Organization` otoritesi sayılmaz. Sales `Company` müşterinin prospect'idir. Yerel kök/isim/ID ilk Sales implementasyon kararıyla seçilir; Core kapısında `link, don't move` eşlemesi değerlendirilir (P0002/P0005). |
| §7.1 ve §12.1 Supabase Auth + organization membership + RLS'yi platform genel kimlik modeli gibi sabitleme | CHANGE | Supabase Auth ve RLS Sales-local provisional seçeneklerdir. Client tenant ID'si yetki değildir; server-side access şarttır. Ortak login/OIDC/üyelik kararı Core Phase 1 kapısında (P0001/P0005). |
| §12.1 user roles ve exact permission model açık ürün kararı | DEFER | Pilot erişimi dar tasarlanabilir; kesin rol/izin sözlüğü Product Spec §58 açık ürün kararıdır. Platform Membership, Sales içi iş yetkisi değildir. |
| §6.4–6.5 PostgreSQL authoritative state, Redis'in ephemeral olması ve pgvector'ın gerektikçe açılması | KEEP | Sales DB kendi domain otoritesidir. Redis zorunluluğu ayrıca ertelenir; varsa kaybı business state kaybettiremez. |
| §6.6, §7, §17 n8n'i workflow/connector koordinasyonu; domain state/policy'yi API'de tutma | KEEP | Sınır doğru. Pilot n8n kurulumunun kendisi DEFER: provider adapter/iş akışında ölçülmüş fayda görülene kadar kurulmaz. |
| §6.7–9, §12.3–12.4 task-class AI, allow-listed tools, sensitivity gate, LLM'e deterministik/uygunluk kararı vermeme | KEEP | Sales içinde kalır; Agents SDK ve ayrıntılı router policy uygulama seçeneği/ölçümle açılır. AI doğrudan diğer ürün DB'si veya tenant credential'ı kullanmaz. |
| §10 raw/normalized, fact/inference, versioning, data minimization | KEEP | Product Spec'in provenance, açıklanabilirlik ve compliance kuralını karşılar; Sales veri yaşam döngüsünün sahibidir. |
| §11 signed/versioned callback ve idempotent job/event kontratları | CHANGE | Sales içi işler ve gerçek ürünler arası entegrasyon ayrılır. Bugün ortak broker/contracts paketi yok; ilk gerçek çapraz ürün akışında P0006'nın dar API/webhook kontratı tasarlanır. |
| §12.2 genel “environment/secret store/n8n Credentials” secret modeli | CHANGE | Platform/provider secret'ı hazır manager'da ürün+ortam scoped injection hedefidir; tenant Google/Meta/CRM/WhatsApp token'ı Sales encrypted store ve opaque `credentialRef` ile kalır. n8n domain credential otoritesi olmaz (P0003). |
| §13 structured audit, cost/latency ve correlation | KEEP | Sales kendi iş/AI audit'inin sahibidir. Sensitive data/secret log'a çıkmaz; platform genel audit servisi kurulmaz. |
| §14 staging isolation'ı TBD bırakma | CHANGE | Dev/Staging/Prod **ayrı deployment, DB/erişim kimliği, storage, secret scope ve callback** hedefidir (P0004). Mevcut canlı Sales ortamı olduğu iddia edilmez; hosting/region/RPO sayıları açık kalır. |
| §15 unit/integration/e2e/AI eval/failure testleri | KEEP | Pilot §52 başarı sorusuna, tenant/credential izolasyonuna ve idempotent recovery'ye bağlanır. |
| §16 Phase A–E pilot akışı | CHANGE | A–E'nin prospecting sırası korunur; Supabase/Redis/n8n'i zorunlu kurulum olarak yazan maddeler çıkarılır. Pilot sonrası diğer Sales yetenekleri [aşama planına](AINETRA_SALES_PHASE_PLAN.md) alınır. |
| §16 Supabase project/migrations; §18'de schema authority ADR'si yok | DEFER | Ürün DB seçimi ve schema migration authority uygulama öncesi Sales kararıdır. Bu belge migration oluşturmaz; FINAL Platform v1'de Sales/Alembic zorunluluğu yoktur. |
| §19 provider/model, rate/retention, backup, observability ve operasyon eşikleri | DEFER | Sahip, ölçüm ve uygulama kararı gerekir; ürün spec'te model/sağlayıcı veya sayısal eşik icat edilmez. |

## Çapraz ürün sınırlarının sonucu

- Social organik content/publishing/creative planning yapar; Sales paid ads intelligence ile lead, opportunity, revenue ve growth'un sahibidir. Social'ın Meta token'ına Sales erişmez. İki gerçek tüketici aynı hesap bağlantısına ihtiyaç gösterirse Connection Hub ayrıca değerlendirilir.
- Serve/HotelOps kendi operasyon ve kalıcılık sınırlarını korur. Sales'e sonuç/rezervasyon/kapasite sinyali gerekiyorsa izinli API/event ile gelir; Sales diğer ürün DB'sine SQL yapmaz.
- Üçüncü/sonraki production ürün olarak Sales'in ortak tenancy/üyelik tekrarını doğurması **Core tetikleyici adayıdır**. Yalnız ürün sayısı veya pilot çalışması Core Phase 1'i başlatmaz; müşteri/problem kanıtı ve [Platform §8 kapısı](../../AINETRA_PLATFORM_ARCHITECTURE_V1.md) gerekir.

## Önerilen, henüz açılmayan Sales ADR'leri

| Aday | Açılma zamanı / karar sorusu |
|---|---|
| Sales-local tenant/auth ve gelecekteki Organization eşlemesi | Pilot kullanıcı/tenant sayısı ve Core gate kanıtı netleştiğinde; yerel kök, auth sağlayıcısı, rol sınırı, ID eşlemesi ve geri dönüş nasıl olacak? |
| Sales DB, migration authority ve güvenilir job teslimi | İlk implementasyon öncesi; hangi DB/şema geçmişi ve Redis olmadan hangi kalıcı job yolu? |
| Sales tenant credential şifreleme ve rotasyon | İlk müşteri OAuth/CRM/WhatsApp credential'ı alınmadan önce; `credentialRef`, anahtar sürümü, tenant bağlamı ve restore nasıl doğrulanacak? |
| Sales–Serve/HotelOps ticari sonuç contract'ı | İlk gerçek çapraz ürün veri akışında; sinyalin sahibi, izin, idempotency, gecikme ve silme sınırı nedir? |
| Sales ads read/write izin ve approval uygulama sınırı | Advertising Manager uygulama aşamasında; read-only başlangıçtan execute'a geçiş nasıl kapılanacak? |

ADR dosyası açılmadı. Bu adaylar APPROVED Product Spec'te bulunmayan ürün davranışı kararı veremez.
