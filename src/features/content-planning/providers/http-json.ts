import "server-only";

import { CONTENT_PLANNING_PROMPT_VERSION } from "../schemas";
import type { ContentPlanningProvider, ContentPlanningProviderInput } from "./types";

export class HttpJsonContentPlanningProvider implements ContentPlanningProvider {
  readonly provider = "http-json";

  constructor(private readonly endpoint: string, private readonly apiKey: string, readonly model: string) {}

  async generate(input: ContentPlanningProviderInput): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ model: this.model, promptVersion: CONTENT_PLANNING_PROMPT_VERSION, prompt: input.prompt, responseFormat: "json" }),
        });
        if (!response.ok) throw new Error(`PLANNING_PROVIDER_HTTP_${response.status}`);
        const text = await response.text();
        if (text.length > 500_000) throw new Error("PLANNING_PROVIDER_RESPONSE_TOO_LARGE");
        const parsed = JSON.parse(text) as { output?: unknown };
        return parsed.output ?? parsed;
      } catch (error) {
        lastError = error;
        if (attempt === 1) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
