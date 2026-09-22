# P5-02 — Safe Enhance

## TASK

Implement only P5-02 in the real repository. Turn a supported uploaded image into an authenticity-preserving enhanced derivative, keep the original immutable, and let the user review, keep, or discard each result.

## WHY

Ainetra should improve real business media for practical social use without inventing or materially changing products, portions, people, interiors, scenery, services, or business conditions.

## READ

- `CLAUDE.md`
- `TASKS.md`
- `docs/product-bible.md`
- `claude-tasks/P5-01-visual-analysis.md`
- Only the existing media, storage, visual-analysis, authorization, transaction/concurrency, and UI files directly required by P5-02.

## IMPLEMENT

- Minimal, versioned Safe Enhance persistence linked to the source `MediaAsset`, derived output asset, business, preset, status/decision, provider/model, REAL/DEVELOPMENT provenance, parameter/preset version, timestamps, and triggering/deciding user where appropriate.
- Preserve the original `MediaAsset` row and bytes exactly. Store every successful output as a separate, usable derived media asset; reruns keep prior history and never silently replace the original.
- Small vendor-neutral `ImageTransformProvider` boundary. No real transform credential is currently configured, so implement an explicitly labeled deterministic local development provider using `sharp`; never present it as generative or real AI.
- Simple operational presets only: `NATURAL`, `BRIGHT`, `CLEAN`, `WARM`. Use conservative brightness/exposure, contrast, white-balance/color, saturation, sharpness, noise/compression operations. Do not implement Brand Style. Crop/reframe only if the existing UX explicitly requests safe crop; do not add social variants.
- Validate provider output and decoded output metadata before valid persistence. Provider/validation/storage failure must not alter the original or create a valid kept derivative.
- Respect P5-01 authenticity metadata. Safe Enhance may make only pixel-level technical adjustments; authenticity-sensitive input must remain authenticity-sensitive and must never invoke generative/object/scene operations.
- Server-side membership checks for create/read/keep/discard. A user cannot access or decide another tenant's enhancement.
- Transaction-safe/idempotent active-work semantics: concurrent identical requests for the same source and preset must not create duplicate active jobs or conflicting current state. Completed reruns create distinct versioned outputs.
- Review UX from Media / Visual Analysis detail: original and enhanced preview/compare, preset, authenticity-preserved message, provider/provenance, creation time, and explicit Keep/Discard actions. Keeping a result marks that result usable without replacing/deleting the original. Discarding must not delete or corrupt the original.
- Never read analysis as canonical Business Brain truth and never mutate BusinessAttribute, BrandProfile, goals, or other confirmed facts.

## DO NOT

- Do not implement Brand Style, Creative Campaign, generative fill, background/object replacement or generation, fake relighting, scene reconstruction, image-to-video, publishing, analytics, Intent Engine, Sales, Lead Radar, or social-format variants beyond a strictly requested safe crop.
- Do not redesign the media library, add a paid service, fake AI provenance, expose raw provider payload, or refactor Phase 1–4/P5-01.

## TEST

Cover original row/byte immutability; source/derivative provenance and valid metadata; tenant isolation for create/read/keep/discard; unsupported media; authenticity-sensitive handling; invalid provider output; provider/storage failure; explicit DEVELOPMENT/local labeling; versioned reruns and preserved history; concurrent identical-request deduplication; correct business ownership; Business Brain non-mutation; both original and kept output remaining usable; and user-friendly review state.

## DONE WHEN

P5-02 domain behavior, local provider, persistence/migration, focused review UI, and targeted tests pass. The original stays immutable, every derivative is traceable, authenticity policy and tenancy hold, concurrency is safe, provider labeling is honest, and no P5-03 behavior exists. Report only `FILES CHANGED`, `SCHEMA CHANGES`, `BEHAVIOR`, `TESTS`, and `KNOWN LIMITATIONS`.
