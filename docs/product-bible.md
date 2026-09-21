# Ainetra Social Product Bible

## Product vision

Ainetra Social is an AI-powered social media manager for small and medium businesses. It is not primarily a scheduler, Canva clone, caption generator, or generic chatbot. Its promise is to understand the business, plan what to publish, explain what content to capture, turn real material into brand-ready assets, publish, measure, learn, and improve the next plan.

The MVP serves restaurants, cafes, and bars. The core domain must later support hotels, beauty businesses, clinics, real estate, retail, and other sectors without embedding sector-specific rules in shared domain logic.

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

Phase 5 may add `SAFE ENHANCE`, `BRAND STYLE`, and `CREATIVE CAMPAIGN`. AI may improve presentation but must not misrepresent reality or invent unavailable products, views, services, portions, or conditions. Phase 5 requires explicit user approval and is not active.
