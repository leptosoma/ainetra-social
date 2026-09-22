# Current State

Updated: 2026-09-22

- Branch: `feature/capture-fallback`
- Verified product baseline: `phase-4-complete`.
- Validation: 153/153 Vitest tests pass; lint and production build pass; npm audit reports 0 vulnerabilities.
- Development database: all 9 migrations applied; `prisma migrate status` reports that the schema is up to date.
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

## Incomplete modules and debt

- Verified social proof has no production data source yet, so the fallback engine safely skips that rank rather than inventing evidence.
- Content Stock uses deterministic greedy allocation and can conservatively undercount in complex multi-tag inventories; review optimal matching before scale if product data shows a need.
- Abandoned `PENDING` visual-analysis attempts do not yet have timeout/recovery handling; add this before introducing an asynchronous production provider.
- Photo aspect-ratio recommendations are defined in the seed as manual Ainetra guidance and are not applied automatically by the migration.

## Next task

P5-01 Visual Analysis Foundation is complete. P5-02 Safe Enhance is READY but has not started; P5-03 through P5-05 remain queued.
