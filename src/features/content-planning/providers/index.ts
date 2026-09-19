import "server-only";

import { HttpJsonContentPlanningProvider } from "./http-json";
import { LocalContentPlanningProvider } from "./local";
import type { ContentPlanningProvider } from "./types";

export function getContentPlanningProvider(): ContentPlanningProvider {
  const endpoint = process.env.CONTENT_PLANNING_API_URL;
  const apiKey = process.env.CONTENT_PLANNING_API_KEY;
  const model = process.env.CONTENT_PLANNING_MODEL;
  if (endpoint && apiKey && model) return new HttpJsonContentPlanningProvider(endpoint, apiKey, model);
  return new LocalContentPlanningProvider();
}

export type { ContentPlanningProvider, ContentPlanningProviderInput } from "./types";
