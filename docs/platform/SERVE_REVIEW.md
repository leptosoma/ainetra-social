# Serve kaynak incelemesi ve Architecture v1 uyum kaydı

26 Eylül 2026 · Kaynak: `C:\Users\admin\Documents\Codex\Ops` · Git SHA `24c1d79ce715993d953d4808ee48ac357109ccb4`.

Bu inceleme salt okunur yapıldı. Ops reposunda önceden bulunan, izlenmeyen `references/` klasörüne dokunulmadı. Migration, kod, veri, çalışan konteyner ve deployment değişmedi. Kaynak ve migration okuması gerçek üretim/staging davranış testi değildir. Aşağıdaki kaynak yolları `C:\Users\admin\Documents\Codex\Ops` köküne göredir.

## Gerçek yapı

| Konu | Kaynak kanıtı | Mimari sonuç |
|---|---|---|
| Ürün ve domain | `docs/00-master-product-spec.md`, `docs/01-products-and-scope.md`, `apps/api/src/db/migrations/0011_order_core.sql`, `0013_service_request_operations.sql` | Serve QR menü, içerik, şube, masa/kaynak, sipariş ve servis talebini yönetir. Sipariş ile servis talebi ayrı aggregate; başka ürüne taşınmaz. NFC ses kanalı planlıdır; canlı özellik sayılmaz. |
| Tenant kökü | `0001_core.sql`: `tenants.id uuid`, `branches(tenant_id,id)`; `docs/04-multi-tenant-architecture.md` | `tenant_id` mantıksal güvenlik sınırı, `branch` tenant içi birimdir. Serve için org eşlemesi şubeye/outlet'e otomatik yazılmaz. |
| İzolasyon | `0001_core.sql`, `0006_public_guest_sessions.sql`: tenant FK + RLS; `apps/api/src/db/context.ts` | Mevcut `tenant_id` filtresi, RLS, composite FK ve tenant bağlamı korunur. Tüm tablolara `org_id` ekleme kararı yok. |
| Ürün DB'si | `apps/api/src/db/router.ts`, `docs/17-deployment-models.md` | Serve runtime/migration rotasını `DatabaseRouter` çözer. Shared SaaS'ta birçok Serve tenant'ı aynı RLS DB'sini kullanabilir; dedicated/on-premise farklı rota kullanabilir. “Her tenant'a ayrı DB” doğru değildir. Ayrı tutulacak sınır Social ile ürün DB erişimidir; bugünkü canlı topoloji ayrıca doğrulanmalı. |
| Personel auth | `apps/api/src/modules/auth/auth.service.ts`, `0003_runtime_foundations.sql`, `docs/10-authentication-and-roles.md` | JWT cookie + DB `auth_sessions`, iptal ve tenant üyeliği/rolü vardır. Ortak IdP'ye geçiş mevcut session'ı değiştirecek ayrı karardır. |
| Misafir auth | `apps/api/src/modules/public-experience/public-guest-session.service.ts`, `0006_public_guest_sessions.sql` | QR ile bulunan tenant/kaynak ve hash'li opaque cookie token'ı exact guest session'a bağlanır. Core login veya org üyeliğine bağlanamaz. |
| Entitlement | `0001_core.sql` (`plans`, `plan_features`, `subscriptions`), `0003_runtime_foundations.sql` (`tenant_feature_overrides`), `apps/api/src/modules/entitlements/entitlement.service.ts` | Serve, paket/override/global default ve aktif aboneliği sunucu tarafında çözüyor. Pasif abonelikte özellik kapalıdır. Core kesintisi adına genel “fail-open/grace” mevcut davranışı değiştiremez. |
| AI secret | `0005_ai_configuration.sql`, `apps/api/src/plugins/secret-store.ts`, `apps/api/src/security/secret-store.ts`, `secret-rotation.service.ts`, `apps/api/src/modules/ai/ai.service.ts` | Platform ve tenant AI API anahtarları bugün Serve DB'sindeki `encrypted_secrets` içinde şifreli; sürümlü AES-GCM keyring deployment env'inden gelir. Tenant BYOK Serve'de kalır. Hazır manager hedefi, bu tabloyu hemen kaldırma veya formatını değiştirme emri değildir. |
| Config ve connector | `apps/api/src/config/env.ts`, `apps/api/src/plugins/connectors.ts`, `apps/api/src/connectors/registry.ts`, `0003_runtime_foundations.sql` | Deployment değerleri env/profile; tenant provider seçimi ve ayarları DB'de. Connector registry/runtime **Serve'in içindedir**; ayrı Core servisi değildir. AI Gateway, limit ve devre kesiciyle yerel çalışır. Redis varsa devre durumu Redis'te, yoksa Postgres'tedir. |
| Event/entegrasyon | `apps/api/src/db/order-schema.ts` (`order_outbox_events`), `service-request-schema.ts` (`service_request_events`, `notification_outbox_events`), `docs/adr/ADR-009*`, `ADR-010*` | Serve'in kendi event/outbox sınırları zaten vardır. Bunlar genel platform broker'ına taşınmaz; gelecekteki ürünler arası sözleşme mevcut event şemasını sessizce yeniden adlandırmaz. |
| Yönetim UI | `apps/web/components/admin-shell.tsx`, `apps/web/components/tenant-management.tsx`, `apps/api/src/modules/admin/*` | Serve repo'sunda gerçek Super Admin ve tenant yönetimi var. Bu, ayrı `ainetra-control` uygulamasının koduyla aynı şey olduğunu kanıtlamaz. Serve yönetim uçları gelecekte Control için sökülmez. |

## Taslaktaki uyumsuz öneriler ve düzeltme

| Önceki ifade/örtük varsayım | Serve için risk | v1 düzeltmesi |
|---|---|---|
| `Serve restaurant/outlet` doğrudan org'a eşlenir | Gerçek kök `tenants.id`; `branch` tenant altında. Yanlış granülarite ve ilişki kurulur. | Eşleme adayı **Serve `tenants.id`**; branch/resources/QR/session kendi tenant ilişkisiyle kalır. Aynı ticari org'un kaç Serve tenant'ı olacağı ayrıca elle kararlaştırılır. |
| Gelecek Core Plan/Entitlement doğrudan kaynak; Serve sadece snapshot | Mevcut `subscriptions`, `plan_features`, override ve fail-closed karar yolu devre dışı kalır. | Phase 0 ve Core ilk dağıtımında Serve etkili entitlement kaynağıdır. Core yalnız ürünler arası ticari hak/aktivasyon için adaydır; Serve'e etki eden cutover ayrı ADR, veri eşlemesi, çift okuma doğrulaması ve geri dönüş ister. |
| Platform provider secret'ları bugün yalnız hazır manager'da | Serve platform AI key'leri `encrypted_secrets` içinde mevcut. Sırları silmek AI çağrılarını kırar. | Mevcut kayıtlar Serve'de kalır. Hazır manager'da önce deployment keyring/bootstrap yönetimi; platform AI key'lerinin ileride dışarı alınması ayrı, geri alınabilir tasarım konusudur. BYOK Serve'de kalır. |
| Secret manager kesilirse Serve her koşulda çalışır | Cold start/keyring eksikliğinde API açılışı veya AI çözümlemesi başarısız olabilir. | Manager entegrasyonu yapılmadan bu garanti verilmez. Statik menü/sipariş/servis talebi için Core ve AI bağımsızlığı; DB ve gerekli bootstrap bağımlılıkları açıkça ayrı. |
| “Ticari grace” varsayılan olarak Serve'i açık tutar | Mevcut kod pasif abonelikte hakları kapatır. | Genel fail-open yok. Kesinti davranışı ancak mevcut entitlement semantiği ve ölçülmüş kesinti gereğiyle ayrı karara bağlanır. |
| Serve'e ayrıca RLS/`org_id` ekle | Mevcut UUID tenant/RLS/composite FK'leriyle çakışan büyük migration. | Mevcut tenant izolasyonu korunur; platform org yalnız dış eşleme kimliğidir. |
| Control geldiğinde Serve Super Admin/tenant paneli taşınır | Aktif yönetim yolları ve izinler bozulur. | Serve içi yönetim yerinde; ayrı aktif Control repo'su yok. Gelecek staff-only yüzeyin API sınırı ihtiyaç doğarsa tasarlanır. |
| Yeni event altyapısı Serve outbox'ını ikame eder | Sipariş ve servis talebi teslim semantiği değişir. | Mevcut outbox/event'ler Serve içi kaynak olarak kalır; ürünler arası bridge gerekirse ayrı tasarlanır. |

## `platform_org_id` uyumu

Bugün Serve'de `platform_org_id` / `organization_id` alanı bulunmadı. Bu bir eksiklik veya hemen migration sebebi değildir. Gelecekte bağlama gerekirse `Core Organization ↔ (product='serve', deployment, Serve tenants.id)` biçiminde harici eşleme ilk adaydır. Serve tarafında nullable referans mı yoksa ayrı eşleme tablosu mu seçileceği, shared/dedicated/on-premise rota ve bir org'un birden fazla Serve tenant'ı olasılığı değerlendirildikten sonra kararlaştırılır. `branch`, `service_resources`, QR, guest session, order, service request ve auth session ID'leri değişmez; Core DB'ye foreign key veya Serve operasyon yoluna senkron Core çağrısı eklenmez.

## Kanıt sınırı ve açık işler

Repo kaynakları ve migration'lar incelendi; üretim DB izinleri, çalışan staging/prod topolojisi, gerçek sağlayıcı secret'ları veya tam kesinti testi yapılmadı. `PROJECT_STATUS.md` en güncel kayıtlarında QR Menü v1 için bağımsız kabul incelemesinin beklediğini ve production/staging'in incelenmediğini belirtiyor. Özellikleri “prod doğrulandı” diye sunmuyoruz. Ayrı aktif Control repo'su bulunmadı; Serve içi Super Admin gelecekteki Control yerine geçmez.
