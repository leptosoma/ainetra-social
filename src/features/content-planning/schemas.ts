import { z } from "zod";
import { goalTypes } from "@/features/business-brain/schemas";

export const CONTENT_PLANNING_PROMPT_VERSION = "content-planning-v1";

export const contentPillars = [
  "PRODUCT", "ATMOSPHERE", "PEOPLE", "SOCIAL_PROOF", "EDUCATIONAL", "PROMOTIONAL",
  "BEHIND_THE_SCENES", "EVENT", "COMMUNITY", "TREND",
] as const;

export const mediaRequirements = [
  "PHOTO_PRODUCT", "PHOTO_ATMOSPHERE", "PHOTO_PEOPLE", "VIDEO_VERTICAL", "VIDEO_KITCHEN",
  "CUSTOM_GRAPHIC", "NO_NEW_MEDIA_REQUIRED",
] as const;

export const platformSettingSchema = z.object({
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"]),
  enabled: z.boolean(),
  weeklyFrequency: z.number().int().min(1).max(14),
  contentTypes: z.array(z.enum(["POST", "REEL", "STORY", "CAROUSEL"])).min(1).max(4),
}).strict();

export const mixEntrySchema = z.object({
  pillar: z.enum(contentPillars),
  percentage: z.number().int().min(0).max(100),
}).strict();

export const strategyInputSchema = z.object({
  mode: z.enum(["AINETRA_RECOMMENDED", "CUSTOM"]),
  platformSettings: z.array(platformSettingSchema).min(1).max(3),
  contentMix: z.array(mixEntrySchema).min(2).max(contentPillars.length),
  languages: z.array(z.string().trim().regex(/^[a-z]{2}$/i)).min(1).max(8),
}).strict().superRefine((value, context) => {
  if (!value.platformSettings.some((entry) => entry.enabled)) context.addIssue({ code: "custom", message: "En az bir platform seçilmelidir.", path: ["platformSettings"] });
  if (new Set(value.platformSettings.map((entry) => entry.platform)).size !== value.platformSettings.length) context.addIssue({ code: "custom", message: "Platformlar benzersiz olmalıdır.", path: ["platformSettings"] });
  if (new Set(value.contentMix.map((entry) => entry.pillar)).size !== value.contentMix.length) context.addIssue({ code: "custom", message: "İçerik sütunları benzersiz olmalıdır.", path: ["contentMix"] });
  if (value.contentMix.reduce((sum, entry) => sum + entry.percentage, 0) !== 100) context.addIssue({ code: "custom", message: "İçerik karışımı toplamı 100 olmalıdır.", path: ["contentMix"] });
  if (value.platformSettings.filter((entry) => entry.enabled).reduce((sum, entry) => sum + entry.weeklyFrequency, 0) > 20) context.addIssue({ code: "custom", message: "Etkin platformlarda haftalık toplam en fazla 20 içerik olabilir.", path: ["platformSettings"] });
});

const planItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recommendedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"]),
  contentType: z.enum(["POST", "REEL", "STORY", "CAROUSEL"]),
  pillar: z.enum(contentPillars),
  businessGoal: z.enum(goalTypes),
  topic: z.string().trim().min(3).max(180),
  concept: z.string().trim().min(8).max(500),
  hookCategory: z.string().trim().min(2).max(80),
  hook: z.string().trim().min(3).max(220),
  captionDirection: z.string().trim().min(8).max(500),
  cta: z.string().trim().min(2).max(220),
  language: z.string().trim().regex(/^[a-z]{2}$/i),
  mediaRequirement: z.enum(mediaRequirements),
  reasoning: z.string().trim().min(8).max(240).refine((value) => !/(chain[- ]?of[- ]?thought|düşünce sürecim|adım adım düşündüm|internal reasoning)/i.test(value), "Yalnız kısa kullanıcı gerekçesi verilebilir."),
  platformRulesApplied: z.array(z.string().trim().min(2).max(160)).max(12),
}).strict();

export const planningOutputSchema = z.object({
  meta: z.object({ promptVersion: z.literal(CONTENT_PLANNING_PROMPT_VERSION) }).strict(),
  planPeriod: z.enum(["SEVEN_DAYS", "THIRTY_DAYS"]),
  strategySummary: z.string().trim().min(8).max(600),
  platformStrategies: z.array(z.object({
    platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"]),
    objective: z.string().trim().min(3).max(240),
    weeklyFrequency: z.number().int().min(1).max(14),
    rationale: z.string().trim().min(8).max(240),
  }).strict()).min(1).max(3),
  contentMix: z.array(mixEntrySchema).min(2).max(contentPillars.length),
  contentItems: z.array(planItemSchema).min(1).max(90),
}).strict();

export type StrategyInput = z.infer<typeof strategyInputSchema>;
export type PlanningOutput = z.infer<typeof planningOutputSchema>;
export type PlanningItem = z.infer<typeof planItemSchema>;
