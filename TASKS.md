# Ainetra Social Tasks

## Active phase

Phase 6 — Publishing IN PROGRESS. P6-01 Publishing Domain Foundation, P6-02 Meta Account Connection and P6-03 Native Meta Submission are DONE; Phase 6 is not complete. Phase 5.5 is COMPLETE.

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
- P6-02 Meta Account Connection. DONE.
- P6-03 Native Meta Submission. DONE (deterministic Meta mocks only; live Meta publishing not validated).

## Ready

- P6-04 PostgreSQL Scheduled Worker. READY; packet: `claude-tasks/P6-04-postgres-scheduled-worker.md`. Implementation not started; explicit go-ahead still required.

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
- P6-01 historical follow-ups: P6-03 now creates intents on an explicit due-now action, validates real Meta credentials and uses a native adapter with one CAS lease/attempt path. Automatic scheduled dispatch and bounded retry remain P6-04; UNKNOWN reconciliation remains P6-05. Local P6-01 validation ran on PostgreSQL 16 because PostgreSQL 17/Docker were unavailable in that environment.
- P6-02 follow-ups: live Meta validation has not been performed (no Meta app credentials in the build environment); OAuth, discovery, selection, reconnect and disconnect were verified with a deterministic fake Graph client and a harness-only fetch mock. Before onboarding non-role customers, confirm Live mode, Advanced Access/App Review for `pages_show_list`, `instagram_basic`, `pages_read_engagement`, Business Verification if Meta requires it, the redirect domain, privacy policy and data-deletion callback, and run a provider test with a non-role account. Business Manager-granted Page roles may additionally need `ads_read`/`ads_management`; these are not requested and such users currently get an honest validation failure. Meta deauthorization/data-deletion webhooks are not implemented, so provider-side revocation is detected only by explicit validation; P6-03 revalidates it at dispatch. Disconnect removes the local credential only; provider-side revocation is not requested because app-level deauthorization would affect the Meta user's other connections. `requestPublishIntent` checks `SocialAccount.status` during creation; P6-03 separately resolves and revalidates the Meta credential before dispatch. Pending OAuth attempts expire after 10 minutes and are purged on the next connection start or selection access; there is no scheduled sweeper. Settings keeps using the first business membership as before.
- Phase 7 Analytics + Learning.
- P6-03 follow-ups: live Meta publishing needs a Live-mode app with approved `instagram_content_publish`/`pages_manage_posts`, a public HTTPS `PUBLIC_APP_URL`, `MEDIA_DELIVERY_SECRET`, Page CREATE_CONTENT/PPA and real IG/FB test accounts. UNKNOWN intents and PENDING attempts left by a crashed process wait for P6-05 reconciliation; RETRY_WAIT is retried only by an explicit user click until P6-04. Page tasks are the ones stored at connection time (debug_token rechecks scopes, not tasks).
