# P5-03 — Brand Style

## TASK

Implement only P5-03 in the real repository. Derive a simple, explainable visual-style recommendation from the existing user-maintained `BrandProfile`, apply an authenticity-preserving style transformation to an eligible image, store a traceable derivative, and require explicit user keep/discard review.

## WHY

Ainetra should make real business media visually consistent with the business's established character without turning it into a generic filter, inventing visual facts, or exposing internal image-processing complexity.

## READ

- `CLAUDE.md`
- `TASKS.md`
- `docs/product-bible.md`
- `claude-tasks/P5-02-safe-enhance.md`
- Only the existing BrandProfile/Business Brain, visual-analysis, Safe Enhance, media/storage, authorization, concurrency, and focused media UI files required by P5-03.

## IMPLEMENT

- Reuse P5-02 derivative, storage, validation, provider, and review patterns through composition. Do not create a parallel transformation stack or duplicate Safe Enhance infrastructure.
- Normalize the existing `BrandProfile.toneDimensions` (`corporateFriendly`, `minimalVibrant`, `luxuryAccessible`, `modernNatural`, `seriousPlayful`) into a small versioned visual-style profile and an understandable Turkish recommendation/rationale. Treat values as user preferences, not scientific measurements. Do not expose raw values or internal field names in UI.
- Provide only a very small set of understandable choices: recommended “Markama göre” plus restrained natural, vibrant, and premium alternatives where appropriate. These are Brand Style choices, not P5-04 campaigns.
- Only the existing user-maintained BrandProfile is authoritative. Missing/incomplete profiles must fail gracefully or use an explicitly neutral behavior. Visual analysis may restrict suitability but must never create/update BrandProfile, BusinessAttribute, goals, or canonical facts.
- Authenticity policy has absolute precedence. Derive stricter bounded pixel operations for authenticity-sensitive categories/results; reject any style request that cannot fit the closed safe-operation contract. Never allow object/scene/subject generation, replacement, removal, factual product-color shifts, synthetic relighting, overlays, or campaign design.
- Permit explicit lineage from an original upload or a kept Safe Enhance derivative, while keeping every source row and byte immutable. Do not overwrite Safe Enhance outputs or prior Brand Style outputs; do not create ambiguous chains or restyle a Brand Style output.
- Persist enough versioned provenance for business/tenant, source asset, source Safe Enhance lineage if present, source/current analysis context, BrandProfile identity and `updatedAt`/snapshot used, style/profile version, provider/model and REAL/DEVELOPMENT provenance, bounded operations, status/decision, output metadata/asset, timestamps, and triggering/deciding user. Historical outputs must remain unchanged when BrandProfile later changes.
- Use the existing deterministic `development-sharp-local` transform provider unless a real configured provider already exists. Label local processing honestly and never call it generative AI.
- Validate provider bytes, format, dimensions, and output metadata before valid persistence. Provider/storage/database failures must not corrupt sources. Preserve P5-02's recoverable storage lifecycle.
- Enforce membership and tenant ownership for recommend/create/read/preview/keep/discard. Concurrent identical active requests must collapse safely; decided reruns create new versioned outputs and preserve history.
- Add a focused “Markama göre düzenle” experience to the current media/analysis detail flow: simple recommendation, small alternatives, original/result comparison, authenticity message, provenance label, created time, Keep/Discard. Do not redesign navigation or the media library.

## DO NOT

- Do not implement P5-04 Creative Campaign, overlays/posters, generative redesign/fill, background/object replacement, product generation, fake scenery/people/interiors, image-to-video, social variants, Phase 5.5 calendar/UX redesign, publishing/Postiz/FullCalendar, analytics, Intent Engine, Sales, Serve, Control, or shared Core extraction.
- Do not add a second BrandProfile system, mutate canonical Business Brain state, add a paid provider, expose raw parameters/provider payload/reasoning traces, refactor Phase 1–4/P5-01/P5-02, or describe deterministic local processing as AI.

## TEST

Cover correct BrandProfile/tenant context; cross-tenant create/read/keep/discard/preview rejection; BrandProfile and Business Brain non-mutation; original and kept Safe Enhance source immutability; explicit lineage/provenance; stricter authenticity-sensitive operations and authenticity-over-style rejection; invalid/provider/storage failure safety; honest DEVELOPMENT labeling; versioned reruns/history; concurrent identical-request deduplication; historical BrandProfile snapshot stability after profile changes; accepted output usability without source deletion; UNKNOWN/incomplete profile behavior; understandable UI recommendation without raw internals; and unsupported media rejection.

## DONE WHEN

P5-03 recommendation, transformation lifecycle, persistence/migration, focused review UI, and targeted tests pass. Authenticity outranks style, sources remain immutable, lineage and BrandProfile context are historical and tenant-safe, the provider label is honest, no Business Brain facts change, no P5-04 behavior exists, and P5-02 infrastructure is reused rather than duplicated. Report only `FILES CHANGED`, `SCHEMA CHANGES`, `BEHAVIOR`, `TESTS`, and `KNOWN LIMITATIONS`.
