import type { WebsiteDocument } from "../website";

export type BusinessBrainProviderInput = {
  business: {
    name: string;
    sector: string;
    location: string | null;
    website: string | null;
    instagramHandle: string | null;
  };
  websiteDocument: WebsiteDocument | null;
  prompt: string;
};

export interface BusinessBrainExtractionProvider {
  readonly provider: string;
  readonly model: string;
  extract(input: BusinessBrainProviderInput): Promise<unknown>;
}
