# ADR-P0002 — Ürün sahipliği ve link, don't move

- Tarih: 2026-09-26
- Durum: Kabul edilen v1 mimari kararı; şema değişikliği yok
- Referans: Claude F/H/K; Gemini F/K; Social S01–S06

## Bağlam

Social Business, Serve `tenants.id`, onun altındaki `branches` ve HotelOps oda/bilet kavramları aynı semantiğe sahip değildir. Social `cuid`, Serve tenant UUID kullanır. Serve'in tenant/RLS/composite FK yapısı `Ops` kaynaklarında doğrulandı. HotelOps'ta Zammad biletleri ve yerel JSON durumu vardır; ayrı ilişkisel DB veya genel hotel tenant ID'si doğrulanmadı.

## Karar

Social ve Serve domain verileri kendi ürün DB sınırlarında, HotelOps bileti Zammad ve durum dosyaları HotelOps entegrasyon sınırında kalır. Serve shared deployment'ında birden çok tenant tek RLS DB rotasında olabilir; bu ürünler arası DB paylaşımı değildir. İleride Organization ticari/org üyelik sınırıdır. Serve `tenants.id` → org ilişkisi N:1 olabilir; branch org eşleme kökü değildir. HotelOps için önce güvenilir yerel hotel/tenant anahtarı belirlenir; oda veya bilet ID'si otomatik org anahtarı olmaz. Mevcut ID'ler korunur; yeni Core Organization için UUIDv7 hedefi mevcut ürünleri dönüştürme yükümlülüğü yaratmaz. Ürünler arası referans environment/product/deployment-route/local ID ile isimlendirilir.

Gelecekte Serve `tenants` kökünde nullable `platform_org_id` veya ayrı eşleme tablosu additive görevle değerlendirilebilir; shared/dedicated/on-premise rotaları dikkate alınır. Cross-DB FK veya doğrudan SQL yok. Bugün kolon, index, ORM/RLS dönüşümü veya migration dosyası yazılmaz. Tenant kontrolü mevcut server-side üyelik, Serve `tenant_id` ve RLS üzerinden sürer.

## Alternatifler

Ortak Business tablosuna taşıma reddedildi: veri anlamı, Serve operasyonu ve HotelOps bilet/oda akışı bozulabilir. Tüm tablo ID'lerini UUID yapmak reddedildi: gereksiz ilişki/URL/credential AAD riski. Login'de ad/e-posta ile lazy merge reddedildi: sessiz yanlış eşleme ve belirsiz dual-path.

## Gelecek geçiş ve geri dönüş

Gerçek müşteri/demo ayrımı, insan onaylı mapping, dry-run ve tenant bazlı idempotent pilot gerekir. Ürün verisi yerinde kalır. Eski yerel yol korunarak mapping kullanımından geri dönülebilir; rollback müşteri verisini silmez. Identity merge ayrı güvenlik incelemesidir. Serve servis saatleri, restore provası ve mevcut guest/menü/QR/servis talebi regresyonları geçiş kapısıdır.

Sonuç: ortak org kaydı ürün operasyonunun sahibi olmaz. Yeniden değerlendirme yalnızca gerçek cross-product ihtiyaçla ve Serve kaynak kanıtıyla. Görevler: P0-01, P0-08, P0-10.
