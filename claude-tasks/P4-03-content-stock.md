# TASK

P4-03 Content Stock

## WHY

The business needs an explainable answer to whether its authentic media can cover upcoming active content-plan requirements. P4-02 now provides real usage history for reuse-aware inventory decisions.

## RELEVANT FILES

- `CLAUDE.md`
- `docs/product-bible.md`
- `TASKS.md`
- `prisma/schema.prisma`
- `src/features/media-usage/service.ts`
- `src/features/content-planning/service.ts`
- `src/features/capture-engine/service.ts`
- `src/app/(app)/dashboard/page.tsx`
- Directly related tests and UI styles only when needed.

## REQUIREMENTS

- Implement deterministic, service-level Content Stock computation; do not add a persisted score/table unless strictly necessary.
- Use same-business MediaAsset inventory, MediaUsage history, and upcoming ACTIVE requirements from non-superseded plans.
- Report `HEALTHY`, `LOW`, or `CRITICAL`, covered/upcoming item counts, and missing quantities grouped by media requirement.
- Make the calculation simple and explainable; any numeric completeness is operational coverage, not a performance/quality score.
- Do not double-count one media asset as simultaneously covering incompatible upcoming needs. Respect media type/tag suitability and expose the assumptions in concise code/API semantics.
- Preserve tenant isolation and plan/version safety. Ignore superseded/replaced/stale plan items and foreign-business data.
- Add a small dashboard summary with a link to the capture list/content plan, using the existing UI language.
- Add focused tests for status thresholds, requirement aggregation, MediaUsage-aware inventory/reuse behavior, tenant isolation, and stale/superseded plan exclusion.

## DO NOT

- Do not implement fallback suggestions, fallback acceptance, publishing, Visual Intelligence, image/video transformation, analytics, or unrelated refactors.
- Do not invent media quality or social-performance claims.
- Do not modify P4-02 usage semantics unless a verified correctness issue directly blocks stock computation.

## TESTS

- Fully covered upcoming items return `HEALTHY` with correct counts.
- Partial coverage returns `LOW`; zero coverage with upcoming requirements returns `CRITICAL`.
- Missing quantities are correct by requirement and one asset is not over-allocated.
- Recently/previously used media is handled by an explicit deterministic policy without being treated as unavailable unless the policy says so.
- Foreign-business media/usages and superseded/replaced plan items do not affect results.
- Membership-checked entry point rejects cross-tenant reads.
- Existing P4-01/P4-02 and Phase 1–3 tests remain green.

## DONE WHEN

The focused service, dashboard summary, and tests are implemented directly in the current repository; targeted tests pass; and Claude reports changed files, behavior, tests, and known limitations. Do not start P4-04.
