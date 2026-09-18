import "server-only";

import { BUSINESS_BRAIN_PROMPT_VERSION } from "../schemas";
import type { BusinessBrainExtractionProvider, BusinessBrainProviderInput } from "./types";

export class HttpJsonBusinessBrainProvider implements BusinessBrainExtractionProvider {
  readonly provider = "http-json";

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async extract(input: BusinessBrainProviderInput): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          promptVersion: BUSINESS_BRAIN_PROMPT_VERSION,
          prompt: input.prompt,
          responseFormat: "json",
        }),
      });
      if (!response.ok) throw new Error(`AI_PROVIDER_HTTP_${response.status}`);
      const text = await response.text();
      if (text.length > 250_000) throw new Error("AI_PROVIDER_RESPONSE_TOO_LARGE");
      const parsed = JSON.parse(text) as { output?: unknown };
      return parsed.output ?? parsed;
    } finally {
      clearTimeout(timeout);
    }
  }
}
