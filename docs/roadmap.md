# Ainetra Social Roadmap

## Phase 1 — Completed: Production Foundation

Authentication, PostgreSQL, tenant isolation, media, content domain, approval, scheduling foundation, and versioning.

## Phase 2 — Completed: Business Brain

Website analysis, attribute ledger, provenance, confirmation, canonical context, brand personality, and business goals.

## Phase 3 — Completed: Platform Intelligence + Content Planning

Platform rules and strategy, content mix and pillars, 7/30-day plans, media requirements, plan versioning, and plan approval.

## Phase 4 — Completed: Capture + Stock + Fallback

Completed:

- P4-01 Capture Requests and Capture foundation.
- P4-01B duplicate/concurrency correction.
- P4-02 MediaUsage.
- P4-03 Content Stock.
- P4-04 Content Fallback Engine.
- P4-05 Phase 4 integration review.

## Phase 5 — Completed: Visual Intelligence

Completed:

- P5-01 Visual Analysis Foundation.
- P5-02 Safe Enhance.
- P5-03 Brand Style.
- P5-04 Social Variants + Creative Campaign.
- P5-05 Phase 5 integration review.

Visual Intelligence must preserve factual reality in authentic media, distinguish authentic enhancement from campaign creative, validate provider output, and require user review before later content use.

P5-05 verified the cross-module authentic derivative and designed-creative flows, tenant isolation, explicit media decisions, Content Stock/Fallback separation, and no implicit content approval or publication. Creative Campaign now resolves a conservative sector policy from the business sector: hospitality, food, or health. Unknown sectors use the strictest profile. All output remains fact-grounded and human-reviewed; health additionally requires an explicit acceptance, and current policies allow deterministic graphic templates only.

The **OSS Architecture Spike** is documented in [oss-architecture-spike.md](oss-architecture-spike.md). FullCalendar Standard is now used for the P5.5A desktop calendar; the Ainetra-owned mobile Today/3-day/Week and capture UI shipped in P5.5B. Keep Sharp, defer BullMQ/tusd/imgproxy, and use bounded FFmpeg tooling when video processing begins. Phase 6 should own a `PublishingAdapter`, transactional publication intent and tenant-safe reconciliation. Pilot Postiz behind the adapter subject to legal/security/operations gates; use a minimal native Meta adapter for first production Instagram/Facebook unless that pilot passes. Mixpost Lite does not meet Instagram/API needs, and paid-tier SaaS rights require separate review. Phase 6 has not started.

## Phase 5.5 — Completed: Simple Experience & Calendar Workspace

After Visual Intelligence and before or alongside Publishing integration, simplify the customer experience without weakening the internal engines. P5.5A and P5.5B are complete; the phase is complete.

### P5.5A — Calendar Workspace & Dashboard Simplification

**DONE.** FullCalendar Standard/MIT 6.1.21 renders the day, week, month, and year views. Ainetra owns the tenant-scoped active-plan/scheduled-post projection, business-timezone dates, Turkish action states, event drawer, and dashboard weekly summary. Linked plan/post work is counted once, including when the scheduled date crosses a week boundary. Only existing upload, content, media, and fallback routes are offered; drag/drop and publishing remain disabled.

- Make the calendar a primary workspace with day, week, month, and year views. Mobile may favor Today, 3-day, and Week with Month as an overview; month cells should use simple icons or status dots.
- Show planned content and plain action states: Ready, Media needed, Planned, User action needed, and Ainetra can help.
- A content day should state the need directly, for example: “25 Eylül · Instagram Reel · Akşam servisi · 8–12 saniyelik dikey video gerekiyor.” Offer `Medya ekle`, `Nasıl çekeyim?`, and `Çekemiyorum → Ainetra yardım et`.
- The future help flow may orchestrate Capture, Content Stock, MediaUsage, Fallback, and Visual Intelligence behind a simple surface: check unused authentic media, reusable media, Safe Enhance, verified-information creative, Creative Campaign when appropriate, then the easiest capture instruction. It must not create misleading synthetic product photography.
- Put operational priorities first on the dashboard, for example: “Bu hafta 7 içerik planlandı. 5 hazır. 2 senden bir şey bekliyor.” Keep system internals secondary.

### P5.5B — Mobile Navigation & Capture-First UX

**DONE.** Phone layout uses a top bar with an `İşletmem` menu and a safe-area bottom dock with a central capture sheet (current CaptureRequest first, native camera/gallery inputs, server-derived tags), a mobile Bugün surface, and an Ainetra-owned Gün/3 gün/Hafta/Ay calendar; FullCalendar stays desktop/tablet only.

- Treat mobile as a primary capture and upload surface for staff, not a compressed desktop sidebar. Aim for roughly five bottom navigation items: `Bugün`, `Takvim`, a visually dominant central action, `İçerikler`, and `Medya`.
- The central action may open a compact sheet: `Fotoğraf çek`, `Video çek`, `Galeriden yükle`, `Ainetra ile içerik hazırla`. Prefer a relevant prompt such as “Cuma gönderisi için fotoğraf çek” when the current plan needs it.
- Move rarely used Marka, Business Brain, Sosyal Strateji, and integrations/settings into an `İşletmem` or settings area after UX review.
- Support bottom safe areas, iPhone home indicators, Android gesture navigation, thumb-friendly targets, minimal top navigation, and sheets or modals where they make a task simpler.

## Phase 6 — IN PROGRESS: Publishing

Ainetra PostgreSQL owns approval, immutable publish intent/outbox, attempts, schedule, and audit. The first production delivery path is a native Meta adapter behind an Ainetra-owned `PublishingAdapter`; Postiz remains a separate pilot/spike. Start with a small PostgreSQL-backed worker and reconciliation, not BullMQ. Unknown provider outcomes require reconciliation and never count as automatic success or failure. TikTok is outside this phase.

- **P6-01 — Publishing Domain Foundation (DONE):** provider-neutral adapter contract, approved immutable snapshot, transactional publish intent/outbox, attempt/status model, idempotency and state-transition tests. No Meta connection or delivery. Packet: `claude-tasks/P6-01-publishing-foundation.md`.
- **P6-02 — Meta Account Connection (DONE):** secure native Instagram/Facebook OAuth (Facebook Login, Graph API v26.0, baseline scopes only), tenant/account mapping, encrypted token boundary, reconnect/disconnect/reauthorization and connection audit. No publication. Live Meta app validation and App Review remain open. Packet: `claude-tasks/P6-02-meta-account-connection.md`.
- **P6-03 — Native Meta Submission (READY; not implemented):** narrow Instagram single-JPEG and Facebook Page text/single-photo delivery through the adapter for an explicitly due-now intent; normalize definitive and unknown results, preserve remote IDs and idempotency evidence. No scheduled worker. Packet: `claude-tasks/P6-03-native-meta-submission.md`.
- **P6-04 — Scheduled PostgreSQL Worker (planned):** claim due intents with leases, bounded retry for definite retryable failures, crash-safe processing and operational visibility using the same execution unit. No BullMQ.
- **P6-05 — Cancel, Reschedule & Reconciliation (planned):** safe intent generations, provider lookup for unknown outcomes, tenant-safe callbacks/status repair, and user-facing status where needed.
- **P6-06 — Phase 6 Integration Review (planned):** end-to-end immediate/scheduled/cancel/unknown flows, duplicate prevention, tenant isolation, approval/version checks, audit, migration and failure recovery.

## Phase 7 — Planned: Analytics + Learning

Published performance ingestion, content comparison, AI insight, Data → Insight → Action, and planning feedback.

## Future shared capability — Ainetra Intent Engine

The future Ainetra Intent Engine may detect public social intent signals for Ainetra Social and pass user-accepted opportunities into Ainetra Sales as leads or pipeline. It is documentation-only during Phase 5; no Intent Engine, Sales, or Lead Radar code is in scope.
