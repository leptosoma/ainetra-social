# Current State

Updated: 2026-09-23

- Branch: `feature/capture-fallback`
- Verified product baseline: `phase-4-complete`.
- Validation: 218/218 Vitest tests pass; lint and production build pass; npm audit reports 0 vulnerabilities. The full suite was run directly against the migrated test database. Prisma migrate status and deploy worked on this run.
- Development and test databases: all 13 migrations applied; `prisma migrate status` reports both schemas up to date.
- Live Phase 4 validation: Content Stock reports 3/43 for the current 30-day window; 43 current active requirements are counted and 6 superseded-plan items are excluded.
- Capture reconciliation: all 39 current ACTIVE/MISSING requirements have one CaptureRequest; 34 are open, 5 are expired, with no duplicates or invalid open rows.

## Migrations

- `20260918112903_init`
- `20260918120550_business_brain`
- `20260918124305_content_planning`
- `20260919061712_content_plan_snapshot`
- `20260919062047_content_planning_runs`
- `20260919110000_capture_engine`
- `20260921090000_media_usage`
- `20260921120000_content_fallback`
- `20260922090000_visual_analysis`
- `20260922130000_safe_enhance`
- `20260923090000_brand_style`
- `20260923140000_social_variants_creative`
- `20260923150000_fallback_designed_creative`

## Implemented modules

- Authentication, business tenancy, authorization, media storage, content, approval, scheduling foundation, and versioning.
- Business Brain, goals, canonical context, provenance, and confirmation.
- Platform Intelligence, content strategy, and 7/30-day content plans.
- Capture Requests, capture list UI, image/video upload validation, request fulfilment, and duplicate protection.
- MediaUsage recording at the export lifecycle boundary, tenant-safe/idempotent usage summaries, never-used detection, last-used time, and usage count.
- Content Stock calculation from upcoming active plan requirements, MediaAsset suitability, and MediaUsage recency; tenant-isolated `HEALTHY` / `LOW` / `CRITICAL` dashboard summary with explainable coverage and missing requirements.
- Content Fallback proposals with authentic-media ranking, MediaUsage recency protection, confirmed canonical Business Brain facts, explicit user acceptance, plan/version validation, tenant isolation, and concurrency-safe idempotency.
- CaptureRequest reconciliation for pre-Phase-4 plans, business-timezone expiry boundaries, stale request closure, duplicate-safe concurrent sync, and atomic fulfilment when media is assigned.
- Visual Analysis Foundation with validated normalized metadata, versioned current-analysis semantics, tenant isolation, platform-fit evaluation, authenticity sensitivity, media-library summaries, and focused detail UI. The configured `development-pixel-stats` provider is explicitly labeled DEVELOPMENT and is not real AI; it uses pixel statistics and planning tags without claiming object recognition.
- Safe Enhance with immutable originals, versioned derivative attempts, explicit source/provenance links, conservative `NATURAL` / `BRIGHT` / `CLEAN` / `WARM` presets, original-versus-result review, explicit keep/discard decisions, tenant isolation, concurrency deduplication, and recoverable storage cleanup. The configured `development-sharp-local` provider is deterministic local processing and is explicitly presented as non-AI.
- Brand Style, composed on the Safe Enhance derivative, validation, provider, and review infrastructure. A versioned visual-style profile is derived from the user-maintained BrandProfile tone preferences into one recommended “Markama göre” choice plus restrained natural/vibrant/premium alternatives with a plain-language rationale; raw preferences never reach the UI. Sources may be an original upload or a kept Safe Enhance derivative, both of which stay immutable, and lineage, BrandProfile identity/snapshot, analysis context, provider provenance, and bounded operations are persisted per attempt. Authenticity outranks style: operations are clamped to a stricter bound for authenticity-sensitive or unverified media and any request outside the closed safe-operation contract is rejected.
- Social Variants create rule-backed Feed, Story, Reel Cover, or Square image derivatives from accepted authentic media. Local `development-sharp-local` processing uses conservative crop or full-frame contain/padding and is labeled non-AI; it stores platform-rule provenance, source/root lineage, version, and explicit keep/discard. A kept variant becomes a separate authentic MediaAsset without content or publishing approval.
- Creative Campaign makes clearly labeled designed graphics from canonical confirmed Business Brain facts and optional accepted authentic media. The deterministic `development-template-local` provider is non-generative. Missing facts block creation; fact, brand, and platform-rule snapshots preserve history. Explicit keep creates a MediaAsset tagged only `CUSTOM_GRAPHIC`; it cannot satisfy authentic photo/video requirements. Fallback ranks it as an existing designed creative, separately from authentic media, with recency and plan-version safeguards.

## Incomplete modules and debt

- Verified social proof has no production data source yet, so the fallback engine safely skips that rank rather than inventing evidence.
- Content Stock uses deterministic greedy allocation and can conservatively undercount in complex multi-tag inventories; review optimal matching before scale if product data shows a need.
- Abandoned `PENDING` visual-analysis, Safe Enhance, and Brand Style attempts do not yet have timeout/recovery handling; add this before introducing asynchronous production providers.
- Photo aspect-ratio recommendations are defined in the seed as manual Ainetra guidance and are not applied automatically by the migration.
- Safe Enhance and Brand Style are synchronous and have no automatic retry worker; a failed discard remains recoverable through a repeated user action.
- Brand Style maps tone preferences to pixel adjustments with a small deterministic rule set; it is an explainable product heuristic over user preferences, not a measured visual-identity model.
- P5-04 local providers are deterministic development implementations; production AI/image providers and measured subject-aware cropping are not configured. Long confirmed text may overflow the narrowest creative templates, and Feed/Square can duplicate a 1:1 choice; these are non-blocking UX follow-ups.

## Next task

P5-04 Social Variants + Creative Campaign is complete. P5-05 Phase 5 Integration Review is READY. Phase 5.5A Calendar Workspace & Dashboard Simplification and P5.5B Mobile Navigation & Capture-First UX remain documentation-only future work.
