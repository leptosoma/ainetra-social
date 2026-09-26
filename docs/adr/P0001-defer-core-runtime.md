# ADR-P0001 — Core runtime şimdi kurulmayacak

- Tarih: 2026-09-26
- Durum: Kabul edilen v1 mimari kararı; runtime uygulaması yok
- Referans: Claude A/D/M/Q; Gemini A/D/Q; kullanıcı kapsamı

## Bağlam

Bugünkü somut ihtiyaç secret/config yönetimi ve mimari sınırları sabitlemek. Social kendi tenancy, credential ve worker yapısına sahip. Serve `Ops` repo'su tenant/RLS, auth, entitlement, Super Admin, connector, AI Gateway ve deployment routing içeriyor. HotelOps, Zammad biletleri ile Telegram/WhatsApp oda operasyonunu kendi repo sınırında yürütüyor. Ayrı aktif Control repo'su bulunmadı. Büyük ortak servis ürünlerin ilerlemesini ve bağımsızlığını riske atabilir.

## Karar

Phase 0'da Core backend, yeni identity motoru, org DB'si veya ortak platform SDK'sı kurulmaz. Belgeler ve hazır secret manager için ayrı operasyon görevleri hazırlanır. Müşterinin çok ürün/ortak login talebi, bundle satışı, üçüncü üründe tekrar veya sürekli manuel çapraz ürün işlemi belgelenince Core değerlendirmesi açılır. Tetikleyici otomatik uygulama izni değildir.

## Alternatifler

Secret ihtiyacıyla büyük Core kurmak reddedildi: yanlış sorumluluk ve senkron bağımlılık yaratır. Platform kararlarını tamamen ertelemek reddedildi: ürün sahipliği ve ileride bağlama sınırı bugün belirlenebilir. Hemen contracts paketi çıkarmak ertelendi: ikinci tüketici yok.

## Sonuç ve yeniden değerlendirme

Bir miktar yerel tekrar kabul edilir. Core ihtiyaç kaydının yanında bakım sahibi, üç ürünün etkilenen sınırları, Serve entitlement/secret kaynak eşlemesi, HotelOps teslim/entegrasyon sınırı, kesinti politikası ve pilot/geri dönüş tasarımı bulunmadan iş başlamaz. Var olmayan Control repo'sunun incelenmesi kapı değildir; gelecekte Control işi açılırsa kaynak ve yetki incelemesi o işin parçasıdır.

Doğrulama: [S01–S12 ve açık kaynak boşlukları](../platform/REPOSITORY_REVIEW.md). Görevler: P0-01, P0-02, P0-12.
