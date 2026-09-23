# P5-04 — Social Variants + Creative Campaign

## TASK

Implement only P5-04 in the real repository: reviewed technical social-format derivatives of accepted authentic media, plus a separately labeled, reviewed designed-creative foundation grounded in confirmed business facts.

## WHY

Users should prepare one real image for supported social formats and make simple branded information creatives without losing authenticity, inventing offers, or confusing media acceptance with content/publishing approval.

## READ

- `CLAUDE.md`, `TASKS.md`, `docs/product-bible.md`, `docs/current-state.md`.
- Existing Platform Intelligence rules, media/storage and derivative lifecycle, P5-01–03 analysis and authenticity, confirmed canonical Business Brain context, Content Stock/Fallback matching, authorization, and directly relevant UI/tests only.
- Relevant Next.js guide under `node_modules/next/dist/docs/` before changing Next.js routes or components, as `AGENTS.md` requires.

## IMPLEMENT

- Keep **SOCIAL_VARIANT** and **CREATIVE_CAMPAIGN** distinct in persisted domain state and UI. An authentic technical derivative remains authentic; a designed creative is explicitly identified as graphic/design, never as real product/team/location photography.
- For supported existing Platform Intelligence platform/content formats, offer simple actions such as Feed, Story, Reel cover, and square when actual rule context permits. Persist platform/format, selected rule key/version or snapshot, immediate/root lineage, source business, provider/model and REAL/DEVELOPMENT provenance, output dimensions/format, version/status/decision/timestamps, and triggering/deciding user. Do not duplicate or invent technical platform requirements.
- Reuse P5-02/P5-03 storage, validation, membership, lifecycle, and local processing patterns with a small provider boundary. Conservative contain/pad or review-needed behavior must protect important photo content when a safe crop cannot be established. Do not claim subject-aware AI cropping from local deterministic processing. Source and prior derivatives remain immutable.
- A kept variant becomes a separate usable MediaAsset after explicit review; discard removes only its own derivative. Concurrent identical active requests deduplicate and decided reruns preserve history. Media acceptance does not approve, schedule, or publish content.
- Create a deliberately small Creative Campaign flow. Offer only creative categories that can be supported by existing confirmed/canonical facts or explicit verified user input. Never invent campaign, discount, price, product, service, event, hours, review, view, availability, or offer conditions. When information is missing, explain the missing fact and do not generate the creative. Use deterministic local brand-colored text/layout rendering if no real provider is configured; label it as local, non-generative work.
- A creative may use an accepted real media asset only with clear lineage and graphic designation. Persist the exact confirmed fact references/snapshot and copy used, business/tenant, optional accepted source, provider/provenance, version/status/decision, and separate output asset. Historical output remains unchanged when facts, rules, copy, or brand settings change.
- Enforce tenant isolation for all create/read/preview/keep/discard operations. Validate provider bytes and output metadata, preserve source immutability, and recover safely from provider/storage/database failures.
- Integrate accepted outputs with existing media/content flows minimally. Ensure designed creatives cannot satisfy media requirements that explicitly demand authentic photo/video evidence. Preserve MediaUsage, Content Stock, Fallback, plan approval and content approval semantics.
- Keep UI simple: “Bunu nerede kullanacaksınız?” and “Ne hazırlayalım?”, relevant choices only, previews, authentic-versus-designed labels, and explicit Keep/Discard.

## DO NOT

- Do not implement P5-05, publishing/OAuth/Postiz, FullCalendar or Phase 5.5 redesign, analytics, autonomous posting, image-to-video, a template marketplace, Intent Engine, Sales, Serve, Control, or shared Core extraction.
- Do not add a paid provider, present local templates as generative AI, invent business facts or platform rules, bypass user review/approval, or refactor unrelated Phase 1–4/P5-01–03 code.

## TEST

Cover correct tenant ownership and cross-tenant denial; immutable original/Safe Enhance/Brand Style sources; immediate/root lineage and platform rule provenance; safe crop/contain behavior; invalid output/provider failure; honest development labels; unsupported media; versioned reruns and concurrent deduplication; kept derivative usability without content/publish approval; confirmed-fact-only creative copy and blocked missing facts; distinct designed-creative metadata; Creative Campaign non-mutation of Business Brain; inability of designed creative to satisfy authentic-media requirements; Content Stock/Fallback compatibility; and concurrency-safe tenant-bound keep/discard.

## DONE WHEN

Both distinct flows, focused UI, persistence/migration, and targeted tests pass. Factual claims are grounded, authentic media stays authentic, designed output is labeled, lineage/versioning and tenancy hold, existing planning/approval behavior is preserved, and no P5-05 or later work exists. Do not commit. Report only `FILES CHANGED`, `SCHEMA CHANGES`, `BEHAVIOR`, `TESTS`, and `KNOWN LIMITATIONS`.
