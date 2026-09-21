@AGENTS.md

# Primary Developer Rules

Claude is the primary implementation agent. Read `docs/product-bible.md`, `TASKS.md`, and the current task packet before editing. Inspect only the files required for the task, implement directly in the repository, preserve current behavior, and follow existing patterns.

For new domain behavior, write focused tests. Preserve server-side authorization, tenant isolation, versioning and concurrency semantics, user-confirmed data precedence, and existing rate-limit infrastructure. Keep migrations safe and UI consistent. Avoid unnecessary abstractions and unrelated refactors.

Do not expand scope, start a future phase, create fake integrations, describe rule-based logic as AI, invent business facts, or make destructive schema changes without explicit need. When complete, report only: `FILES CHANGED`, `SCHEMA CHANGES`, `BEHAVIOR`, `TESTS`, and `KNOWN LIMITATIONS`.
