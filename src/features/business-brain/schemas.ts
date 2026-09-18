import { z } from "zod";

export const BUSINESS_BRAIN_PROMPT_VERSION = "business-brain-v1";

export const goalTypes = [
  "RESERVATIONS",
  "FOOT_TRAFFIC",
  "DELIVERY",
  "PRODUCT_SALES",
  "BRAND_AWARENESS",
  "EVENT",
  "FOLLOWER_GROWTH",
] as const;

const extractionSourceSchema = z.enum(["WEBSITE", "INSTAGRAM", "AI_INFERENCE"]);

function fieldValueSchema<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    confidence: z.number().min(0).max(1),
    source: extractionSourceSchema,
    sourceReference: z.string().url().max(500).optional(),
    evidence: z.string().trim().min(1).max(300).optional(),
  }).strict().superRefine((candidate, context) => {
    if (candidate.source === "WEBSITE" && !candidate.evidence) {
      context.addIssue({ code: "custom", message: "Website kaynaklı alan için kanıt metni gereklidir.", path: ["evidence"] });
    }
  });
}

const textField = fieldValueSchema(z.string().trim().min(1).max(400));
const shortTextField = fieldValueSchema(z.string().trim().min(1).max(160));
const languageField = fieldValueSchema(z.string().trim().regex(/^[a-z]{2}$/i));
const scoreField = fieldValueSchema(z.number().int().min(0).max(100));

export const businessBrainExtractionSchema = z.object({
  meta: z.object({ promptVersion: z.literal(BUSINESS_BRAIN_PROMPT_VERSION) }).strict(),
  description: textField.nullable(),
  productsServices: z.array(shortTextField).max(30),
  targetAudience: fieldValueSchema(z.string().trim().min(1).max(240)).nullable(),
  languages: z.array(languageField).max(8),
  brandTone: fieldValueSchema(z.string().trim().min(1).max(240)).nullable(),
  brandPersonality: z.object({
    corporateFriendly: scoreField,
    minimalVibrant: scoreField,
    luxuryAccessible: scoreField,
    modernNatural: scoreField,
    seriousPlayful: scoreField,
  }).strict().nullable(),
  locationContext: fieldValueSchema(z.string().trim().min(1).max(300)).nullable(),
  facts: z.array(fieldValueSchema(z.string().trim().min(1).max(240))).max(20),
  restrictions: z.array(fieldValueSchema(z.string().trim().min(1).max(240))).max(15),
  avoidWords: z.array(fieldValueSchema(z.string().trim().min(1).max(80))).max(20),
  brandNotes: z.array(fieldValueSchema(z.string().trim().min(1).max(240))).max(15),
  unknowns: z.array(z.string().trim().min(1).max(100)).max(15),
  suggestedGoals: z.array(z.object({
    type: z.enum(goalTypes),
    rationale: z.string().trim().min(1).max(240),
    confidence: z.number().min(0).max(1),
  }).strict()).max(5),
}).strict();

export type BusinessBrainExtraction = z.infer<typeof businessBrainExtractionSchema>;
export type ExtractedField<T> = { value: T; confidence: number; source: "WEBSITE" | "INSTAGRAM" | "AI_INFERENCE"; sourceReference?: string; evidence?: string };

export const manualAttributeSchema = z.object({
  category: z.enum([
    "DESCRIPTION", "PRODUCTS_SERVICES", "TARGET_AUDIENCE", "LANGUAGE", "BRAND_TONE",
    "BRAND_PERSONALITY", "LOCATION_CONTEXT", "WEBSITE", "INSTAGRAM_IDENTITY", "FACT",
    "RESTRICTION", "AVOID_WORD", "NOTE",
  ]),
  value: z.string().trim().min(1).max(500),
});

export const editAttributeSchema = z.object({
  attributeId: z.string().cuid(),
  value: z.string().trim().min(1).max(500),
});
