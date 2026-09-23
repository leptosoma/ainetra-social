# P5-05 — Phase 5 Integration Review

## TASK

Verify the existing Phase 5 workflow end to end. This is integration/QA, not a feature task. Read `CLAUDE.md`, `TASKS.md`, `docs/product-bible.md`, and only the services/tests directly needed. Preserve P5-01–04 behavior.

## FLOW

Upload → Visual Analysis → Safe Enhance → Brand Style → Social Variant or Creative Campaign → Compare → explicit Keep/Discard → Media Library → Content Stock/Fallback.

## IMPLEMENT ONLY TEST GAPS

- Add focused integration tests where the existing per-feature tests do not prove cross-module behavior. Cover accepted authentic derivative lineage and original immutability; accepted designed-creative separation; MediaAsset usability, Content Stock/Fallback suitability, and no content/publishing approval side effect.
- Verify tenant isolation across the chain, historical versions, provider/provenance honesty, concurrency/idempotency, stale decision handling, and Business Brain non-mutation using existing helpers where feasible. Do not duplicate every per-feature test.
- Test active plan/media requirement compatibility and migration assumptions if directly testable. Report any verified HIGH defect with exact files and reproduction. Do not fix feature code unless Codex returns that defect as a focused correction request.

## DO NOT

Do not add product features, redesign UI, refactor Phase 1–4, start Phase 5.5, Publishing, OAuth, OSS spike, or any later phase. Do not run the full suite, lint, build, audit, or migration status; Codex handles deterministic QA. Do not commit.

## DONE WHEN

Targeted integration tests pass or an exact blocking defect is reported. Return changed files, targeted test command/result, and verified gaps only.
