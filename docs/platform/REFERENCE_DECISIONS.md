# Platform v1 — referanslar ve karar gerekçesi

## Birincil kullanıcı referansları

Kaynak konuşma: [İş fikri geliştirme](chatgpt-conversation://6aacfcf2-b9b4-83eb-b177-9396c6e48ee8). Raporların özgün ekleri okundu; önceki asistan özetleri tek kaynak olarak kullanılmadı.

| Ref | Kullanıcının eki | Kimlik |
|---|---|---|
| C | Claude: `Pasted markdown.md`, “Ainetra Platform Mimarisi: Eleştirel İnceleme” | SHA-256 `2D59A4CCECCD6889F26BB94E21AB1ABE42B4F837262055421DB0AC8804511178` |
| G | Gemini: `Yapıştırılan metin.txt`, Ainetra platform mimarisi değerlendirmesi | SHA-256 `2EB95DFE5B9A86DD5FE82C35803A34E7C15EF62CB004D64E620306C879107954` |

Raporlar kullanıcı tarafından bu adlarla tanıtıldı; dış model kimliğine ayrıca doğrulama yapılmadı. Ekler geçici preview yollarından okundu; bu yollar repo bağlantısı olarak kullanılmadı. Bu sayfa raporların kararları etkileyen kısımlarını kalıcı olarak özetler. Raporlardaki tarih/tahmin, ürün gelir projeksiyonu veya mevcut kod iddiası doğrulanmış gerçek sayılmaz.

## Uzlaşı ve bilinçli sapmalar

| Konu / rapor bölümü | Claude | Gemini | v1 kararı ve gerekçe |
|---|---|---|---|
| Core şimdi (C A/Q, G A/Q) | Runtime ertelensin | Runtime ertelensin | Kabul; Phase 0 belgeleme ve küçük operasyon işleri |
| Secret sınıfları (C G, G G) | Bootstrap/provider/tenant/config ayrımı | Manager ve injection | C'nin ayrımı + G'nin runtime bağımsızlığı; token üründe |
| Control secret UI (C G.6, G G) | Tercihen eklemeyin | Manager API'sine UI | Manager'ın kendi UI'si; Control'a secret okuma yetkisi gerekmiyor |
| Ortak tenant (C D/F/H, G H) | Organization | Global tenant standardı | Organization gelecekte; Social Business ve Serve `tenants.id`/`branches` taşınmaz |
| ID standardı (C K, G K) | UUIDv7/ULID | UUIDv4 | Yeni Core ID için UUIDv7 hedefi; Social cuid ve Serve UUID kimlikleri değişmez |
| Her tabloda org_id (C H.4, G H) | Yaygın org scope | tenant kolon/RLS | Social mevcut scope, Serve mevcut `tenant_id`/RLS korunur; bugün kolon/ORM/RLS migration'ı yok |
| Credential crypto (C G.3, G K) | Envelope encryption | KMS/PGP önerisi | Social ve Serve mevcut AES-GCM/keyring biçimlerini korur; Serve platform AI key'i de DB'dedir, otomatik dışarı taşınmaz |
| Yenileme (C G.5, G G) | TTL/refresh veya rolling restart | Redis Pub/Sub | Önce mevcut env injection + kontrollü restart; 401/403 kör retry yok |
| Broker (C I, G I/M) | Gerektiğinde PG outbox/webhook | RabbitMQ/Redis | Bugün broker yok; ilk gerçek dayanıklı akışta outbox |
| Contracts (C L.3, G D/L) | İkinci tüketici | Hemen paket | İkinci tüketiciye kadar ertele; şema/tip dışında paylaşım yok |
| Migration (C K, G K) | Denetimli/idempotent eşleme | Login sırasında lazy eşleme | Link, don't move; ayrı görevde kontrollü pilot; login'de gizli merge yok |
| Repo/deploy (C L, G L) | Core+Control birlikte olabilir | Ayrı deploy seçenekleri | Ayrı aktif Control repo'su yok; gelecek staff-only yüzeyin deploy kararı somut ihtiyaç ve ADR ile verilir |
| Ortamlar (C C/L, G C/L) | Ayrı deployment/DB/secret | Infrastructure seviyesinde | Kabul; Serve'in shared/dedicated/on-premise DB routing'i korunur, tenant başına ayrı DB emri yok |
| Kesinti (C J, G J) | Lokal snapshot ile devam | Lokal runtime cache | Yeni Core'a ana akış bağımlılığı yok; Serve mevcut abonelik fail-closed kararı atlanmaz; secret cold-start sınırı açık |
| Etkili entitlement (C D/F, G E) | Gelecekte Core | Gelecekte tenant Core | Serve bugün kendi plan/abonelik/override motorunda yetki verir; Core çapraz ürün kayıt adayı, ürün hakkı cutover'ı ayrı ADR |

## Raporlardan otomatik kabul edilmeyen iddialar

Serve'in gerçek model ve auth yolları artık `Ops` kaynaklarıyla karşılaştırıldı; [kanıt](SERVE_REVIEW.md). Çalışan production topolojisi kaynak kodla doğrulanmış sayılmadı. Core DB'sini ürün projection'larından tam geri kurma garantisi verilmedi. Her provider'ın overlap rotasyonu, restart'sız yenileme veya evrensel fail-open yetkilendirmesi desteklediği varsayılmadı. Serve'in pasif abonelikte hak kapatma kuralı özellikle korundu. Takvime/ekip sayısına bağlı monorepo, broker veya yeni ürün zorunluluğu alınmadı.

HotelOps için aktif repo ve `33c3ad6` belgeleri [envantere](AINETRA_PROJECT_INVENTORY.md) eklendi. Ürün Zammad/JSON veri sınırında tutuldu; Serve servis talebine veya gelecekteki Core'a taşınmadı. Ayrı Control repo'su bulunmadığından referans raporların Control varsayımları mevcut ürün gerçeği olarak alınmadı.

## Dar dış kaynak doğrulaması

26 Eylül 2026 tarihinde Infisical'ın [CLI run](https://infisical.com/docs/cli/commands/run) ve [machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities) belgeleri kontrol edildi: mevcut process env'ine injection ve kapsamlı servis kimliği yaklaşımı teknik olarak mevcut. Bu, sağlayıcının seçildiği/kurulduğu veya bütün plan/hosting seçeneklerinin araştırıldığı anlamına gelmez. Fiyat, lisans, veri yerleşimi, backup ve operasyon uygunluğu Phase 0 seçim görevinde değerlendirilecek.
