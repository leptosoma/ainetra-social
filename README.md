# Ainetra Social

Ainetra Social; otel, restoran ve yerel işletmelerin sosyal medya içeriklerini marka bağlamıyla oluşturmasına, sürüm bazlı onaylamasına ve yayına hazırlamasına temel sağlayan çok kiracılı (multi-tenant) bir SaaS uygulamasıdır.

Bu repository Phase 1 production foundation üzerine kurulu **Phase 2 Ainetra Business Brain** uygulamasını içerir. Claude Artifact içinde bulunan ilk prototipten bağımsızdır; prototipin dosyalarını kullanmaz veya değiştirmez.

## Stack

- **Next.js 16 + React 19 + TypeScript:** yaygın, sürdürülebilir ve aynı repository içinde sunucu/arayüz geliştirmeye uygun.
- **PostgreSQL 17 + Prisma 7:** ilişkisel iş kuralları, migration ve tip güvenli sorgular için.
- **Zod:** tüm dış girdilerde sunucu tarafı şema doğrulaması için.
- **bcryptjs + opaque database sessions:** harici auth sağlayıcısına kilitlenmeden güvenli parola özeti ve HttpOnly oturum çerezi için.
- **Local storage adapter + Sharp:** geliştirmede güvenli görsel doğrulama ve dosya depolama; ileride S3/R2 adapter’ına geçilebilir.
- **Vitest:** gerçek PostgreSQL üzerinde kritik domain/integration testleri için.

## Local setup

Gereksinimler: Node.js 24+, npm ve Docker Desktop.

```bash
cp .env.example .env
npm install
docker compose up -d db
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

Uygulamayı `http://localhost:3001` adresinde açın.

Geliştirme hesabı:

- E-posta: `owner@mimoza.test`
- Parola: `Ainetra123!`

Seed komutu idempotenttir. Demo kullanıcının bir işletmesi zaten varsa mevcut kayıtları değiştirmez.

## Environment variables

| Değişken | Amaç |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantı adresi |
| `SESSION_SECRET` | Gelecekteki imzalı token/crypto işlemleri için sunucu sırrı; üretimde en az 32 rastgele karakter kullanın |
| `LOCAL_STORAGE_ROOT` | Development dosya adapter’ının kök klasörü |
| `MAX_UPLOAD_BYTES` | Tek görsel için byte sınırı; varsayılan 8 MB |
| `BUSINESS_BRAIN_API_URL` | İsteğe bağlı, JSON döndüren text AI provider endpoint'i |
| `BUSINESS_BRAIN_API_KEY` | İsteğe bağlı provider anahtarı; yalnızca sunucuda okunur |
| `BUSINESS_BRAIN_MODEL` | İsteğe bağlı provider model kimliği |

`.env` ve `.env.test` Git’e eklenmez. Gerçek secret veya sosyal medya token’ı istemciye gönderilmez.

## Database

Şema `prisma/schema.prisma`, migration dosyaları `prisma/migrations` altındadır.

```bash
npm run db:migrate -- --name change_name   # geliştirme migration'ı
npm run db:deploy                          # mevcut migration'ları uygular
npm run db:seed                            # Mimoza demo verisi
```

Docker Compose iki database oluşturur:

- `ainetra_social`: yerel uygulama
- `ainetra_social_test`: otomatik testler

## Tests

```bash
npm test
```

Komut önce migration’ları `ainetra_social_test` veritabanına uygular, sonra domain testlerini seri biçimde çalıştırır. Test temizliği yalnızca `.env.test` içindeki test veritabanında yapılır.

Kapsanan kritik kurallar:

1. Başka işletmenin kaydı değiştirilemez.
2. En fazla bir PRIMARY hedef olabilir.
3. En fazla iki SECONDARY hedef olabilir.
4. İçerik sürümü değiştiğinde eski onay geçersizdir.
5. Onaylanan sürümden farklı sürüm planlanamaz.
6. İçerik değişince eski plan yayınlanabilir değildir.
7. Geçmiş tarih planlanamaz.
8. Başka işletmenin medyası içerik varyantına bağlanamaz.
9. Export, published durumu veya publish attempt oluşturmaz.
10. Başka işletmenin sosyal hesabıyla planlama yapılamaz.

Business Brain testleri ayrıca şunları doğrular:

- `NEEDS_CONFIRMATION` ve `REJECTED` bilgiler canonical bağlama girmez; yalnızca onaylı kayıtlar girer.
- Tenant dışı Business Brain okuma ve değiştirme reddedilir.
- Geçersiz provider çıktısı attribute yazmadan `INVALID_OUTPUT` olur.
- Öneri kabul ve ret geçişleri ile mevcut hedef sınırları korunur.
- Local/private web adresleri reddedilir ve web sitesi hatası onboarding akışını durdurmaz.
- Yeniden analiz, kullanıcı tarafından onaylanmış veriyi değiştirmez; farklı sonuç ayrı öneri olur.

## Architecture overview

```text
src/
  app/                 Next.js routes, layouts and server-rendered UI
  actions/             Form mutations; authentication and revalidation
  components/          Shared presentation components
  features/
    auth/               Password and opaque session services
    business/           Business + BrandProfile validation/services
    goals/              PRIMARY/SECONDARY invariants
    media/              Upload validation and asset lifecycle
    content/            Content/variant creation, versioning, export
    approval/           Version-aware approvals
    publishing/         Schedule validation and publishability checks
    business-brain/     Website reader, prompt, provider boundary, verification ledger ve canonical context
  lib/
    authorization.ts    Membership-based tenant boundary
    db.ts               Prisma/PostgreSQL adapter
    storage/            Replaceable object storage boundary + local adapter
  test/                 PostgreSQL-backed domain tests
prisma/
  schema.prisma         Domain model
  seed.ts               Development demo workspace
```

Presentation, domain services, persistence and provider adapters ayrı tutulur. Her mutation, kullanıcı üyeliğini sunucuda doğrular. `businessId` istemciden gelse bile yetki kaynağı olarak kabul edilmez.

### Version-aware workflow

- `ContentItem` fikir düzeyini, `ContentVariant` platform çıktısını temsil eder.
- Caption, CTA, medya, dil veya format değişince varyant sürümü artar.
- `Approval.approvedVersion` yalnızca eşleşen varyant sürümü için geçerlidir.
- Düzenleme sırasında mevcut `SCHEDULED` kayıtlar aynı transaction içinde `INVALIDATED` yapılır.
- Planlama; güncel onay, gelecek tarih, doğru işletmeye ait hesap ve doğru sürüm şartlarını sunucuda doğrular.
- Export yalnızca `exportedAt/exportedVersion` alanlarını günceller; yayınlama durumuna dokunmaz.

### File storage

PostgreSQL içinde dosya blob’u tutulmaz. Veritabanında yalnızca metadata ve `storageKey` bulunur. `StorageProvider` sınırı, geliştirmedeki local adapter yerine daha sonra S3, R2 veya başka bir object storage adapter’ı eklemeye uygundur.

## CURRENTLY IMPLEMENTED

- Sign up, sign in, sign out ve güvenli HttpOnly session
- User / Business / Membership (OWNER, MEMBER) multi-tenant foundation
- İşletme oluşturma ve düzenleme
- Brand Profile, çok boyutlu tone verisi ve iş hedefleri
- Local object storage adapter; JPEG/PNG/WebP MIME, içerik, boyut ve güvenli key doğrulaması
- Medya yükleme, yetkili preview ve kullanılmayan medyayı silme
- ContentItem + platform ContentVariant oluşturma/düzenleme
- Version-aware approval ve schedule invalidation
- Dummy sosyal hesapla planlama modeli
- Dashboard, Content, Calendar, Media, Brand ve Settings ekranları
- Mimoza Bodrum Restaurant development seed’i
- PostgreSQL-backed domain/integration testleri
- PublishAttempt, PostPerformance ve AIInsight için minimum genişleme noktaları
- Business Brain onboarding ve “İşletmeni böyle anladım” doğrulama ekranı
- Alan bazında source, confidence ve CONFIRMED / INFERRED / NEEDS_CONFIRMATION / REJECTED durumları
- Accept, edit, reject ve eksik bilgi ekleme akışları
- Analiz provider/model/prompt version ve kaynak metadata geçmişi
- `buildBusinessContext(userId, businessId)` ile yalnızca kullanıcı verisi ve onaylı attribute'lardan güvenilir bağlam
- SSRF korumalı web okuma: private IP engeli, DNS çözümleme kontrolü, yönlendirme kontrolü, timeout ve boyut sınırı
- Beş eksenli marka kişiliği ve kullanıcı onaylı hedef önerileri

## NOT IMPLEMENTED YET

- AI Content Planning
- Capture Engine
- Fallback Engine
- Visual Intelligence / image enhancement
- Gerçek Instagram OAuth ve publishing
- Gerçek Facebook OAuth ve publishing
- TikTok entegrasyonu
- Gerçek platform analytics
- Learning Engine
- Background publishing worker / retry orchestration
- Gelişmiş ekip, rol ve onay akışları

Bu maddeler UI’da gerçek özellik gibi gösterilmez. Dummy sosyal hesap yalnızca Phase 1 iş akışını test etmek içindir.

## Business Brain provider davranışı

Uygulama kodu provider'a bağlı değildir. `BusinessBrainExtractionProvider` sınırı, doğrulanmış `business-brain-v1` JSON sözleşmesi döndürür. Provider ayarları yoksa çalışan geliştirme sürümü `local / grounded-heuristic-v1` kullanır; bu adapter yalnızca güvenli şekilde önceden alınmış web metnindeki açık sinyalleri çıkarır, kişilik/hedef gibi AI inference üretmez ve belirsiz alanları onaya bırakır. Üç provider environment değeri birlikte verildiğinde server-side HTTP JSON adapter devreye girer.

Canonical context'te aynı kavram hem eski `BrandProfile` alanında hem doğrulama defterinde bulunursa, kullanıcının açıkça onayladığı canonical ledger değeri önceliklidir. Böylece sonraki modüller iki çelişkili açıklama veya hedef kitle değeri görmez.

Web sitesi içeriği dış ve güvenilmez veri olarak prompt içinde ayrı sınırlandırılır. Modelin URL çağırmasına izin verilmez; kaynakları yalnızca backend getirir. Şema dışı çıktı, kanıtsız website değeri ve factual alanlardaki temelsiz AI inference kalıcı işletme verisine yazılmaz.

## Production notes

Canlıya çıkmadan önce PostgreSQL ve object storage yönetilen altyapıya taşınmalı, `SESSION_SECRET` güçlü bir değerle değiştirilmeli, HTTPS zorunlu olmalı ve gerçek provider credential’ları yalnızca sunucu tarafı secret store’da tutulmalıdır. Gerçek yayınlama eklendiğinde `SocialPublisher` adapter sınırı ile platform kodu domain servislerinden ayrılmalıdır.

### Zamanlanmış yayın worker'ı (P6-04)

Zamanı gelmiş, onaylı Instagram/Facebook gönderileri web sürecinden **ayrı** bir süreçte yayınlanır:

```bash
npm run db:deploy          # migration'lar worker'dan önce
npm run worker:publishing  # node --conditions=react-server --import tsx ./scripts/publishing-worker.ts
```

- Aynı dağıtılmış kod, aynı PostgreSQL ve aynı özel medya deposu kullanılır; `generated/prisma` build sırasında `npm run db:generate` ile üretilmiş olmalıdır. Worker'ın genel bir dinleyicisi yoktur, ancak Instagram imzalı medya URL'si için web uygulaması `PUBLIC_APP_URL` üzerinden HTTPS ile erişilebilir olmalıdır.
- Gerekli ortam değişkenleri (dağıtım secret deposundan; `.env` okunmaz): `DATABASE_URL`, `LOCAL_STORAGE_ROOT`, `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_GRAPH_API_VERSION`, `META_CREDENTIAL_KEY`, `META_CREDENTIAL_KEY_ID` (rotasyonda `META_CREDENTIAL_PREVIOUS_KEYS`), `PUBLIC_APP_URL`, `MEDIA_DELIVERY_SECRET`. İsteğe bağlı: `PUBLISHING_WORKER_INTERVAL_MS`, `PUBLISHING_WORKER_BATCH_SIZE`, `PUBLISHING_WORKER_CONCURRENCY`, `PUBLISHING_WORKER_SHUTDOWN_TIMEOUT_MS`.
- Birden fazla worker örneği güvenle çalışabilir; tek talep otoritesi PostgreSQL'deki kısa Serializable CAS talebidir. SIGTERM/SIGINT yeni talebi durdurur, aktif çağrıları sınırlı süre bekler. Loglar stdout'a redakte JSON olarak yazılır.
- Belirsiz sonuçlar (`UNKNOWN`) otomatik yeniden gönderilmez; mutabakat P6-05'tir. Canlı Meta yayını henüz doğrulanmadı.
