# Ainetra proje envanteri

26 Eylül 2026 · Kaynak: belirtilen yerel checkout'ların Git durumu ve ürün belgeleri. Bu envanter aktif çalışma yollarını ayırır; production'da hangi commit'in çalıştığını kanıtlamaz.

| Ürün | Aktif repo yolu | GitHub `origin` | Aktif dal / yerel HEAD | Source of truth belgeleri | Ürün ve domain sınırı |
|---|---|---|---|---|---|
| Social | `C:\Users\admin\Documents\Codex\2026-09-11\d-n-p-duruyor-sana-resmi-2\ainetra-social` | [leptosoma/ainetra-social](https://github.com/leptosoma/ainetra-social.git) | `fix/calendar-fullcalendar-render` / `1e5ba6a` | `README.md`, `docs/current-state.md`, `docs/product-bible.md`, `docs/roadmap.md`, `TASKS.md`; platform kararları bu repo `docs/` altında | Business/marka, medya, içerik planı/onayı ve Meta yayın. Kendi Prisma/PostgreSQL DB'si, tenant üyeliği, Meta credential deposu ve yayın worker'ı var. |
| Serve | `C:\Users\admin\Documents\Codex\Ops` | [leptosoma/Ainetra-AI-OPS](https://github.com/leptosoma/Ainetra-AI-OPS.git) | `feat/menu-categories` / `24c1d79` | `README.md`, `PROJECT_STATUS.md`, `docs/00-master-product-spec.md`, `docs/01-products-and-scope.md`, ilgili `docs/adr/ADR-*.md` | QR/menü, misafir oturumu, sipariş, servis talebi, personel ve ürün içi Super Admin. `tenants.id` ürün tenant kökü; Serve DB rotası/RLS ve plan/abonelik kararları Serve'e ait. |
| HotelOps | `C:\Users\admin\Documents\Codex\2026-09-03\referenced-chatgpt-conversation-this-is-an-2\work\ainetra-hotelops` | [leptosoma/ainetra-hotelops](https://github.com/leptosoma/ainetra-hotelops.git) | `feature/whatsapp-room-conversation` / `33c3ad6` (`docs: add HotelOps project documentation`) | `README.md`, `CURRENT_STATE.md`, `ARCHITECTURE.md` | Telegram/WhatsApp misafir talebi, oda konuşması, QR ve Zammad bilet orkestrasyonu. Biletler Zammad'da, ürün içi durum `config/*.json` dosyalarında; bu repoda ayrı ilişkisel ürün DB'si doğrulanmadı. |
| Control | Ayrı aktif repo bulunamadı | Yok / doğrulanmadı | Yok | Yok | Gelecekte Ainetra çalışanlarına özel platform admin konsolu (staff-only). Serve'in mevcut Super Admin ekranı Control sayılmaz. |

## Diğer kopyalar ve kaynak seçimi

| Yol | Gözlem | Kullanım |
|---|---|---|
| `C:\Users\admin\Documents\Codex\HotelOps` | Eski yerel `master` kopyası, `a9c2f1b` | **Source of truth değil.** HotelOps için yukarıdaki aktif feature repo ve `33c3ad6` belgeleri kullanılır. |
| `C:\Users\admin\Documents\Codex\2026-09-26\referenced-chatgpt-conversation-this-is-an\work\ainetra-social` | `docs/platform-architecture-v1` çalışma kopyası, `29c1db1` | Önceki Social kaynak incelemesinde güncel domain kodu için kullanıldı; bu görevin belge çıktısı aktif Social repo `docs/` ağacındadır. |
| `C:\Users\admin\Documents\Codex\2026-09-26\referenced-chatgpt-conversation-this-is-an\outputs\Ainetra-Platform-Architecture-v1` | Önceki belge çıktı kopyası | Aktif repo veya kararların düzenlendiği yer değil. |
| `C:\Users\admin\Documents\Codex\Ops\references` | Serve repo içinde önceden bulunan izlenmeyen referans klasörü | Ürün kodu ya da bu çalışmanın çıktısı olarak değerlendirilmedi; dokunulmadı. |

Social aktif checkout'unda önceden değişmiş `next-env.d.ts` vardır. Platform belgeleri henüz commit edilmemiştir. Serve aktif dalı yerel olarak remote'un önündedir; HotelOps feature dalı `origin` ile aynı commit'tedir. Bu çalışma hiçbir repo dalını, uygulama kodunu, DB'yi veya deployment'ı değiştirmez.

## Kaynak ve belirsizlik notu

- [Social kaynak incelemesi](REPOSITORY_REVIEW.md) `29c1db1` kod revizyonunu; bu envanter ise belge yazılan aktif checkout'un `1e5ba6a` HEAD'ini bildirir. Revizyonlar farklıdır.
- [Serve kaynak incelemesi](SERVE_REVIEW.md) `24c1d79` ve Serve içi sahipliği açıklar.
- HotelOps `README.md`, `CURRENT_STATE.md` ve `ARCHITECTURE.md` belgeleri `33c3ad6` commit'inde eklendi; içerikleri özellik kodunu `43bcf2f` seviyesinde anlatır. Git geçmişindeki “production baseline” adı canlı dağıtım kanıtı değildir.
- Üç ürünün gerçek production/staging dağıtımı, HotelOps'un canlı commit'i ve ayrı Control uygulamasının bulunmadığı repo dışı ortamlarda ayrıca doğrulanmalıdır.
