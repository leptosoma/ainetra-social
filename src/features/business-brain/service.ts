import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import type { BusinessAttributeCategory, GoalPriority } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { normalizeAndValidateGoals } from "@/features/goals/service";
import { businessBrainExtractionSchema, editAttributeSchema, manualAttributeSchema, type BusinessBrainExtraction, type ExtractedField } from "./schemas";
import { buildBusinessBrainPrompt, businessBrainPromptV1 } from "./prompts/business-brain-v1";
import { getBusinessBrainProvider, type BusinessBrainExtractionProvider } from "./providers";
import { fetchWebsiteDocument, type WebsiteDocument } from "./website";

type WebsiteReader = (url: string) => Promise<WebsiteDocument>;

type AnalysisOptions = {
  provider?: BusinessBrainExtractionProvider;
  websiteReader?: WebsiteReader;
  skipRateLimit?: boolean;
};

type CandidateRecord = {
  category: BusinessAttributeCategory;
  key: string;
  value: Prisma.InputJsonValue;
  source: "WEBSITE" | "INSTAGRAM" | "AI_INFERENCE";
  sourceReference?: string;
  confidence: number;
};

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function normalizedEvidence(value: string) {
  return value.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
}

function candidate<T>(category: BusinessAttributeCategory, key: string, item: ExtractedField<T>): CandidateRecord {
  return {
    category,
    key,
    value: item.value as Prisma.InputJsonValue,
    source: item.source,
    sourceReference: item.sourceReference,
    confidence: item.confidence,
  };
}

function flattenExtraction(output: BusinessBrainExtraction, websiteDocument: WebsiteDocument | null) {
  const records: CandidateRecord[] = [];
  const add = <T>(category: BusinessAttributeCategory, key: string, item: ExtractedField<T> | null) => {
    if (!item) return;
    if (item.source === "INSTAGRAM") return; // No Instagram connection or trusted profile payload exists in Phase 2.
    if (item.source === "WEBSITE") {
      const haystack = normalizedEvidence([websiteDocument?.title, websiteDocument?.description, websiteDocument?.text].filter(Boolean).join("\n"));
      if (!item.evidence || !haystack.includes(normalizedEvidence(item.evidence))) return;
    }
    if (item.source === "AI_INFERENCE" && (["PRODUCTS_SERVICES", "FACT", "LOCATION_CONTEXT", "WEBSITE", "INSTAGRAM_IDENTITY"] as string[]).includes(category)) return;
    records.push(candidate(category, key, item));
  };

  add("DESCRIPTION", "description", output.description);
  output.productsServices.forEach((item) => add("PRODUCTS_SERVICES", `products_services.${fingerprint(item.value)}`, item));
  add("TARGET_AUDIENCE", "target_audience", output.targetAudience);
  output.languages.forEach((item) => add("LANGUAGE", `language.${item.value.toLowerCase()}`, item));
  add("BRAND_TONE", "brand_tone", output.brandTone);
  if (output.brandPersonality) {
    for (const [axis, item] of Object.entries(output.brandPersonality)) {
      add("BRAND_PERSONALITY", `brand_personality.${axis}`, item);
    }
  }
  add("LOCATION_CONTEXT", "location_context", output.locationContext);
  output.facts.forEach((item) => add("FACT", `fact.${fingerprint(item.value)}`, item));
  output.restrictions.forEach((item) => add("RESTRICTION", `restriction.${fingerprint(item.value)}`, item));
  output.avoidWords.forEach((item) => add("AVOID_WORD", `avoid_word.${fingerprint(item.value)}`, item));
  output.brandNotes.forEach((item) => add("NOTE", `note.${fingerprint(item.value)}`, item));
  output.suggestedGoals.forEach((goal) => records.push({
    category: "BUSINESS_GOAL",
    key: `business_goal.${goal.type.toLowerCase()}`,
    value: { type: goal.type, rationale: goal.rationale },
    source: "AI_INFERENCE",
    confidence: goal.confidence,
  }));
  return records;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function runBusinessBrainAnalysis(userId: string, businessId: string, options: AnalysisOptions = {}) {
  await requireMembership(userId, businessId);
  if (!options.skipRateLimit) {
    const recentRuns = await prisma.businessAnalysisRun.count({
      where: { businessId, triggeredById: userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recentRuns >= 5) throw new DomainError("Bir saat içinde en fazla 5 analiz çalıştırabilirsiniz.", "VALIDATION_ERROR");
  }
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new DomainError("İşletme bulunamadı.", "NOT_FOUND");
  const provider = options.provider ?? getBusinessBrainProvider();
  const run = await prisma.businessAnalysisRun.create({
    data: {
      businessId,
      triggeredById: userId,
      provider: provider.provider,
      model: provider.model,
      promptVersion: businessBrainPromptV1.id,
      inputSources: [{ type: "USER", fields: ["name", "sector", "location", "website", "instagramHandle"] }],
    },
  });

  let websiteDocument: WebsiteDocument | null = null;
  let websiteFailure: string | null = null;
  if (business.website) {
    try {
      websiteDocument = await (options.websiteReader ?? fetchWebsiteDocument)(business.website);
    } catch (error) {
      websiteFailure = error instanceof DomainError ? error.code : error instanceof Error ? error.message.slice(0, 80) : "WEBSITE_FETCH_FAILED";
    }
  }
  const inputSources: Prisma.InputJsonValue = [
    { type: "USER", fields: ["name", "sector", "location", "website", "instagramHandle"] },
    ...(business.website ? [{ type: "WEBSITE", url: business.website, status: websiteDocument ? "FETCHED" : "FAILED", ...(websiteDocument ? { fetchedAt: websiteDocument.fetchedAt, contentHash: websiteDocument.contentHash } : { errorCode: websiteFailure }) }] : []),
    ...(business.instagramHandle ? [{ type: "INSTAGRAM", identity: business.instagramHandle, status: "NOT_CONNECTED" }] : []),
  ];

  let rawOutput: unknown;
  try {
    rawOutput = await provider.extract({
      business: { name: business.name, sector: business.sector, location: business.location, website: business.website, instagramHandle: business.instagramHandle },
      websiteDocument,
      prompt: buildBusinessBrainPrompt({
        businessName: business.name,
        sector: business.sector,
        location: business.location,
        website: business.website,
        instagramHandle: business.instagramHandle,
        websiteText: websiteDocument?.text,
      }),
    });
  } catch {
    return prisma.businessAnalysisRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorCode: "PROVIDER_FAILED", inputSources, completedAt: new Date() },
    });
  }

  const parsed = businessBrainExtractionSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return prisma.businessAnalysisRun.update({
      where: { id: run.id },
      data: { status: "INVALID_OUTPUT", errorCode: "SCHEMA_VALIDATION_FAILED", inputSources, completedAt: new Date() },
    });
  }

  const records = flattenExtraction(parsed.data, websiteDocument);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.businessAttribute.findMany({
      where: { businessId, key: { in: records.map((record) => record.key) } },
      orderBy: { createdAt: "desc" },
    });
    for (const record of records) {
      const canonical = existing.find((item) => item.key === record.key && item.isCanonical && item.verificationStatus === "CONFIRMED");
      if (canonical && sameJson(canonical.value, record.value)) continue;
      const duplicatePending = existing.find((item) => item.key === record.key && !item.isCanonical && item.verificationStatus !== "REJECTED" && sameJson(item.value, record.value));
      if (duplicatePending) continue;
      await tx.businessAttribute.create({
        data: {
          businessId,
          analysisRunId: run.id,
          category: record.category,
          key: record.key,
          value: record.value,
          source: record.source,
          sourceReference: record.sourceReference,
          confidence: record.confidence,
          verificationStatus: canonical || record.confidence < 0.7 ? "NEEDS_CONFIRMATION" : "INFERRED",
          supersedesId: canonical?.id,
        },
      });
    }
    return tx.businessAnalysisRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", inputSources, outputSnapshot: parsed.data as Prisma.InputJsonValue, completedAt: new Date() },
    });
  }, { isolationLevel: "Serializable" });
}

async function requireAttribute(userId: string, attributeId: string) {
  const attribute = await prisma.businessAttribute.findUnique({ where: { id: attributeId } });
  if (!attribute) throw new DomainError("Bilgi bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, attribute.businessId);
  return attribute;
}

export async function acceptBusinessAttribute(userId: string, attributeId: string) {
  const attribute = await requireAttribute(userId, attributeId);
  if (attribute.category === "BUSINESS_GOAL") throw new DomainError("Hedef için öncelik seçin.", "VALIDATION_ERROR");
  return prisma.$transaction(async (tx) => {
    await tx.businessAttribute.updateMany({ where: { businessId: attribute.businessId, key: attribute.key, isCanonical: true }, data: { isCanonical: false } });
    return tx.businessAttribute.update({
      where: { id: attribute.id },
      data: { verificationStatus: "CONFIRMED", isCanonical: true, confirmedAt: new Date(), confirmedById: userId },
    });
  }, { isolationLevel: "Serializable" });
}

export async function rejectBusinessAttribute(userId: string, attributeId: string) {
  const attribute = await requireAttribute(userId, attributeId);
  if (attribute.isCanonical) throw new DomainError("Onaylanmış bilgi bu ekrandan reddedilemez; düzenleyerek yeni değer oluşturun.", "VALIDATION_ERROR");
  return prisma.businessAttribute.update({ where: { id: attribute.id }, data: { verificationStatus: "REJECTED", isCanonical: false } });
}

export async function editBusinessAttribute(userId: string, input: unknown) {
  const data = editAttributeSchema.parse(input);
  const attribute = await requireAttribute(userId, data.attributeId);
  return prisma.$transaction(async (tx) => {
    await tx.businessAttribute.updateMany({ where: { businessId: attribute.businessId, key: attribute.key, isCanonical: true }, data: { isCanonical: false } });
    await tx.businessAttribute.update({
      where: { id: attribute.id },
      data: { ...(attribute.isCanonical ? {} : { verificationStatus: "REJECTED" }), isCanonical: false },
    });
    return tx.businessAttribute.create({
      data: {
        businessId: attribute.businessId,
        category: attribute.category,
        key: attribute.key,
        value: data.value,
        source: "USER",
        verificationStatus: "CONFIRMED",
        isCanonical: true,
        supersedesId: attribute.id,
        confirmedAt: new Date(),
        confirmedById: userId,
      },
    });
  }, { isolationLevel: "Serializable" });
}

const singularKeys: Partial<Record<BusinessAttributeCategory, string>> = {
  DESCRIPTION: "description",
  TARGET_AUDIENCE: "target_audience",
  BRAND_TONE: "brand_tone",
  LOCATION_CONTEXT: "location_context",
  WEBSITE: "website",
  INSTAGRAM_IDENTITY: "instagram_identity",
};

export async function addManualBusinessAttribute(userId: string, businessId: string, input: unknown) {
  await requireMembership(userId, businessId);
  const data = manualAttributeSchema.parse(input);
  const key = singularKeys[data.category] ?? `${data.category.toLowerCase()}.${fingerprint(data.value)}`;
  return prisma.$transaction(async (tx) => {
    await tx.businessAttribute.updateMany({ where: { businessId, key, isCanonical: true }, data: { isCanonical: false } });
    return tx.businessAttribute.create({
      data: {
        businessId,
        category: data.category,
        key,
        value: data.value,
        source: "USER",
        verificationStatus: "CONFIRMED",
        isCanonical: true,
        confirmedAt: new Date(),
        confirmedById: userId,
      },
    });
  }, { isolationLevel: "Serializable" });
}

export async function acceptSuggestedGoal(userId: string, attributeId: string, priority: GoalPriority) {
  const attribute = await requireAttribute(userId, attributeId);
  if (attribute.category !== "BUSINESS_GOAL" || attribute.verificationStatus === "REJECTED") throw new DomainError("Geçerli bir hedef önerisi seçin.", "VALIDATION_ERROR");
  const value = attribute.value as { type?: unknown };
  if (typeof value.type !== "string") throw new DomainError("Hedef önerisi geçersiz.", "VALIDATION_ERROR");
  const goalType = value.type;
  return prisma.$transaction(async (tx) => {
    const current = await tx.businessGoal.findMany({ where: { businessId: attribute.businessId } });
    const goals = normalizeAndValidateGoals([
      ...current.filter((goal) => goal.type !== goalType).map((goal) => ({ type: goal.type, priority: goal.priority })),
      { type: goalType, priority },
    ]);
    await Promise.all(goals.map((goal) => tx.businessGoal.upsert({
      where: { businessId_type: { businessId: attribute.businessId, type: goal.type } },
      create: { businessId: attribute.businessId, ...goal },
      update: { priority: goal.priority },
    })));
    await tx.businessAttribute.updateMany({ where: { businessId: attribute.businessId, key: attribute.key, isCanonical: true }, data: { isCanonical: false } });
    return tx.businessAttribute.update({
      where: { id: attribute.id },
      data: { verificationStatus: "CONFIRMED", isCanonical: true, confirmedAt: new Date(), confirmedById: userId },
    });
  }, { isolationLevel: "Serializable" });
}

export async function getBusinessBrainState(userId: string, businessId: string) {
  await requireMembership(userId, businessId);
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      brandProfile: true,
      goals: { orderBy: { createdAt: "asc" } },
      attributes: { orderBy: [{ isCanonical: "desc" }, { createdAt: "desc" }] },
      analysisRuns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!business) throw new DomainError("İşletme bulunamadı.", "NOT_FOUND");
  return business;
}

export function calculateBusinessBrainCompleteness(state: Awaited<ReturnType<typeof getBusinessBrainState>>) {
  const confirmedCategories = new Set(state.attributes.filter((item) => item.isCanonical && item.verificationStatus === "CONFIRMED").map((item) => item.category));
  const tones = (state.brandProfile?.toneDimensions ?? {}) as Record<string, unknown>;
  const checks = [
    { label: "İşletme açıklaması", done: Boolean(state.brandProfile?.description.trim()) || confirmedCategories.has("DESCRIPTION") },
    { label: "Ürünler / hizmetler", done: Boolean(state.brandProfile?.productsSummary.trim()) || confirmedCategories.has("PRODUCTS_SERVICES") },
    { label: "Hedef kitle", done: Boolean(state.brandProfile?.targetAudience.trim()) || confirmedCategories.has("TARGET_AUDIENCE") },
    { label: "Diller", done: Boolean(state.brandProfile?.languages.length) || confirmedCategories.has("LANGUAGE") },
    { label: "Marka kişiliği", done: Object.keys(tones).length >= 5 || confirmedCategories.has("BRAND_PERSONALITY") },
    { label: "Ana hedef", done: state.goals.some((goal) => goal.priority === "PRIMARY") },
  ];
  return { percent: Math.round(checks.filter((item) => item.done).length / checks.length * 100), missing: checks.filter((item) => !item.done).map((item) => item.label) };
}

export async function buildBusinessContext(userId: string, businessId: string) {
  const state = await getBusinessBrainState(userId, businessId);
  const confirmed = state.attributes
    .filter((item) => item.isCanonical && item.verificationStatus === "CONFIRMED")
  const inCategory = (category: BusinessAttributeCategory) => confirmed.filter((item) => item.category === category);
  const strings = (category: BusinessAttributeCategory) => inCategory(category).map((item) => item.value).filter((value): value is string => typeof value === "string");
  const firstString = (category: BusinessAttributeCategory) => strings(category)[0];
  const personality = { ...((state.brandProfile?.toneDimensions ?? {}) as Record<string, unknown>) };
  for (const attribute of inCategory("BRAND_PERSONALITY")) {
    const axis = attribute.key.replace("brand_personality.", "");
    if (typeof attribute.value === "number") personality[axis] = attribute.value;
  }
  const productAttributes = strings("PRODUCTS_SERVICES");
  const languageAttributes = strings("LANGUAGE");
  return {
    business: { name: state.name, sector: state.sector, location: state.location, website: state.website, instagramHandle: state.instagramHandle, timezone: state.timezone },
    profile: {
      description: firstString("DESCRIPTION") ?? state.brandProfile?.description ?? "",
      productsServices: productAttributes.length ? productAttributes : state.brandProfile?.productsSummary ? [state.brandProfile.productsSummary] : [],
      targetAudience: firstString("TARGET_AUDIENCE") ?? state.brandProfile?.targetAudience ?? "",
      languages: languageAttributes.length ? languageAttributes : state.brandProfile?.languages ?? [],
      brandTone: firstString("BRAND_TONE") ?? "",
      brandPersonality: personality,
      locationContext: firstString("LOCATION_CONTEXT") ?? state.location ?? "",
    },
    goals: state.goals.map((goal) => ({ type: goal.type, priority: goal.priority })),
    facts: strings("FACT"),
    restrictions: strings("RESTRICTION"),
    avoidWords: strings("AVOID_WORD"),
    notes: strings("NOTE"),
    provenance: confirmed.map((item) => ({ category: item.category, key: item.key, source: item.source })),
  };
}
