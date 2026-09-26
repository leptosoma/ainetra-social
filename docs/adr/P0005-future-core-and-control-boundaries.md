# ADR-P0005 — Gelecekte dar Core ve staff Control

- Tarih: 2026-09-26
- Durum: Kabul edilen v1 sınırı; Core/Control henüz uygulanmadı
- Referans: Claude D/E/H/L; Gemini E/H

## Bağlam

Ürün Business kavramlarını birleştirmek yerine ticari organizasyon ve platform üyeliğini ayırmak gerekiyor. Serve'de `tenants`, `branches`, platform/tenant roller, abonelik, paket, feature override ve Super Admin aynı ürün reposunda somut olarak var. HotelOps'ta oda/Zammad bileti ürün domain'idir. Ayrı aktif Control repo/deployment'ı bulunmadı.

## Karar

Core tetiklenirse kapsamı Organization, IdP subject bağlantısı, org Membership/platform rolleri, ürünler arası Product Activation ve ticari Plan/Entitlement sınırı olur. Bu, Serve'in bugün `subscriptions`/`plan_features`/`tenant_feature_overrides` ile verdiği **etkili ürün hakkını** kendiliğinden devralmaz. Önce Core yalnız çapraz ürün ticari bağın kaydını tutabilir; Serve kararı lokal kalır. Hak cutover'ı ayrı ADR, mevcut karar sırası karşılaştırması, güvenlik ve geri dönüş gerektirir. Core kendi audit'ini ve gerekirse değişiklik dağıtımı için outbox'ını tutar. Parola/MFA için hazır IdP değerlendirilir; mevcut auth bugün taşınmaz.

Ürün rolleri, Social onay/yayın yetkisi, Serve personel/device/guest session, HotelOps admin/Telegram kullanıcı eşlemeleri ve domain verileri üründe kalır. Core Organization, üründeki restaurant/brand/oda değildir. Entitlement ticari hak, feature flag teknik rollout, setting tenant tercihidir; ayrı modeller/sorumluluklar olarak ele alınır.

Control hedefi gelecekte staff-only platform admin yüzeyidir; somut ihtiyaç doğarsa Core komutlarını sunabilir. Serve'in mevcut Super Admin ve tenant yönetim ekran/route'ları şimdi taşınmaz. Müşteri portalı ayrı sorumluluktur. Staff erişimi MFA/SSO ve ağ kısıtlarıyla planlanır; mevcut durumda varlığı iddia edilmez. Control platform secret vault veya API/AI proxy'si olmaz.

## Alternatifler

Core'a Business Brain, Location, bütün audit/usage/retention ve provider registry koymak reddedildi: domain sahipliği ve kapsam aşımı. Control'u şimdi geliştirmek veya Serve Super Admin'i ona taşımak reddedildi: ayrı aktif Control repo'su yok ve çalışan Serve yapısını değiştirme gereği yok. Gelecekte aynı deployable mümkün, zorunlu değil.

## Sonuç ve kapı

Core sadece eşlenen org'ların platform verisine otorite olur; Serve `tenants.id`, şube ve mevcut etkili entitlement yolu yerel korunur. HotelOps otel eşleme kökü kanıtlanmadan Organization'a bağlanmaz. Hazır IdP sağlayıcısı, rol ayrıntıları, üyelik iptal süresi, kesinti politikası ve repo/deployment seçimi ayrı görevde doğrulanır. Serve paket/abonelik kararı Core veya Control kesintisinden etkilenmez; pasif aboneliği genel grace ile açık hale getirmek mevcut davranışa aykırıdır. Bunlar çözülmeden Core uygulama işi READY sayılmaz.

Görevler: P0-01, P0-09, P0-12; [Core tetikleyicileri](../AINETRA_PLATFORM_ARCHITECTURE_V1.md).
