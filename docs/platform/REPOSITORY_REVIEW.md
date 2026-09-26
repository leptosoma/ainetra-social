# Platform v1 — kaynak inceleme kaydı

26 Eylül 2026 · Salt kaynak incelemesi · **Social, Serve ve HotelOps aktif kaynakları incelendi; ayrı Control repo'su bulunmadı.**

## Kapsam ve yöntem

Şema, runtime giriş noktaları, auth, credential çözümleme, publishing worker, env örneği ve mevcut plan belgeleri okundu. Gerçek `.env`, credential değerleri, müşteri DB verileri okunmadı. Sunucuya bağlanılmadı; migration/test/build/deploy çalıştırılmadı. Kaynakta bir kontrolün görülmesi sistemin tamamına güvenlik sertifikası vermez.

| Proje | Kaynak | Revizyon / durum | Sonuç |
|---|---|---|---|
| ainetra-social | `https://github.com/leptosoma/ainetra-social` | `29c1db171f32c17279aab67ec058951fb82fb171`; uzak `fix/calendar-fullcalendar-render` | İlgili mimari yollar incelendi |
| ainetra-serve | `C:\Users\admin\Documents\Codex\Ops` | `24c1d79ce715993d953d4808ee48ac357109ccb4`; `references/` önceden untracked | İlgili kaynak/migration/ADR'ler incelendi; [ayrıntılı Serve incelemesi](SERVE_REVIEW.md) |
| ainetra-hotelops | `C:\Users\admin\Documents\Codex\2026-09-03\referenced-chatgpt-conversation-this-is-an-2\work\ainetra-hotelops` | `33c3ad6`; `feature/whatsapp-room-conversation` | `README.md`, `CURRENT_STATE.md`, `ARCHITECTURE.md` ve Git durumu incelendi; Zammad/JSON veri sınırı |
| ainetra-control | Ayrı aktif repo bulunamadı | Yok | Gelecek staff-only platform yüzeyi; mevcut ürün/deployment sayılmaz |

Kullanıcının yerel Social checkout'u `1e5ba6a` ve önceden değişmiş `next-env.d.ts` içeriyordu. Buna dokunulmadı. Güncel uzak revizyon ayrı `work/ainetra-social` kopyasında incelendi. İki revizyon arasındaki değişiklikler calendar/media-query ve dev-origin düzeltmeleri; burada alıntılanan domain/credential/worker dosyaları değişmemişti. İzole hazırlık dalı `docs/platform-architecture-v1`; son belgeler mevcut yerel Social reposuna yalnızca yeni dosyalar olarak eklendi, kullanıcının dalı değiştirilmedi. Commit/push yapılmadı.

İlk taramada Serve yolu bulunmamıştı; kullanıcı `Ops` klasörünü source of truth olarak gösterdi. Bu klasör salt okunur incelendi. Kullanıcının gösterdiği aktif HotelOps repo'su ve `33c3ad6` dokümanları da incelendi; eski `C:\Users\admin\Documents\Codex\HotelOps` kopyası kaynak alınmadı. Ayrı Control repo'su bulunmadı. Serve'in kendi Super Admin kodu Control sanılmadı. Serve içindeki `references/` klasörüne dokunulmadı. Aktif yollar ve diğer kopyalar [envanterdedir](AINETRA_PROJECT_INVENTORY.md).

## Social kanıt haritası

Satırlar aşağıdaki revizyona aittir; bağlantılar kalıcı kaynak referansıdır.

| Kanıt | Dosya / sembol | Karara etkisi |
|---|---|---|
| S01 | [schema.prisma:413](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/prisma/schema.prisma#L413), `User`; :443 `Session`; :456 `Business`; :693 `Membership` | `cuid`, yerel kullanıcı/tenant ve üyelik; UUID dönüşümü yok |
| S02 | [authorization.ts](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/src/lib/authorization.ts), `requireMembership`, `getFirstBusinessForUser` | Yerel üyelik kontrolü korunur; çoklu membership mümkün, mevcut seçim ilk business'a dayanır |
| S03 | [session.ts](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/src/features/auth/session.ts), `createSession`, `getCurrentSession` | Hash'li DB session; cookie; 30 gün; hazır OIDC mevcut değil |
| S04 | [schema.prisma:1394](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/prisma/schema.prisma#L1394), `MetaConnection` | Credential ciphertext ve opaque ref ürün içinde |
| S05 | [crypto.ts](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/src/features/meta-connection/crypto.ts), `loadCredentialKeyring`, `credentialAad` | AES-GCM ve keyring var; wrapped DEK/envelope encryption yok |
| S06 | [service.ts](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/src/features/meta-connection/service.ts), `resolveMetaAccessToken`, `verifyMetaPublishingCredential` | Tenant/hesap/ref bağlamı ve provider doğrulaması; Core resolver'a gerek yok |
| S07 | [config.ts](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/src/features/meta-connection/config.ts), `loadMetaConfig` | Env tüketimi; v26.0 varsayılan ama env override mevcut |
| S08 | [worker giriş noktası](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/scripts/publishing-worker.ts), [worker.ts](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/src/features/publishing/worker.ts) | Ayrı worker; aynı Social DB/storage; PG queue; `UNKNOWN` korunur |
| S09 | [schema.prisma:1061](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/prisma/schema.prisma#L1061), `PublishIntent` | Ürün içi outbox platform event bus değildir |
| S10 | [.env.example](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/.env.example), [media-delivery.ts](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/src/features/publishing/media-delivery.ts) | İmzalı medya secret'ı ve public origin ayrı sınıflar; worker da tüketir |
| S11 | [db.ts](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/src/lib/db.ts), [docker-compose.yml](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/docker-compose.yml), `src/lib/storage/local-storage.ts` | Social yerel Postgres/storage; prod ayrılığı kanıtlanmış değil |
| S12 | [TASKS.md](https://github.com/leptosoma/ainetra-social/blob/29c1db171f32c17279aab67ec058951fb82fb171/TASKS.md), `docs/current-state.md` | P6-05 açık; önceki testler/live Meta sınırı tarihsel kayıt |
| S13 | `src/features/business-brain/providers/index.ts` | Gerçek env adı `BUSINESS_BRAIN_API_KEY`; yeni OPENAI değişkenleri uydurulmadı |

## Serve kanıt haritası

Ops yolları [Serve incelemesinde](SERVE_REVIEW.md) ayrıntılıdır. Özellikle `apps/api/src/db/migrations/0001_core.sql` Serve `tenants.id uuid`, `branches`, `plans`, `subscriptions`, kullanıcı/rol ve RLS temelini; `0003_runtime_foundations.sql` feature override/connector/auth session'ı; `0005_ai_configuration.sql` platform ve tenant şifreli AI key'lerini; `0006_public_guest_sessions.sql` guest token/session ve RLS'yi gösterir. `apps/api/src/modules/entitlements/entitlement.service.ts` pasif abonelikte kapalı hak kararını; `apps/api/src/db/router.ts` runtime/migration DB rotalarını; `apps/api/src/plugins/connectors.ts` Serve içi connector registry'yi; `apps/api/src/modules/ai/ai.service.ts` lokal secret çözümlemeyi gösterir. `apps/web/components/admin-shell.tsx` Serve repo'sunda gerçek Super Admin paneli olduğunu doğrular.

## Kaynakla ortaya çıkan düzeltmeler

- “Mevcut tenant ID'leri UUID” varsayımı yanlış: Social `cuid` kullanıyor.
- “Envelope encryption zaten var” denemez: mevcut uygulama doğrudan AES-GCM keyring kullanıyor.
- “Graph version kodda kesin kilitli” denemez: environment override var.
- “SecretProvider eklemek ilk şart” değil: mevcut loader'lar env injection ile uyumlu sınır sunuyor.
- “Web secret'ını güncellemek yeterli” değil: ayrı worker ve signed media secret'ı da kapsanmalı.
- “Control zaten merkezi Core” denemez: ekran adları veya geçmiş anlatım backend kanıtı değildir.
- “Üç ürünün production ortamları ayrıdır” kanıtlanmadı; hedef mimari olarak yazıldı.
- “Serve yalnız restoran operasyon tablolarından ibaret” yanlış: mevcut repo tenant, plan/entitlement, Super Admin, AI Gateway, connector ve deployment routing içeriyor.
- “Serve org ile outlet üzerinden eşlenir” yanlış granülarite: Serve kökü `tenants.id`; branch/resources alt birimler.
- “Core gelince Serve entitlement kaynağı olur” mevcut sunucu karar yolunu ve pasif abonelik kuralını kırabilir; cutover ayrı ADR gerektirir.
- “Platform provider key'leri bugün manager'da” yanlış: Serve platform AI key'i kendi `encrypted_secrets` tablosunda şifreli.
- “Serve'e RLS/UUID standardı eklenecek” zaten var olan yapıyı tekrar kurar; gereksiz migration.
- “Serve'in Super Admin'i Control ile aynıdır” yanlış varsayım: ayrı aktif Control repo'su bulunmadı.

## Canlı ortam ve gelecek Control için açık doğrulama

| Kontrol | Durum |
|---|---|
| Social/Serve/HotelOps production commit, deployment, DB/kalıcılık, secret ve erişim ayrımı | Canlı ortam incelenmedi |
| Serve paket/abonelik ve Core yokluğu kesinti davranışı | Kaynak kararı belgelendi; canlı deney yapılmadı |
| HotelOps Meta/Telegram/Zammad uçtan uca akışı, grup eşlemeleri, admin credential override, webhook teslimi | Kaynak dokümanları var; canlı doğrulama yapılmadı |
| Control staff yetkisi, API ve Serve Super Admin ilişkisi | Ayrı aktif repo yok; somut ihtiyaçla açılacak gelecek tasarım işi |

Mimari v1, mevcut üç ürün sınırlarıyla FINAL'dir. Canlı topoloji ve operasyon kabulü ayrı Phase 0 görevleridir; yeni bilgi ana belge ve ilgili ADR'yi düzeltebilir. Çalışan kod otomatik değiştirilmez.
