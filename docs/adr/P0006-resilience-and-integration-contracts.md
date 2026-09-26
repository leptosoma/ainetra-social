# ADR-P0006 — Core bağımsız ana akış ve ihtiyaçla entegrasyon

- Tarih: 2026-09-26
- Durum: Kabul edilen v1 hedefi; kesinti testi çalıştırılmadı
- Referans: Claude I/J/L.3; Gemini I/J; Social S08–S09

## Bağlam

Serve misafir operasyonu yeni merkezi platformun erişilebilirliğine bağlanmamalı. Serve zaten yerel tenant/abonelik kararına, sipariş ve servis talebi event/outbox tablolarına sahip. Social'ın PostgreSQL publishing worker'ı ayrı ürün sorumluluğudur. HotelOps'un Telegram/WhatsApp/Zammad akışı da yeni platform bağımlılığı istemez; webhook sonrası işleme bugün kalıcı outbox değildir.

## Karar

Hiçbir ürünün ana iş akışı veya boot'u **yeni** Core/Control'a senkron istek gerektirmez. Bu kural DB, HotelOps Zammad/JSON, geçerli yerel config veya gerekli provider bağımlılığını ortadan kaldırmaz. Serve'in bugünkü paket/abonelik/entitlement kararı kendi DB'sinde uygulanır ve pasif abonelikte kapalıdır. Core kesintisi bu kararı ne açar ne de topluca kapatır. Gelecekte Core yalnız çapraz ürün aktivasyonu için sürümlü yerel projection sağlarsa bu yeni katman Serve'in etkili hak kararını geçersiz kılamaz. Serve'e bağlanan yeni snapshot/cutover ayrı güvenlik ve kesinti ADR'si gerektirir.

Admin/üyelik iptali gibi güvenlik kararları ticari grace'e tabi değildir. Serve'in pasif abonelik kuralına genel fail-open da eklenmez. İptal olayı ve kısa güncellik sınırı ancak yeni entegrasyon tasarlanırken tanımlanır; kritik işlem gerekli doğrulama olmadan açılmaz. Tam süreler uygulama görevinde sorumlu ve kesinti bütçesiyle belirlenir. Core DB'nin tam yedeği yerel projection değildir.

Bugün broker veya contracts paketi eklenmez. Serve `order_outbox_events` ve `notification_outbox_events` ile Social `PublishIntent` ürün içi doğruluk/teslim sınırlarıdır; genel platform bus'ına dönüştürülmez. HotelOps'un `BackgroundTasks` ve JSON dedupe yolu aynı teslim garantisini vermez; ürün içi kalıcı retry ihtiyacı ayrı değerlendirilir. İlk gerçek dayanıklı cross-product akışta ürünün mevcut outbox'ını bozmayan ayrı imzalı HTTP webhook sınırı düşünülebilir. Event ID/schema version/tenant bağlamı, audience/scope, replay koruması, idempotency, sıralama/sürüm denetimi, bounded retry ve hata kuyruğu gerekir. İkinci gerçek tüketicide yalnızca şema/tip içeren semver paketi değerlendirilebilir.

## Alternatifler

Her publish/guest isteğinde Core auth/secret/entitlement çağrısı reddedildi. Evrensel fail-open reddedildi: ticari süreklilik güvenlik iptalini geçersiz kılamaz. Şimdiden Redis/RabbitMQ/Kafka veya Social PublishIntent'i genel bus yapmak reddedildi: kanıtlanmış tüketici/hacim yok.

## Sonuç ve gelecek doğrulama

Yeni projection kullanılırsa uzlaşma ve gecikme görünürlüğü gerekir. Core kapalıyken Social worker, Serve'in yerel menü/sipariş/servis talebi/entitlement akışları ve HotelOps bot/webhook/Zammad yolları sınanır; yeni login/aktivasyon, güvenlik iptali ve snapshot yokluğu ayrı test edilir. Serve kaynakları AI olmadan klasik menü ve ticari olarak açık operasyonu hedefliyor; canlı kesinti deneyi bu çalışmada yapılmadı.

Yeniden değerlendirme: ölçülmüş webhook kapasite/teslim sorunu veya ikinci tüketici. Görevler: P0-08, P0-10, P0-12.
