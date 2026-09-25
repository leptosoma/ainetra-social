# Ainetra Social Tasks

## Active phase

Phase 6 — Publishing IN PROGRESS. P6-01 Publishing Domain Foundation is DONE; Phase 6 is not complete. Phase 5.5 is COMPLETE.

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
- P5.5A Calendar Workspace & Dashboard Simplification.
- P5.5B Mobile Navigation & Capture-First UX. DONE.
- Phase 5.5 Simple Experience & Calendar Workspace. COMPLETE.
- P6-01 Publishing Domain Foundation. DONE.

## Ready

- P6-02 Meta Account Connection. READY; planning packet: `claude-tasks/P6-02-meta-account-connection.md`. Implementation not started.

## Backlog

- Review whether Content Stock's deterministic greedy allocation should use optimal matching for complex multi-tag inventories; current logic can conservatively undercount coverage but never overcounts it.
- Add timeout/recovery handling for abandoned `PENDING` visual-analysis, Safe Enhance, and Brand Style attempts before asynchronous production providers are introduced.
- Avoid duplicate Feed/Square actions when an active platform rule recommends 1:1 for both; keep rule provenance and the simple user-facing format names.
- Improve Creative Campaign notice handling for non-fact validation errors and measure long confirmed text before rendering it into narrow templates.
- Extend the sector keyword map as more real businesses onboard; unknown sectors deliberately use the strictest policy today.
- Review how to record the sector policy applied at creative generation without weakening decision-time revalidation. Deterministic restricted-claim phrases are a foundation, not semantic or legal review.
- Ainetra product family architecture — future only: Social, Sales, Serve, Control, and a deliberately small shared Core extracted only from proven cross-product needs.
- Ainetra Intent Engine — future shared capability for public social intent signals in Ainetra Social and accepted lead/pipeline opportunities in Ainetra Sales. Documentation only; no Phase 5 implementation.
- Field-test native `capture` file inputs on real iOS Safari and Android Chrome (permissions, cancellation, orientation, HEIC-to-JPEG conversion, interrupted large video uploads); automated checks used Chromium device emulation only.
- The layout's capture prompt reads existing CaptureRequests read-only; a plan whose requests have not yet been reconciled shows its prompt after the next dashboard/content-plan load.
- P6-01 follow-ups for later Phase 6 tasks: nothing enqueues publish intents yet (`requestPublishIntent` is invoked only by tests until P6-03/P6-04 flows call it); `CONNECTED` remains a placeholder and P6-02/P6-03 must validate the real credential at delivery; the adapter contract has no implementation; claiming/leasing, retry budget, and reconciliation loops are P6-04/P6-05. Local P6-01 validation ran on PostgreSQL 16 because PostgreSQL 17/Docker were unavailable in that environment.
- Phase 7 Analytics + Learning.
