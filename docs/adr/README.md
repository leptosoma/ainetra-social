# Platform Architecture v1 — ADR dizini

26 Eylül 2026. Durum: **FINAL v1 mimari kararları**. Social, Serve ve HotelOps aktif kaynakları/dokümanları incelendi. Ayrı aktif Control repo'su bulunmadı; Control gelecek staff-only yüzeyidir. Hiçbir ADR bu çalışmada kod veya migration uygulamaz.

| ADR | Karar |
|---|---|
| [P0001](P0001-defer-core-runtime.md) | Core runtime'ı ihtiyaç kapısına kadar ertele |
| [P0002](P0002-product-ownership-link-dont-move.md) | Üç ürünün domain/veri sınırını ve mevcut ID'leri koru; link, don't move |
| [P0003](P0003-secrets-and-product-credentials.md) | Hazır secret manager; tenant credential kullanan üründe |
| [P0004](P0004-deployment-environment-isolation.md) | Ortamları deployment ve kaynak sınırlarıyla ayır |
| [P0005](P0005-future-core-and-control-boundaries.md) | Dar Core, ayrı ürün yetkileri ve staff Control |
| [P0006](P0006-resilience-and-integration-contracts.md) | Core'suz ana akış, yerel projection, ihtiyaçla entegrasyon |

Üst belge: [Architecture v1](../AINETRA_PLATFORM_ARCHITECTURE_V1.md). Kanıt: [repo incelemesi](../platform/REPOSITORY_REVIEW.md), [Serve uyum kaydı](../platform/SERVE_REVIEW.md), [proje envanteri](../platform/AINETRA_PROJECT_INVENTORY.md). Uygulama sırası: [Phase 0 planı](../AINETRA_PLATFORM_PHASE_0_TASK_PLAN.md).
