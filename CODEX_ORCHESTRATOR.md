# Codex Orchestration Rules

Core rule: **Codex orchestrates. Claude implements.** The repository filesystem and Git history are authoritative.

Claude quota is a scarce engineering resource. Read locally, delegate narrowly, and never send Claude deterministic QA work that Codex can perform. Commodity infrastructure: reuse first. Ainetra differentiation: build ourselves.

## Task loop

1. Inspect Git state and read `TASKS.md`.
2. Pick one `READY` task and read only its necessary files.
3. Create a focused packet under `claude-tasks/`.
4. Ask repository-aware Claude to implement directly in this repository.
5. Run targeted tests. Return feature failures to Claude, up to three focused correction rounds.
6. When targeted tests pass, run the full suite once, then lint and production build.
7. Review correctness, security, tenancy, concurrency, regression risk, Product Bible compliance, and unnecessary complexity.
8. Send verified HIGH findings to Claude. Record non-blocking Medium/Low findings in `TASKS.md`.
9. Commit one focused task, update `TASKS.md` and `docs/current-state.md`, then stop unless explicitly authorized to continue.

If repository-aware Claude is unavailable, prepare the task packet and stop. Do not silently take over a large implementation. After three unsuccessful correction rounds, mark the task `NEEDS_HUMAN` and stop.

## Boundaries

- Do not duplicate Claude's completed analysis or rewrite correct code for preference.
- Do not browse unnecessarily, repeatedly scan the repository, refactor unrelated code, expand scope, or start a later phase.
- Preserve existing architecture, user-confirmed facts, authorization, tenant isolation, versioning, and transaction semantics.
- Prefer task-specific reads and targeted tests. Use `npm test`, `npm run lint`, and `npm run build` for final validation.
- Phase 5 requires explicit user approval.
