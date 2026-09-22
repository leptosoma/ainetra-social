# Ainetra Social Product Bible

## Product vision

Ainetra Social is an AI-powered social media manager for small and medium businesses. It is not primarily a scheduler, Canva clone, caption generator, or generic chatbot. Its promise is to understand the business, plan what to publish, explain what content to capture, turn real material into brand-ready assets, publish, measure, learn, and improve the next plan.

The MVP serves restaurants, cafes, and bars. The core domain must later support hotels, beauty businesses, clinics, real estate, retail, and other sectors without embedding sector-specific rules in shared domain logic.

## Product experience principle

**Complex engine, simple surface.** Ainetra may become more sophisticated internally while its interface becomes simpler. Each screen should make the user's next natural action obvious and translate internal concepts into human language. Prefer “Bu içerik için bir fotoğraf gerekiyor” over `MISSING_MEDIA`; customers should not need to understand Content Stock, Fallback Engine, Capture Engine, Business Brain, or provider internals to act.

## Core loop

Business Brain → Goals → Platform Intelligence → Content Planning → Content Capture → Content Stock → Fallback → Visual Intelligence → Approval → Publishing → Analytics → Learning → improved planning.

## Domain rules

### Business Brain and goals

- Canonical confirmed information outranks new inference.
- Preserve provenance and the states `CONFIRMED`, `INFERRED`, `NEEDS_CONFIRMATION`, and `REJECTED`.
- Never silently overwrite user-confirmed data.
- Allow one primary goal and at most two secondary goals.
- Content should have a clear reason and, where possible, a business goal.

### Platform intelligence and planning

- Platform rules must be sourced, updateable, and distinguish technical requirements, official guidance, and Ainetra recommendations.
- Instagram, Facebook, and TikTok are separate platforms with distinct rules.
- Each plan item must state its goal, platform, pillar, format, language, CTA, media requirement, and recommendation rationale.
- User strategy overrides outrank later AI recommendations.

### Capture Engine

Businesses often forget to capture media or do not know what to capture. Ainetra must provide a simple, actionable request such as: “For Friday's Reel I need an 8–12 second vertical terrace video.” The promise is: “Take it with your phone. Ainetra handles the rest.” Staff upload links, QR upload, and live camera guidance are future work.

### Content Stock

Content Stock answers whether usable media can fulfil upcoming plans. Show an explainable operational status: `HEALTHY`, `LOW`, or `CRITICAL`, plus covered/upcoming counts and missing requirements. It is an operational completeness metric, not a scientific performance score.

### Content Fallback

When required media is missing, prefer:

1. New or unused authentic business media.
2. Older unused authentic media.
3. Reusable authentic media with recency protection.
4. Format adaptation recommendations.
5. Confirmed business-information content.
6. Verified social proof, only when real data exists.
7. Brand creative placeholders.
8. Future generative creative.

Never invent products, prices, campaigns, reviews, events, services, or business conditions. Fallback must not silently mutate an approved plan. User acceptance is required.

### Approval, publishing, and learning

- The current product is approval-first; future modes may be `COPILOT`, `APPROVAL`, and `AUTOPILOT`.
- Plan approval, content/version approval, and publishing state are separate.
- Export is not publication. Publishing failures must never create a false published state.
- Future learning follows Data → Insight → Action and should change later planning rather than merely display vanity metrics.

## Visual authenticity

Phase 5 introduces `SAFE_ENHANCE`, `BRAND_STYLE`, and `CREATIVE_CAMPAIGN` as distinct modes. AI may improve lighting, color, contrast, sharpness, noise, crop, perspective, minor distractions, platform composition, and brand presentation. It must not silently invent products, ingredients, portions, views, interiors, people, services, results, or business conditions, or materially alter factual product/service appearance. Authenticity restrictions are domain policy, not prompt wording alone.

Visual analysis is media metadata and context. It never becomes canonical Business Brain truth without existing confirmation or explicit user confirmation. Real-provider analysis and development/demo analysis must be visibly distinguishable. Provider output must be normalized and validated before persistence, and re-analysis must preserve an unambiguous current version without event-sourcing complexity.

## Future shared capability — Ainetra Intent Engine

The future Ainetra Intent Engine may serve Ainetra Social by detecting public social intent signals and Ainetra Sales by turning user-accepted opportunities into leads and pipeline. This is a future architecture note only. Phase 5 does not implement Intent Engine, Sales, or Lead Radar behavior.

## Future Ainetra product family

- **Ainetra Social:** social planning, content, media, publishing, and social growth.
- **Ainetra Sales:** prospects, leads, opportunities, pipeline, follow-up, and AI-assisted sales workflows.
- **Ainetra Serve:** a separate restaurant operations and guest-service product for QR/NFC menus, table and guest workflows, assisted upsell, service requests, and future POS integrations. Serve is not fundamentally a Sales module or a Social lead-capture module.
- **Ainetra Control:** the internal control plane for tenants, businesses, packages, feature activation, AI providers and usage, quotas, entitlements, and platform administration.

A future Ainetra Core may contain only proven shared capabilities such as tenant/organization, identity, membership and roles, appropriate business knowledge, AI provider usage, entitlements, audit, and shared integration contracts. Do not merge current codebases or extract a shared Core prematurely. Complete Social first, develop Sales afterward, and extract common components only when real cross-product requirements exist.
