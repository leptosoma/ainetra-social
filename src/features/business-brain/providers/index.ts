import "server-only";

import { HeuristicBusinessBrainProvider } from "./heuristic";
import { HttpJsonBusinessBrainProvider } from "./http-json";
import type { BusinessBrainExtractionProvider } from "./types";

export function getBusinessBrainProvider(): BusinessBrainExtractionProvider {
  const endpoint = process.env.BUSINESS_BRAIN_API_URL;
  const apiKey = process.env.BUSINESS_BRAIN_API_KEY;
  const model = process.env.BUSINESS_BRAIN_MODEL;
  if (endpoint && apiKey && model) return new HttpJsonBusinessBrainProvider(endpoint, apiKey, model);
  return new HeuristicBusinessBrainProvider();
}

export type { BusinessBrainExtractionProvider, BusinessBrainProviderInput } from "./types";
