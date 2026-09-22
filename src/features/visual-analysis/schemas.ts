import { z } from "zod";

// P5-01 Görsel Analiz sözleşmesi. Sağlayıcı çıktısı (providerOutputSchema) ile kullanıcıya
// sunulan normalize sonuç (visualAnalysisResultSchema) birbirinden ayrıdır: sağlayıcı yalnızca
// gözlem verir; boyut/oran/platform uyumu/özgünlük/önerilen adım servis tarafında kural olarak
// hesaplanır. Ham sağlayıcı yükü hiçbir zaman saklanmaz; bilinmeyen alanlar ayıklanır.

export const VISUAL_ANALYSIS_VERSION = "visual-analysis-v1";

export const visualCategories = ["FOOD", "DRINK", "INTERIOR", "EXTERIOR", "PEOPLE", "TEAM", "PRODUCT", "SERVICE", "EVENT", "GRAPHIC", "OTHER", "UNKNOWN"] as const;
export const imageKinds = ["PHOTO", "GRAPHIC", "UNKNOWN"] as const;
export const lightingObservations = ["DARK", "BALANCED", "BRIGHT", "UNKNOWN"] as const;
export const framingObservations = ["TIGHT", "BALANCED", "WIDE", "UNKNOWN"] as const;
export const backgroundObservations = ["CLEAN", "BUSY", "UNKNOWN"] as const;
export const sharpnessObservations = ["SOFT", "ACCEPTABLE", "SHARP", "UNKNOWN"] as const;
export const resolutionLevels = ["LOW", "MEDIUM", "HIGH"] as const;
export const qualityLevels = ["LOW", "MEDIUM", "GOOD"] as const;
export const orientations = ["PORTRAIT", "LANDSCAPE", "SQUARE"] as const;
export const platformFits = ["FIT", "CROP_NEEDED"] as const;
export const recommendedActions = ["USE_AS_IS", "SAFE_ENHANCE_CANDIDATE", "CROP_FOR_PLATFORM", "RECAPTURE", "REVIEW_MANUALLY"] as const;

const shortNote = z.string().trim().min(1).max(200);

/** Sağlayıcıdan beklenen ham gözlem sözleşmesi. Tanınmayan alanlar zod tarafından ayıklanır. */
export const providerOutputSchema = z.object({
  imageKind: z.enum(imageKinds),
  dominantSubject: z.string().trim().min(1).max(160),
  category: z.enum(visualCategories),
  confidence: z.number().min(0).max(1),
  lighting: z.enum(lightingObservations),
  framing: z.enum(framingObservations),
  background: z.enum(backgroundObservations),
  sharpness: z.enum(sharpnessObservations),
  peopleVisible: z.boolean().nullable(),
  notes: z.array(shortNote).max(4).default([]),
});

export type ProviderOutput = z.infer<typeof providerOutputSchema>;

export const platformFitSchema = z.object({
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"]),
  contentType: z.enum(["POST", "REEL", "STORY", "CAROUSEL"]).nullable(),
  fit: z.enum(platformFits),
  recommendedAspectRatio: z.string().min(1).max(12),
  ruleKey: z.string().min(1).max(120),
  recommendationType: z.enum(["TECHNICAL_REQUIREMENT", "BEST_PRACTICE", "GENERAL_RECOMMENDATION", "BUSINESS_LEARNED"]),
});

/** Kullanıcıya sunulan ve MediaAnalysis.result olarak saklanan normalize sonuç. */
export const visualAnalysisResultSchema = z.object({
  schemaVersion: z.literal(VISUAL_ANALYSIS_VERSION),
  imageKind: z.enum(imageKinds),
  dominantSubject: z.string().trim().min(1).max(160),
  category: z.enum(visualCategories),
  categoryConfidence: z.number().min(0).max(1),
  dimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  orientation: z.enum(orientations),
  aspectRatio: z.object({ value: z.number().positive(), label: z.string().min(1).max(12) }),
  quality: z.object({
    overall: z.enum(qualityLevels),
    resolution: z.enum(resolutionLevels),
    sharpness: z.enum(sharpnessObservations),
  }),
  observations: z.object({
    lighting: z.enum(lightingObservations),
    framing: z.enum(framingObservations),
    background: z.enum(backgroundObservations),
    notes: z.array(shortNote).max(4),
  }),
  platformFit: z.array(platformFitSchema).max(24),
  authenticity: z.object({ sensitive: z.boolean(), reason: z.string().min(1).max(300) }),
  recommendedAction: z.enum(recommendedActions),
  recommendedActionReason: z.string().min(1).max(300),
});

export type VisualAnalysisResult = z.infer<typeof visualAnalysisResultSchema>;
export type PlatformFitEntry = z.infer<typeof platformFitSchema>;
