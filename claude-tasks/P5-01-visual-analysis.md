# P5-01 — Visual Analysis Foundation

## TASK

Implement only P5-01 in the real repository. Analyze supported uploaded images into validated, explainable visual metadata. Do not transform images.

## WHY

Ainetra must understand whether and how real business media can be used on social platforms while preserving authenticity and keeping visual inference separate from canonical Business Brain facts.

## READ

- `CLAUDE.md`
- `TASKS.md`
- `docs/product-bible.md`
- Existing media, platform-intelligence, Business Brain, provider, authorization, and concurrency patterns directly needed by P5-01.

## IMPLEMENT

- Minimal versioned persistence for MediaAsset analysis with one unambiguous current analysis, status, provider/model, analysis version, timestamps, normalized validated result, and demo/real provenance.
- Broad categories: `FOOD`, `DRINK`, `INTERIOR`, `EXTERIOR`, `PEOPLE`, `TEAM`, `PRODUCT`, `SERVICE`, `EVENT`, `GRAPHIC`, `OTHER`, `UNKNOWN`.
- Normalized result covering photo/graphic classification, dominant subject, orientation/aspect/dimensions, qualitative quality, lighting/framing/background observations, likely content category, platform suitability/crop need, authenticity-sensitive flag/reason, and recommended next action.
- A small vendor-neutral `ImageAnalysisProvider` boundary. Use an existing configured real provider only if credentials and support already exist; otherwise implement an explicit development provider whose UI/result is clearly labeled demo/development. Never fake real AI analysis.
- Validate provider output before valid persistence. Failure must not corrupt MediaAsset or create a valid current analysis.
- Re-analysis with simple version/supersession semantics and transaction-safe concurrency so two active/current analyses cannot exist.
- Server-side membership/tenant enforcement for analyze/read operations.
- Media library summary plus focused media-detail analysis experience using user-friendly Turkish labels, no raw provider payload/model jargon, and no broad redesign.
- Read existing platform rule/context where applicable instead of duplicating rules. Evaluate fit only; do not crop or transform.
- Keep visual analysis as media metadata only. It must never create/update BusinessAttribute, BrandProfile, goals, or canonical Business Brain state.

## DO NOT

- Do not implement enhancement, removal, relighting, generative fill, crop output, upscale, Brand Style output, Creative Campaign, social variant files, image-to-video, publishing, analytics/learning, Intent Engine, Sales, or Lead Radar.
- Do not add a paid service, fake provider result as real AI, expose raw payload, build object-detection research infrastructure, over-engineer provider abstractions, or refactor Phase 1–4.

## TEST

Cover tenant ownership and cross-tenant rejection; invalid/UNKNOWN output; unsupported media; provider failure; dimensions/orientation; platform context; authenticity sensitivity; demo-vs-real provenance; Business Brain non-mutation; user-facing normalized output; re-analysis version/current semantics; and concurrent re-analysis.

## DONE WHEN

P5-01 UI, domain behavior, provider boundary, persistence/migration, and focused tests pass; the implementation is explainable, authenticity-safe, tenant isolated, concurrency safe, and no P5-02 behavior exists. Report only `FILES CHANGED`, `SCHEMA CHANGES`, `BEHAVIOR`, `TESTS`, and `KNOWN LIMITATIONS`.
