# P4-05 — Verified Integration Fixes

Fix only the verified Phase 4 integration defects below. Read `CLAUDE.md`, `TASKS.md`, and the relevant Capture Engine files first. Preserve the existing uncommitted `next-env.d.ts` change and do not touch it.

## Defect 1 — current missing requirements are not reconciled

The development database has 39 non-superseded ACTIVE plan items with `MISSING` media and a real media requirement, but zero `CaptureRequest` rows. Plans created before P4-01 therefore never appear in Capture UI. `listCaptureRequests` only expires and lists existing rows; it does not reconcile current plan state.

Minimum required behavior:

- When Capture UI/dashboard lists requests, reconcile current non-superseded ACTIVE missing requirements into CaptureRequest rows using the existing sync rules and business timezone/sector.
- Preserve the DB uniqueness rule and terminal-state policy; repeated or concurrent reconciliation must not create duplicates.
- Do not reopen `DISMISSED` or `EXPIRED` requests automatically.
- Stale/replaced/superseded requests must not be returned as current work and any still-open stale rows should be closed safely.

## Defect 2 — expiry uses the wrong day boundary

`expireDueCaptureRequests` compares a calendar-day `dueAt` directly to the current timestamp. A request due today can expire at the start of that UTC day instead of after the business-local due day ends.

Minimum required behavior:

- Expire only requests whose due calendar day is before today in the business timezone.
- A request due today remains open for the entire business-local day.
- Keep list scopes deterministic and aligned with business-local calendar days.

## Tests

Add focused regression coverage for:

- backfilling current active missing requirements;
- no duplicates under repeated and concurrent reconciliation;
- terminal requests remain terminal;
- stale/replaced/superseded requests are not returned;
- due-today remains open and prior-business-day expires, including a timezone boundary case;
- tenant isolation remains intact.

Do not add features, redesign UI, start Phase 5, or refactor unrelated Phase 1–3 code. Run targeted Capture Engine tests and report only `FILES CHANGED`, `BEHAVIOR`, `TESTS`, and `KNOWN LIMITATIONS`.
