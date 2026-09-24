# Ainetra Social Tasks

## Active phase

Phase 5 — Visual Intelligence complete

## Done

- Phase 1 Production Foundation.
- Phase 2 Business Brain.
- Phase 3 Platform Intelligence + Content Planning.
- P4-01 Capture Request foundation.
- P4-01B duplicate/concurrency correction.
- P4-02 MediaUsage.
- P4-03 Content Stock.
- P4-04 Content Fallback Engine.
- P4-05 Phase 4 Integration Review.
- P5-01 Visual Analysis Foundation.
- P5-02 Safe Enhance.
- P5-03 Brand Style.
- P5-04 Social Variants + Creative Campaign.
- P5-05 Phase 5 Integration Review.

## Ready

No implementation task is ready. The next recommended activity is an OSS Architecture Spike, subject to user approval; it is analysis only.

## Backlog

- Review whether Content Stock's deterministic greedy allocation should use optimal matching for complex multi-tag inventories; current logic can conservatively undercount coverage but never overcounts it.
- Add timeout/recovery handling for abandoned `PENDING` visual-analysis, Safe Enhance, and Brand Style attempts before asynchronous production providers are introduced.
- Avoid duplicate Feed/Square actions when an active platform rule recommends 1:1 for both; keep rule provenance and the simple user-facing format names.
- Improve Creative Campaign notice handling for non-fact validation errors and measure long confirmed text before rendering it into narrow templates.
- Extend the sector keyword map as more real businesses onboard; unknown sectors deliberately use the strictest policy today.
- Review how to record the sector policy applied at creative generation without weakening decision-time revalidation. Deterministic restricted-claim phrases are a foundation, not semantic or legal review.
- Phase 5.5A — Calendar Workspace & Dashboard Simplification. Future only: day/week/month/year calendar, plain action states, a content-day media/help flow, and operational dashboard priorities.
- Phase 5.5B — Mobile Navigation & Capture-First UX. Future only: phone-first bottom navigation with a prominent capture action, context-aware capture prompts, safe-area support, and thumb-friendly interactions.
- Ainetra product family architecture — future only: Social, Sales, Serve, Control, and a deliberately small shared Core extracted only from proven cross-product needs.
- Ainetra Intent Engine — future shared capability for public social intent signals in Ainetra Social and accepted lead/pipeline opportunities in Ainetra Sales. Documentation only; no Phase 5 implementation.
- Phase 6 Publishing.
- Phase 7 Analytics + Learning.
