# Ainetra Sales — ürün konumu

**Durum:** Mimari konumlandırma taslağı · 26 Eylül 2026  
**Ürün davranışı için yetkili kaynak:** Kullanıcının sağladığı `00_PRODUCT_SPEC.md`, v1.1, **APPROVED** (25 Ağustos 2026). Bu belge onu değiştirmez veya yeniden onaylamaz.

## Adlandırma ve kapsam

Product Spec'teki eski **AINETRA** adı, yeni ürün ailesinde **Ainetra Sales** ürününü ifade eder. Belgedeki “Growth & Sales Platform”, sektör bağımsız çekirdek ve sektör paketleri Sales'in ürün içi yetenek/vizyon anlatımıdır; bugünkü veya gelecekteki Ainetra **platform/Core** servisine sahiplik vermez. Approved metin, bölüm numaraları, guardrail'ler, açık ürün kararları ve ilk pilot sınırı aynen geçerlidir. Kaynak dosya yeniden adlandırılmaz veya içerik olarak değiştirilmez.

Sales; AI Prospecting Engine, AI Advertising Manager ve AI Sales Agent'ı FIND → ATTRACT → ENGAGE → CONVERT → LEARN → OPTIMIZE döngüsünde; PROTECT ve REACTIVATE ile birlikte sunar. Prospect, Contact, Lead, Conversation, Opportunity, Offer, Campaign, Attribution, Revenue, Reactivation, Leakage Protection, Advertising Intelligence, Sales Agent state ve outreach/compliance state Sales domain'ine aittir. Bu ürün yetenekleri ilk pilotun tamamına girmez; zamanlama [Sales aşama planında](AINETRA_SALES_PHASE_PLAN.md) Product Spec §52 ile sınırlanır.

APPROVED belgedeki B2B/B2C edinim, human handoff, işlem/ödeme yetenek seviyeleri, bilgi sistemi, sektör paketleri, dashboard, müşteri veri sahipliği/portability, self-service SaaS ve uzun vadeli ticari vizyon da Sales ürün tanımı olarak korunur. Bu konumlandırma onların pilotta uygulanacağını söylemez; Product Spec'teki statü ve açık kararlar geçerlidir.

## Ürün ailesindeki sınırlar

| Sınır | Sahiplik |
|---|---|
| Platform `Organization` | Ainetra'nın ödeme yapan müşterisi ve gelecekteki ortak ticari/üyelik sınırı. Sales `Company` ile aynı varlık değildir. |
| Sales `Company` | Ainetra müşterisinin müşterisi veya prospect işletmesi; Sales verisidir. |
| Social | Organik içerik, creative planning ve publishing; Social verisi/Meta token'ı yerinde kalır. |
| Sales | Paid ads intelligence, prospect/lead, opportunity, satış ve gelir/growth kararları; kendi verisi ve tenant credential'ları yerinde kalır. |
| Serve / HotelOps | Restoran veya otel operasyonunun sahibi. Sales'e gerektiğinde izinli API/event üzerinden ticari sonuç ya da rezervasyon/operasyon sinyali verebilir; operasyon verisinin sahibi değişmez. |
| Core / Control | Core runtime bugün yoktur. İleride dar Organization/üyelik/aktivasyon kararı doğabilir; Control gelecekte staff-only konsoldur. Sales davranışı veya credential deposu buralara taşınmaz. |

Aynı Meta bağlantısının Social ve Sales tarafından gerçekten tüketilmesi kanıtlanırsa Connection Hub için ayrı karar açılır; bugün böyle bir servis veya ortak token erişimi kurulmaz.

## Belge yetki sırası

1. Sales ürün davranışı, guardrail ve pilot sınırı: APPROVED `00_PRODUCT_SPEC.md` v1.1.
2. Platform sınırı: [FINAL Platform Architecture v1](../../AINETRA_PLATFORM_ARCHITECTURE_V1.md) ve [platform ADR'leri](../../adr/README.md).
3. Sales teknik uygulama önerisi: [Sales Architecture v1](AINETRA_SALES_ARCHITECTURE_V1.md). Taslaktır; ürün davranışını değiştiremez.
4. Eski `02_TECHNICAL_ARCHITECTURE_DRAFT.md`: [uyum incelemesinde](AINETRA_SALES_COMPATIBILITY_REVIEW.md) KEEP / CHANGE / DEFER olarak ele alınan tarihsel teknik taslak.

Kaynak `00_PRODUCT_SPEC.md` ve `02_TECHNICAL_ARCHITECTURE_DRAFT.md` bu Social reposunda bulunmayan, kullanıcının yüklediği belgelerdir. Bu klasör onların onaylı kopyası olduğu iddiasında bulunmaz. Teknik karar ürün davranışına yeni kural eklemeyi gerektirirse Product Spec §62'deki karar süreci izlenir.
