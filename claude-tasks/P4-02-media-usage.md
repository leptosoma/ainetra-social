# TASK

P4-02 MediaUsage

## WHY

Content Stock and fallback ranking require trustworthy, tenant-isolated media-use history.

## RELEVANT FILES

- `docs/product-bible.md`
- `TASKS.md`
- `prisma/schema.prisma`
- `src/features/content/service.ts`
- `src/features/media/service.ts`
- `src/features/content-planning/service.ts`
- Existing content/media tests and the capture-engine integration only where directly required.

## REQUIREMENTS

- Use the existing MediaUsage model where suitable; adjust schema and add a safe migration only when acceptance requires it.
- Record actual media use at the correct existing lifecycle boundary; assignment alone must not falsely mean published use.
- Store business, media asset, content or plan relation, platform, usage type/angle, and `usedAt`.
- Enforce tenant isolation, duplicate protection, and concurrency-safe idempotency.
- Provide deterministic queries for never-used status, last-used time, and usage count.
- Preserve Phase 1–4A behavior and add focused tests.

## DO NOT

- Do not implement Content Stock, fallback, publishing, analytics, Visual Intelligence, or unrelated refactors.
- Do not claim export means published.
- Do not weaken server-side authorization or tenancy.

## TESTS

- Records a valid same-business usage once.
- Concurrent duplicate recording creates one logical usage.
- Cross-business media/content combinations are rejected.
- Never-used, last-used, and count queries are correct and tenant isolated.
- Existing content, media, planning, and capture tests remain green.

## DONE WHEN

Implementation and migration are repository-ready, targeted tests pass, and Claude reports changed files, schema, behavior, tests, and limitations. Implement directly in the current repository and do not start another task.
