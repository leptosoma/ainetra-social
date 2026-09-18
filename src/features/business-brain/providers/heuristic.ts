import { BUSINESS_BRAIN_PROMPT_VERSION, type BusinessBrainExtraction, type ExtractedField } from "../schemas";
import type { BusinessBrainExtractionProvider, BusinessBrainProviderInput } from "./types";

function field<T>(value: T, confidence: number, source: "WEBSITE", sourceReference?: string, evidence?: string): ExtractedField<T> {
  return { value, confidence, source, ...(sourceReference ? { sourceReference } : {}), ...(evidence ? { evidence } : {}) };
}

function detectLanguages(text: string, sourceUrl: string) {
  const result: ExtractedField<string>[] = [];
  if (/[çğıöşüİ]/i.test(text) || /\b(ve|için|ile|hizmet|hakkımızda)\b/i.test(text)) {
    result.push(field("tr", 0.82, "WEBSITE", sourceUrl, text.slice(0, 240) || "Türkçe"));
  }
  if (/\b(the|and|for|our|about|services|welcome)\b/i.test(text)) {
    result.push(field("en", 0.75, "WEBSITE", sourceUrl, text.slice(0, 240) || "English"));
  }
  return result;
}

export class HeuristicBusinessBrainProvider implements BusinessBrainExtractionProvider {
  readonly provider = "local";
  readonly model = "grounded-heuristic-v1";

  async extract(input: BusinessBrainProviderInput): Promise<BusinessBrainExtraction> {
    const document = input.websiteDocument;
    const evidence = document?.description || document?.title || "";
    const description = evidence && document
      ? field(evidence, document.description ? 0.92 : 0.72, "WEBSITE", document.sourceUrl, evidence)
      : null;
    return {
      meta: { promptVersion: BUSINESS_BRAIN_PROMPT_VERSION },
      description,
      productsServices: [],
      targetAudience: null,
      languages: document ? detectLanguages(document.text, document.sourceUrl) : [],
      brandTone: null,
      brandPersonality: null,
      locationContext: null,
      facts: [],
      restrictions: [],
      avoidWords: [],
      brandNotes: [],
      unknowns: ["productsServices", "targetAudience", "brandTone", "contentRestrictions", "avoidWords"],
      suggestedGoals: [],
    };
  }
}
