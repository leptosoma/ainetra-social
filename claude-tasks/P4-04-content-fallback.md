# P4-04 — Content Fallback Engine

Implement only P4-04 in the current repository. Read `CLAUDE.md`, `TASKS.md`, `docs/product-bible.md`, and the relevant P4-02/P4-03 implementation before editing.

## Goal

For an active upcoming plan item whose required media is missing, produce a deterministic, explainable fallback proposal without changing the plan until the user explicitly accepts it.

## Acceptance criteria

- Server-side, tenant-isolated fallback proposal and acceptance flow.
- Ranking order: unused authentic media; older unused authentic media; reusable authentic media outside the recent-use protection window; format adaptation; confirmed canonical Business Brain facts; verified social proof only when real verified data exists; brand creative placeholder; otherwise no fallback.
- Use P4-02 MediaUsage data for never-used priority and recent-reuse protection.
- Never invent products, prices, events, campaigns, reviews, services, or operating conditions. Only confirmed canonical Business Brain facts may support information-based fallback.
- Every proposal returns a short rationale and enough source detail to explain the choice.
- Proposal creation never silently mutates an approved plan. Explicit user acceptance is required before applying any change.
- Acceptance is tenant-safe, plan/version safe, idempotent, and concurrency safe. Reject stale, superseded, replaced, cross-tenant, or already-invalid targets.
- Preserve Phase 1–3 behavior and existing P4-01 through P4-03 behavior.
- Add the smallest useful UI entry point consistent with existing patterns so a user can review and accept an eligible proposal.
- Add focused tests covering ranking, MediaUsage recency, confirmed-fact restrictions, no-fallback behavior, tenant isolation, explicit acceptance, stale plan/version rejection, idempotency, and concurrent duplicate acceptance.

## Scope boundaries

- Do not implement Visual Intelligence, image enhancement/generation, video editing, publishing, analytics, learning, trends, or competitor intelligence.
- Do not add fake external integrations or describe deterministic rules as AI.
- Avoid unrelated refactors and destructive schema changes.
- If persistence is necessary, use a minimal safe migration and existing transaction/idempotency patterns.

## Completion report

Return only: `FILES CHANGED`, `SCHEMA CHANGES`, `BEHAVIOR`, `TESTS`, and `KNOWN LIMITATIONS`.
