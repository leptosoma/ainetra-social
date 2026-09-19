import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  acceptBusinessAttribute,
  acceptSuggestedGoal,
  buildBusinessContext,
  editBusinessAttribute,
  getBusinessBrainState,
  rejectBusinessAttribute,
  runBusinessBrainAnalysis,
} from "@/features/business-brain/service";
import { BUSINESS_BRAIN_PROMPT_VERSION, type BusinessBrainExtraction } from "@/features/business-brain/schemas";
import type { BusinessBrainExtractionProvider } from "@/features/business-brain/providers";
import { fetchWebsiteDocument, validatePublicWebsiteUrl, type WebsiteDocument } from "@/features/business-brain/website";
import { replaceBusinessGoals } from "@/features/goals/service";

async function fixture(website: string | null = null) {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `brain-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `brain-outside-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({ data: { name: "Mimoza", sector: "RESTAURANT", website, memberships: { create: { userId: owner.id, role: "OWNER" } }, brandProfile: { create: {} } } });
  return { owner, outsider, business };
}

function validOutput(overrides: Partial<BusinessBrainExtraction> = {}): BusinessBrainExtraction {
  return {
    meta: { promptVersion: BUSINESS_BRAIN_PROMPT_VERSION },
    description: null,
    productsServices: [],
    targetAudience: null,
    languages: [],
    brandTone: null,
    brandPersonality: null,
    locationContext: null,
    facts: [],
    restrictions: [],
    avoidWords: [],
    brandNotes: [],
    unknowns: [],
    suggestedGoals: [],
    ...overrides,
  };
}

function provider(output: unknown): BusinessBrainExtractionProvider {
  return { provider: "test", model: "fixture-v1", async extract() { return output; } };
}

const websiteDocument: WebsiteDocument = {
  sourceUrl: "https://example.com/",
  fetchedAt: new Date().toISOString(),
  contentHash: "abc123",
  title: "Mimoza",
  description: "Ege mutfağını modern tabaklarla sunan bir restoran.",
  text: "Ege mutfağını modern tabaklarla sunan bir restoran.",
};

async function createAttribute(businessId: string, status: "CONFIRMED" | "INFERRED" | "NEEDS_CONFIRMATION" | "REJECTED", canonical = false) {
  return prisma.businessAttribute.create({
    data: {
      businessId,
      category: "DESCRIPTION",
      key: `description.${crypto.randomUUID()}`,
      value: "Test değeri",
      source: status === "CONFIRMED" ? "USER" : "AI_INFERENCE",
      confidence: status === "CONFIRMED" ? null : 0.8,
      verificationStatus: status,
      isCanonical: canonical,
    },
  });
}

describe("Ainetra Business Brain", () => {
  it("excludes NEEDS_CONFIRMATION attributes from canonical context", async () => {
    const { owner, business } = await fixture();
    await createAttribute(business.id, "NEEDS_CONFIRMATION");
    expect((await buildBusinessContext(owner.id, business.id)).provenance).toHaveLength(0);
  });

  it("includes CONFIRMED canonical attributes in canonical context", async () => {
    const { owner, business } = await fixture();
    await createAttribute(business.id, "CONFIRMED", true);
    expect((await buildBusinessContext(owner.id, business.id)).provenance).toHaveLength(1);
  });

  it("excludes REJECTED attributes from canonical context", async () => {
    const { owner, business } = await fixture();
    await createAttribute(business.id, "REJECTED");
    expect((await buildBusinessContext(owner.id, business.id)).provenance).toHaveLength(0);
  });

  it("gives a confirmed ledger value precedence over the legacy BrandProfile field", async () => {
    const { owner, business } = await fixture();
    await prisma.brandProfile.update({ where: { businessId: business.id }, data: { description: "Eski profil açıklaması" } });
    await prisma.businessAttribute.create({ data: { businessId: business.id, category: "DESCRIPTION", key: "description", value: "Kullanıcının doğruladığı yeni açıklama", source: "USER", verificationStatus: "CONFIRMED", isCanonical: true, confirmedById: owner.id } });
    expect((await buildBusinessContext(owner.id, business.id)).profile.description).toBe("Kullanıcının doğruladığı yeni açıklama");
  });

  it("keeps Business Brain reads and mutations tenant-isolated", async () => {
    const { business, outsider } = await fixture();
    const attribute = await createAttribute(business.id, "INFERRED");
    await expect(getBusinessBrainState(outsider.id, business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(acceptBusinessAttribute(outsider.id, attribute.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not persist attributes when provider output is invalid", async () => {
    const { owner, business } = await fixture();
    const run = await runBusinessBrainAnalysis(owner.id, business.id, { provider: provider({ unexpected: true }), skipRateLimit: true });
    expect(run.status).toBe("INVALID_OUTPUT");
    expect(await prisma.businessAttribute.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("lets a user accept an inference", async () => {
    const { owner, business } = await fixture();
    const attribute = await createAttribute(business.id, "INFERRED");
    const accepted = await acceptBusinessAttribute(owner.id, attribute.id);
    expect(accepted).toMatchObject({ verificationStatus: "CONFIRMED", isCanonical: true, confirmedById: owner.id });
  });

  it("keeps one canonical row under concurrent accepts", async () => {
    const { owner, business } = await fixture();
    const attribute = await createAttribute(business.id, "INFERRED");
    await Promise.allSettled([acceptBusinessAttribute(owner.id, attribute.id), acceptBusinessAttribute(owner.id, attribute.id)]);
    expect(await prisma.businessAttribute.count({ where: { businessId: business.id, key: attribute.key, isCanonical: true } })).toBe(1);
  });

  it("stores a user edit as a new confirmed canonical value", async () => {
    const { owner, business } = await fixture();
    const attribute = await createAttribute(business.id, "INFERRED");
    const edited = await editBusinessAttribute(owner.id, { attributeId: attribute.id, value: "Kullanıcının düzelttiği değer" });
    const original = await prisma.businessAttribute.findUniqueOrThrow({ where: { id: attribute.id } });
    expect(edited).toMatchObject({ value: "Kullanıcının düzelttiği değer", source: "USER", verificationStatus: "CONFIRMED", isCanonical: true });
    expect(original).toMatchObject({ verificationStatus: "REJECTED", isCanonical: false });
  });

  it("lets a user reject an inference", async () => {
    const { owner, business } = await fixture();
    const attribute = await createAttribute(business.id, "INFERRED");
    const rejected = await rejectBusinessAttribute(owner.id, attribute.id);
    expect(rejected).toMatchObject({ verificationStatus: "REJECTED", isCanonical: false });
  });

  it("reuses the existing primary/secondary goal constraints", async () => {
    const { owner, business } = await fixture();
    await replaceBusinessGoals(owner.id, business.id, [{ type: "A", priority: "SECONDARY" }, { type: "B", priority: "SECONDARY" }]);
    const suggestion = await prisma.businessAttribute.create({ data: { businessId: business.id, category: "BUSINESS_GOAL", key: "business_goal.delivery", value: { type: "DELIVERY", rationale: "Test" }, source: "AI_INFERENCE", confidence: 0.8, verificationStatus: "INFERRED" } });
    await expect(acceptSuggestedGoal(owner.id, suggestion.id, "SECONDARY")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects localhost and private network website URLs", async () => {
    await expect(validatePublicWebsiteUrl("http://127.0.0.1:3000/private")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(validatePublicWebsiteUrl("http://localhost/admin")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a public website redirecting to a private address", async () => {
    let requests = 0;
    await expect(fetchWebsiteDocument("https://public.example", {
      resolver: async () => [{ address: "8.8.8.8", family: 4 }],
      transport: async () => {
        requests += 1;
        return { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" }, body: Buffer.alloc(0) };
      },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(requests).toBe(1);
  });

  it("enforces the shared database analysis rate limit", async () => {
    const { owner, business } = await fixture();
    await prisma.businessAnalysisRun.createMany({ data: Array.from({ length: 5 }, () => ({ businessId: business.id, triggeredById: owner.id, provider: "test", model: "fixture", promptVersion: BUSINESS_BRAIN_PROMPT_VERSION, inputSources: [] })) });
    await expect(runBusinessBrainAnalysis(owner.id, business.id, { provider: provider(validOutput()) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("supports item-level decisions for list attributes", async () => {
    const { owner, business } = await fixture();
    const attributes = await Promise.all(Array.from({ length: 5 }, (_, index) => prisma.businessAttribute.create({ data: { businessId: business.id, category: "FACT", key: `fact.${index}`, value: `Bilgi ${index + 1}`, source: "AI_INFERENCE", confidence: 0.8, verificationStatus: "INFERRED" } })));
    await acceptBusinessAttribute(owner.id, attributes[0].id);
    await acceptBusinessAttribute(owner.id, attributes[1].id);
    await Promise.all(attributes.slice(2).map((attribute) => rejectBusinessAttribute(owner.id, attribute.id)));
    expect((await buildBusinessContext(owner.id, business.id)).facts.sort()).toEqual(["Bilgi 1", "Bilgi 2"]);
  });

  it("continues onboarding when website fetching fails", async () => {
    const { owner, business } = await fixture("https://example.com");
    const run = await runBusinessBrainAnalysis(owner.id, business.id, {
      provider: provider(validOutput()),
      websiteReader: async () => { throw new Error("timeout"); },
      skipRateLimit: true,
    });
    expect(run.status).toBe("SUCCEEDED");
    expect(JSON.stringify(run.inputSources)).toContain("FAILED");
  });

  it("does not overwrite user-confirmed data during re-analysis", async () => {
    const { owner, business } = await fixture("https://example.com");
    const original = await prisma.businessAttribute.create({ data: { businessId: business.id, category: "DESCRIPTION", key: "description", value: "Aileler ve çiftler", source: "USER", verificationStatus: "CONFIRMED", isCanonical: true, confirmedById: owner.id, confirmedAt: new Date() } });
    await runBusinessBrainAnalysis(owner.id, business.id, {
      provider: provider(validOutput({ description: { value: "Ege mutfağını modern tabaklarla sunan bir restoran.", source: "WEBSITE", sourceReference: "https://example.com/", evidence: websiteDocument.description, confidence: 0.92 } })),
      websiteReader: async () => websiteDocument,
      skipRateLimit: true,
    });
    const unchanged = await prisma.businessAttribute.findUniqueOrThrow({ where: { id: original.id } });
    const suggested = await prisma.businessAttribute.findFirstOrThrow({ where: { businessId: business.id, supersedesId: original.id } });
    expect(unchanged).toMatchObject({ value: "Aileler ve çiftler", isCanonical: true, verificationStatus: "CONFIRMED" });
    expect(suggested).toMatchObject({ isCanonical: false, verificationStatus: "NEEDS_CONFIRMATION" });
  });
});
