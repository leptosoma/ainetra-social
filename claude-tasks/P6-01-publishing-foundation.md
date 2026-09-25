# P6-01 — Publishing Domain Foundation

Status: DONE (implemented in the P6-01 commit). Primary developer: Claude after a separate implementation request. Codex reviews and runs QA. This packet is planning only; do not start P6-02.

Read `CLAUDE.md`, `AGENTS.md`, `docs/product-bible.md`, the Phase 6 section of `docs/roadmap.md`, `docs/current-state.md`, and `docs/oss-architecture-spike.md` (publishing ownership/security). Inspect only `src/features/publishing/service.ts`, `src/features/content/service.ts`, `src/features/approval/service.ts`, `src/test/domain-rules.test.ts`, the relevant `SocialAccount`/`ContentVariant`/`Approval`/`ScheduledPost`/`PublishAttempt`/`MediaAsset` Prisma models, and direct dependencies. Follow the local Next.js docs rule if touching Next.js code.

## Exact scope

Build an **internal, provider-neutral publishing foundation** in Ainetra PostgreSQL. Add a typed Ainetra-owned `PublishingAdapter` contract, durable publish-intent/outbox model, immutable approved-content snapshot, attempt/evidence model, transition rules, and an idempotent `requestPublishIntent` domain command. Keep existing schedule/approval behavior and P5.5 calendar semantics. This task makes **no external API call**, runs no worker, connects no Meta account, and exposes no new customer publish button. An existing `ScheduledPost` is not automatically enqueued or backfilled merely because the migration runs; the new command must be invoked explicitly by later Phase 6 flows.

## Existing domain to reuse

- `scheduleContentVariant` already checks membership, future time, account business, and current-version approval inside a Serializable transaction; `ScheduledPost` is the schedule record.
- `updateContentVariant` increments version and invalidates `SCHEDULED` posts in the same transaction. A pending intent for such a post must also become non-dispatchable atomically. Keep old approved snapshots for audit, never use them to publish a changed version.
- `Approval` is unique by variant/version. `PublishAttempt` already exists with `PENDING/SUCCESS/FAILED`; extend compatibly rather than discarding historical rows. Export and `MediaUsage` are not publication.

## Schema and state model

Add a forward-only Prisma migration for a `PublishIntent` (the PostgreSQL outbox row; no second queue table) linked to `ScheduledPost` and tenant. Persist at least: business/account/post IDs, immutable source variant ID/version and approval ID, due time, adapter key/version, generation (initially 1), unique stable idempotency key, versioned snapshot JSON plus deterministic hash, state, timestamps, and nullable provider reference/evidence fields. Constrain `(scheduledPostId, generation)` and idempotency key uniquely; index due `PENDING` work by state/time. Extend `PublishAttempt` only as needed with a nullable intent relation, provider reference, outcome/error class, and `UNKNOWN` semantics while preserving old rows. Do not put OAuth tokens or Postiz-specific IDs in content/calendar rows.

Initial intent states: `PENDING` (durable, not yet sent), `IN_FLIGHT` (leased for a future worker), `UNKNOWN` (send may have reached provider; reconciliation required), `RETRY_WAIT` (definite retryable failure), `PUBLISHED` (provider-confirmed), `FAILED` (definite permanent failure), `CANCELLED`, and `INVALIDATED` (source version/schedule no longer valid). Define legal transitions in one domain module and reject impossible, duplicate, or stale transitions. An expired `IN_FLIGHT` lease is **UNKNOWN**, never automatically safe to retry. `UNKNOWN` cannot transition to retry solely because a timeout elapsed. `ScheduledPost.PUBLISHED` is set only with verified provider evidence; timeout, export, and client assertion are insufficient. P6-01 does not implement claiming or provider-result transitions that require real external evidence; it defines/test-protects the rules for later tasks.

The snapshot is created only from the **current approved version** and freezes the publish-relevant caption, CTA, language, format/content type, platform, selected media identity/provenance, target account, and scheduled time (plus version/approval references). Store no secret/token and no browser-derived business fact. Later content edits do not rewrite it; instead they invalidate the unsent intent. Use a documented snapshot version for future migrations. Ensure a media reference belongs to the same business and a social account matches the business and variant platform. Scope P6-01 preparation to Instagram/Facebook; TikTok remains outside Phase 6.

## Adapter contract (types only)

Define provider-neutral account connection/capability and credential-handle types, media preparation, submit, status lookup/reconciliation, and cancellation interfaces sufficient for P6-02 through P6-05. `submit` takes the immutable snapshot, target account, and stable idempotency key. Normalize outcomes into provider-confirmed publication (with remote post ID/time/URL where available), definitive retryable/permanent rejection, or `UNKNOWN`; retain redacted diagnostics. `getStatus`/reconcile must support searching by known provider reference and idempotency key where the provider permits it. No fake/no-op Meta or Postiz implementation and no token value in client props, logs, snapshot, or adapter result.

## Transaction, idempotency, and security

`requestPublishIntent(userId, scheduledPostId, expectedVersion)` checks membership and re-reads post, variant, current approval, account, platform, and media within one Serializable transaction. The post must still be `SCHEDULED`; the approved version must match both `ScheduledPost.contentVersion` and current variant version. The account must be `CONNECTED`, but that placeholder status alone is not proof of an OAuth credential; P6-02/03 must validate the secret at delivery. Persist snapshot and intent atomically; create no half-intent if any validation fails. Repeated/equivalent or concurrent requests for the same post/generation return the same intent; a changed version/snapshot conflicts, and a new generation cannot be silently created. Use database constraints plus conflict handling, not check-then-insert alone. Never call an external provider inside the transaction. Preserve the current content-edit invalidation transaction by making any pending/in-flight intent non-dispatchable when its post is invalidated; unknown external outcomes remain auditable and must be reconciled rather than erased. Future dispatch must revalidate tenant/account, scheduled-post state, approval/version and snapshot hash before external work.

## Focused tests

- Approved current version produces one durable intent with a stable snapshot/hash and no attempt or external side effect; export does not create an intent or mark publication.
- Unapproved/stale/invalidated/cancelled post, disconnected or mismatched-platform account, foreign business/account/media, and unsupported platform are rejected without an outbox row.
- Repeated and genuinely concurrent requests produce one intent/idempotency key; mismatched expected version conflicts.
- Editing content invalidates schedule and unsent intent without changing snapshot; old approval cannot reactivate it.
- Legal/illegal state transitions and timeout/lease uncertainty: no `PUBLISHED` or definitive `FAILED` from silence, no retry of `UNKNOWN` without reconciliation evidence, no duplicate attempt outcome.
- Migration keeps existing `ScheduledPost`/`PublishAttempt` data valid; no automatic legacy backfill. Existing publishing/domain tests still pass.

## Non-goals

No real Meta OAuth/API, account token storage, Postiz pilot, media transfer, worker execution/retry loop, webhook, customer publish UI, cancel/reschedule flow, analytics, BullMQ/Redis, TikTok, or Phase 7. Do not weaken approval, sector/authenticity, tenancy, or existing schedule invalidation. Do not mark Phase 6 started until implementation is separately authorized.

## Completion criteria and commit

Focused tests pass; full suite, lint, build, npm audit, and Prisma migration status pass under Codex QA; no HIGH tenancy/idempotency/approval/snapshot/uncertainty finding remains. Schema migration is safe for existing rows, task docs then mark P6-01 DONE and P6-02 READY. Expected focused implementation commit: `feat: add publishing domain foundation`.
