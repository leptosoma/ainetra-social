import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import type { ContentPlanPeriod, ContentType, SocialPlatform } from "../../../generated/prisma/enums";
import { buildBusinessContext } from "@/features/business-brain/service";
import { getActivePlatformRules, rulesForItem, type ActivePlatformRule } from "@/features/platform-intelligence/service";
import { fulfillCaptureRequestsForItems, invalidateCaptureRequestsForInactiveItems, syncCaptureRequestsForActiveItems } from "@/features/capture-engine/service";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { requireMembership } from "@/lib/authorization";
import { buildContentPlanningPrompt, contentPlanningPromptV1 } from "./prompts/content-planning-v1";
import { getContentPlanningProvider, type ContentPlanningProvider } from "./providers";
import { contentPillars, planningOutputSchema, strategyInputSchema, type PlanningItem, type PlanningOutput, type StrategyInput } from "./schemas";

type PlanningOptions = { provider?: ContentPlanningProvider; skipRateLimit?: boolean; force?: boolean };

const platforms = ["INSTAGRAM", "FACEBOOK", "TIKTOK"] as const;

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("Başlangıç tarihi geçersiz.", "VALIDATION_ERROR");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DomainError("Başlangıç tarihi geçersiz.", "VALIDATION_ERROR");
  return date;
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function assertTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new DomainError("İşletme saat dilimi geçersiz.", "VALIDATION_ERROR");
  }
}

function frequencyFromRules(rules: ActivePlatformRule[], platform: SocialPlatform) {
  const rule = rules.find((candidate) => candidate.platform === platform && candidate.category === "FREQUENCY");
  const recommended = Number(jsonObject(rule?.value).recommendedPerWeek);
  if (!Number.isInteger(recommended) || recommended < 1 || recommended > 14) throw new DomainError(`${platform} için güncel sıklık kuralı bulunamadı.`, "VALIDATION_ERROR");
  return recommended;
}

function contentTypesFromRules(rules: ActivePlatformRule[], platform: SocialPlatform): ContentType[] {
  const rule = rules.find((candidate) => candidate.platform === platform && candidate.category === "FORMAT" && candidate.ruleKey === "ainetra.format.planning");
  const values = jsonObject(rule?.value).contentTypes;
  const allowed = new Set<ContentType>(["POST", "REEL", "STORY", "CAROUSEL"]);
  const parsed = Array.isArray(values) ? values.filter((value): value is ContentType => typeof value === "string" && allowed.has(value as ContentType)) : [];
  if (!parsed.length) throw new DomainError(`${platform} için içerik formatı kuralı bulunamadı.`, "VALIDATION_ERROR");
  return parsed;
}

function recommendedMix(rules: ActivePlatformRule[]) {
  const totals = new Map<string, number>();
  let count = 0;
  for (const rule of rules.filter((candidate) => candidate.category === "CONTENT_DIVERSITY")) {
    const mix = jsonObject(jsonObject(rule.value).recommendedMix);
    if (!Object.keys(mix).length) continue;
    count += 1;
    for (const pillar of contentPillars) totals.set(pillar, (totals.get(pillar) ?? 0) + Number(mix[pillar] ?? 0));
  }
  if (!count) throw new DomainError("İçerik karışımı önerisi bulunamadı.", "VALIDATION_ERROR");
  const nonZero = contentPillars.map((pillar) => ({ pillar, raw: (totals.get(pillar) ?? 0) / count })).filter((entry) => entry.raw > 0);
  const rounded = nonZero.map((entry) => ({ pillar: entry.pillar, percentage: Math.round(entry.raw) }));
  const difference = 100 - rounded.reduce((sum, entry) => sum + entry.percentage, 0);
  rounded[0].percentage += difference;
  return rounded;
}

export async function buildRecommendedStrategy(userId: string, businessId: string): Promise<StrategyInput & { rationale: string }> {
  const [context, rules] = await Promise.all([
    buildBusinessContext(userId, businessId),
    getActivePlatformRules(userId, businessId, { platforms: [...platforms] }),
  ]);
  const input = strategyInputSchema.parse({
    mode: "AINETRA_RECOMMENDED",
    platformSettings: platforms.map((platform) => ({ platform, enabled: true, weeklyFrequency: frequencyFromRules(rules, platform), contentTypes: contentTypesFromRules(rules, platform) })),
    contentMix: recommendedMix(rules),
    languages: context.profile.languages.length ? context.profile.languages : ["tr"],
  });
  return { ...input, rationale: "İş hedefleriniz, sektörünüz ve kaynakları kayıtlı platform önerileri birlikte değerlendirildi. Sıklıklar Ainetra başlangıç önerisidir ve özelleştirilebilir." };
}

function serializeStrategy(strategy: StrategyInput) {
  return { platformSettings: strategy.platformSettings as Prisma.InputJsonValue, contentMix: strategy.contentMix as Prisma.InputJsonValue, languages: strategy.languages };
}

function parseStoredStrategy(strategy: { mode: string; platformSettings: Prisma.JsonValue; contentMix: Prisma.JsonValue; languages: string[] }): StrategyInput {
  const parsed = strategyInputSchema.safeParse({ mode: strategy.mode, platformSettings: strategy.platformSettings, contentMix: strategy.contentMix, languages: strategy.languages });
  if (!parsed.success) throw new DomainError("Kayıtlı sosyal strateji geçersiz; lütfen yeniden kaydedin.", "VALIDATION_ERROR");
  return parsed.data;
}

export async function ensureContentStrategy(userId: string, businessId: string) {
  await requireMembership(userId, businessId);
  const existing = await prisma.contentStrategy.findUnique({ where: { businessId } });
  if (existing) return existing;
  const recommended = await buildRecommendedStrategy(userId, businessId);
  const serialized = serializeStrategy(recommended);
  return prisma.contentStrategy.upsert({
    where: { businessId },
    create: { businessId, mode: recommended.mode, ...serialized, rationale: recommended.rationale },
    update: {},
  });
}

export async function getContentStrategyDisplay(userId: string, businessId: string) {
  await requireMembership(userId, businessId);
  const record = await prisma.contentStrategy.findUnique({ where: { businessId } });
  if (record) return { record, settings: parseStoredStrategy(record), rationale: record.rationale, approvedAt: record.approvedAt, version: record.version, mode: record.mode };
  const recommended = await buildRecommendedStrategy(userId, businessId);
  return { record: null, settings: recommended, rationale: recommended.rationale, approvedAt: null, version: 0, mode: recommended.mode };
}

export async function acceptRecommendedContentStrategy(userId: string, businessId: string) {
  await requireMembership(userId, businessId);
  const recommended = await buildRecommendedStrategy(userId, businessId);
  const serialized = serializeStrategy(recommended);
  return prisma.contentStrategy.upsert({
    where: { businessId },
    create: { businessId, mode: recommended.mode, ...serialized, rationale: recommended.rationale, approvedAt: new Date() },
    update: { mode: recommended.mode, ...serialized, rationale: recommended.rationale, userOverrideFields: [], version: { increment: 1 }, approvedAt: new Date() },
  });
}

export async function saveCustomizedContentStrategy(userId: string, businessId: string, input: unknown) {
  await requireMembership(userId, businessId);
  const parsed = strategyInputSchema.parse({ ...(input as object), mode: "CUSTOM" });
  const rules = await getActivePlatformRules(userId, businessId, { platforms: parsed.platformSettings.map((entry) => entry.platform) });
  for (const setting of parsed.platformSettings.filter((entry) => entry.enabled)) {
    const supported = contentTypesFromRules(rules, setting.platform);
    if (setting.contentTypes.some((type) => !supported.includes(type))) throw new DomainError(`${setting.platform} için seçilen içerik türlerinden biri desteklenmiyor.`, "VALIDATION_ERROR");
  }
  const serialized = serializeStrategy(parsed);
  return prisma.contentStrategy.upsert({
    where: { businessId },
    create: { businessId, mode: "CUSTOM", ...serialized, rationale: "Platform, sıklık, içerik karışımı ve dil tercihleri kullanıcı tarafından özelleştirildi.", userOverrideFields: ["platformSettings", "contentMix", "languages"], approvedAt: new Date() },
    update: { mode: "CUSTOM", ...serialized, rationale: "Platform, sıklık, içerik karışımı ve dil tercihleri kullanıcı tarafından özelleştirildi.", userOverrideFields: ["platformSettings", "contentMix", "languages"], version: { increment: 1 }, approvedAt: new Date() },
  });
}

function normalized(value: string) {
  return value.toLocaleLowerCase("tr").normalize("NFKD").replace(/[^a-z0-9çğıöşü\s]/gi, " ").replace(/\s+/g, " ").trim();
}

function assertOutputMatchesInputs(output: PlanningOutput, input: {
  context: Awaited<ReturnType<typeof buildBusinessContext>>;
  strategy: StrategyInput;
  rules: ActivePlatformRule[];
  period: ContentPlanPeriod;
  startDate: Date;
  itemToRegenerate?: PlanningItem;
}) {
  if (output.planPeriod !== input.period) throw new DomainError("Plan dönemi sağlayıcı çıktısıyla uyuşmuyor.", "VALIDATION_ERROR");
  const expectedMix = new Map(input.strategy.contentMix.map((entry) => [entry.pillar, entry.percentage]));
  if (output.contentMix.length !== expectedMix.size || new Set(output.contentMix.map((entry) => entry.pillar)).size !== output.contentMix.length || output.contentMix.some((entry) => expectedMix.get(entry.pillar) !== entry.percentage)) throw new DomainError("Sağlayıcı kullanıcı içerik karışımını değiştirdi.", "VALIDATION_ERROR");
  const enabled = new Map(input.strategy.platformSettings.filter((entry) => entry.enabled).map((entry) => [entry.platform, entry]));
  if (output.platformStrategies.length !== enabled.size || new Set(output.platformStrategies.map((entry) => entry.platform)).size !== output.platformStrategies.length || output.platformStrategies.some((entry) => enabled.get(entry.platform)?.weeklyFrequency !== entry.weeklyFrequency)) throw new DomainError("Sağlayıcı platform sıklığı tercihlerini değiştirdi.", "VALIDATION_ERROR");
  const goalTypes = new Set(input.context.goals.map((goal) => goal.type));
  const ruleKeys = new Set(input.rules.map((rule) => rule.ruleKey));
  const avoidWords = input.context.avoidWords.map(normalized).filter(Boolean);
  const canonicalBlob = normalized(JSON.stringify(input.context));
  const productTokens = new Set(input.context.profile.productsServices.flatMap((value) => normalized(value).split(" ")).filter((value) => value.length >= 4));
  const endDate = addDays(input.startDate, input.period === "SEVEN_DAYS" ? 6 : 29);
  if (input.itemToRegenerate && output.contentItems.length !== 1) throw new DomainError("Tek öğe yenileme çıktısı yalnızca bir öğe içermelidir.", "VALIDATION_ERROR");
  for (const item of output.contentItems) {
    const platform = enabled.get(item.platform);
    if (!platform || !platform.contentTypes.includes(item.contentType)) throw new DomainError("Plan kullanıcı platform tercihlerini ihlal ediyor.", "VALIDATION_ERROR");
    if (!goalTypes.has(item.businessGoal)) throw new DomainError("Plan doğrulanmamış bir iş hedefi içeriyor.", "VALIDATION_ERROR");
    if (!input.strategy.languages.includes(item.language)) throw new DomainError("Plan seçilmeyen bir dil içeriyor.", "VALIDATION_ERROR");
    const date = parseCalendarDate(item.date);
    if (date < input.startDate || date > endDate) throw new DomainError("Plan öğesi seçilen tarih aralığının dışında.", "VALIDATION_ERROR");
    if (item.platformRulesApplied.some((key) => !ruleKeys.has(key))) throw new DomainError("Plan güncel olmayan veya başka platforma ait bir kural içeriyor.", "VALIDATION_ERROR");
    const applicable = new Set(rulesForItem(input.rules, item.platform, item.contentType).map((rule) => rule.ruleKey));
    if (item.platformRulesApplied.some((key) => !applicable.has(key))) throw new DomainError("Plan öğesine başka platform veya formata ait kural uygulanmış.", "VALIDATION_ERROR");
    const copy = normalized([item.topic, item.concept, item.hook, item.captionDirection, item.cta].join(" "));
    if (avoidWords.some((word) => copy.includes(word))) throw new DomainError("Plan kaçınılacak bir kelime veya iddia içeriyor.", "VALIDATION_ERROR");
    if (/(%\s*\d+|\d+[\s.,]*(₺|tl|eur|usd)|ücretsiz|indirim|kampanya)/i.test(copy) && !/(%\s*\d+|\d+[\s.,]*(₺|tl|eur|usd)|ücretsiz|indirim|kampanya)/i.test(canonicalBlob)) throw new DomainError("Plan doğrulanmamış fiyat veya kampanya iddiası içeriyor.", "VALIDATION_ERROR");
    if (item.pillar === "PRODUCT") {
      if (!productTokens.size || ![...productTokens].some((token) => copy.includes(token))) throw new DomainError("Plan doğrulanmamış bir ürün veya hizmet iddiası içeriyor.", "VALIDATION_ERROR");
    }
  }
  const conceptsByTopic = new Map<string, { platform: SocialPlatform; concept: string }[]>();
  for (const item of output.contentItems) {
    const topic = normalized(item.topic);
    const concept = normalized(item.concept);
    const prior = conceptsByTopic.get(topic) ?? [];
    if (prior.some((entry) => entry.platform !== item.platform && entry.concept === concept)) throw new DomainError("Aynı fikir farklı platformlara kopyalanamaz; platforma özgü anlatım gerekir.", "VALIDATION_ERROR");
    prior.push({ platform: item.platform, concept });
    conceptsByTopic.set(topic, prior);
  }
  if (input.itemToRegenerate) {
    const replacement = output.contentItems[0];
    if (replacement.date !== input.itemToRegenerate.date || replacement.platform !== input.itemToRegenerate.platform) throw new DomainError("Tek öğe yenilemesi tarih veya platformu değiştiremez.", "VALIDATION_ERROR");
    return;
  }
  const days = input.period === "SEVEN_DAYS" ? 7 : 30;
  for (const [platform, setting] of enabled) {
    const expected = input.period === "SEVEN_DAYS" ? setting.weeklyFrequency : Math.max(1, Math.round(setting.weeklyFrequency * days / 7));
    if (output.contentItems.filter((item) => item.platform === platform).length !== expected) throw new DomainError("Plan öğe sayısı kullanıcı sıklığıyla uyuşmuyor.", "VALIDATION_ERROR");
  }
  const promotionalLimit = Math.ceil(output.contentItems.length * (expectedMix.get("PROMOTIONAL") ?? 0) / 100) + 1;
  if (output.contentItems.filter((item) => item.pillar === "PROMOTIONAL").length > promotionalLimit) throw new DomainError("Plan promosyon içeriğine aşırı ağırlık veriyor.", "VALIDATION_ERROR");
  const ordered = [...output.contentItems].sort((left, right) => left.date.localeCompare(right.date) || left.recommendedTime.localeCompare(right.recommendedTime));
  let run = 1;
  for (let index = 1; index < ordered.length; index += 1) {
    run = ordered[index].pillar === ordered[index - 1].pillar ? run + 1 : 1;
    if (run > 3) throw new DomainError("Plan aynı içerik sütununu art arda fazla tekrar ediyor.", "VALIDATION_ERROR");
  }
}

function inputSnapshot(context: unknown, strategy: { id: string; version: number }, rules: ActivePlatformRule[], period: ContentPlanPeriod, startDate: string) {
  return { context, strategy: { id: strategy.id, version: strategy.version }, rules: rules.map((rule) => ({ id: rule.id, updatedAt: rule.updatedAt })), period, startDate, promptVersion: contentPlanningPromptV1.id };
}

async function mediaForRequirement(businessId: string, requirement: PlanningItem["mediaRequirement"]) {
  if (requirement === "NO_NEW_MEDIA_REQUIRED") return { mediaAvailability: "NOT_REQUIRED" as const, mediaAssetId: null };
  const asset = await prisma.mediaAsset.findFirst({ where: { businessId, tags: { has: requirement } }, orderBy: { createdAt: "desc" } });
  return asset ? { mediaAvailability: "AVAILABLE" as const, mediaAssetId: asset.id } : { mediaAvailability: "MISSING" as const, mediaAssetId: null };
}

async function withPlanningRun<T>(args: { userId: string; businessId: string; period: ContentPlanPeriod; scope: "PLAN" | "ITEM"; provider: ContentPlanningProvider; inputHash: string; skipRateLimit?: boolean }, work: () => Promise<T>): Promise<T> {
  if (args.skipRateLimit) return work();
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.contentPlanningRun.count({ where: { createdAt: { gte: since }, OR: [{ businessId: args.businessId }, { triggeredById: args.userId }] } });
  if (recent >= 10) throw new DomainError("Bir saat içinde en fazla 10 planlama isteği yapılabilir.", "VALIDATION_ERROR");
  const run = await prisma.contentPlanningRun.create({ data: {
    businessId: args.businessId, triggeredById: args.userId, period: args.period, scope: args.scope,
    provider: args.provider.provider, model: args.provider.model, promptVersion: contentPlanningPromptV1.id, inputHash: args.inputHash,
  } });
  try {
    const result = await work();
    await prisma.contentPlanningRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", completedAt: new Date() } });
    return result;
  } catch (error) {
    await prisma.contentPlanningRun.update({ where: { id: run.id }, data: {
      status: error instanceof DomainError && error.code === "VALIDATION_ERROR" ? "INVALID_OUTPUT" : "FAILED",
      errorCode: error instanceof DomainError ? error.code : "UNEXPECTED_ERROR", completedAt: new Date(),
    } });
    throw error;
  }
}

export async function generateContentPlan(userId: string, businessId: string, raw: { period: ContentPlanPeriod; startDate: string }, options: PlanningOptions = {}) {
  await requireMembership(userId, businessId);
  const period = raw.period;
  if (!(["SEVEN_DAYS", "THIRTY_DAYS"] as string[]).includes(period)) throw new DomainError("Plan dönemi geçersiz.", "VALIDATION_ERROR");
  const startDate = parseCalendarDate(raw.startDate);
  const strategyRecord = await prisma.contentStrategy.findUnique({ where: { businessId } });
  if (!strategyRecord) throw new DomainError("Önce sosyal stratejinizi onaylayın.", "VALIDATION_ERROR");
  if (!strategyRecord.approvedAt) throw new DomainError("Önce sosyal stratejinizi onaylayın.", "VALIDATION_ERROR");
  const strategy = parseStoredStrategy(strategyRecord);
  const selectedPlatforms = strategy.platformSettings.filter((entry) => entry.enabled).map((entry) => entry.platform);
  const [context, rules] = await Promise.all([
    buildBusinessContext(userId, businessId),
    getActivePlatformRules(userId, businessId, { platforms: selectedPlatforms }),
  ]);
  for (const setting of strategy.platformSettings.filter((entry) => entry.enabled)) {
    const supported = contentTypesFromRules(rules, setting.platform);
    if (setting.contentTypes.some((type) => !supported.includes(type))) throw new DomainError(`${setting.platform} stratejisindeki içerik türü güncel kurallarla uyuşmuyor.`, "VALIDATION_ERROR");
  }
  assertTimezone(context.business.timezone);
  if (!context.goals.length) throw new DomainError("İçerik planı için en az bir onaylı iş hedefi gerekir.", "VALIDATION_ERROR");
  if (!context.profile.description && !context.profile.productsServices.length) throw new DomainError("İşletme bağlamı eksik. Önce Business Brain alanlarını doğrulayın.", "VALIDATION_ERROR");
  if (strategy.contentMix.some((entry) => entry.pillar === "PRODUCT" && entry.percentage > 0) && !context.profile.productsServices.length) throw new DomainError("Ürün içeriği planlamak için önce doğrulanmış bir ürün veya hizmet ekleyin.", "VALIDATION_ERROR");
  const snapshot = inputSnapshot(context, strategyRecord, rules, period, raw.startDate);
  const inputHash = hash(snapshot);
  if (!options.force) {
    const duplicate = await prisma.contentPlan.findFirst({ where: { businessId, period, startDate, inputHash, status: { in: ["DRAFT", "APPROVED"] } }, include: { items: { where: { status: "ACTIVE" } } } });
    if (duplicate) return duplicate;
  }
  const provider = options.provider ?? getContentPlanningProvider();
  return withPlanningRun({ userId, businessId, period, scope: "PLAN", provider, inputHash, skipRateLimit: options.skipRateLimit }, async () => {
  const prompt = buildContentPlanningPrompt({ canonicalContext: context, strategy, activePlatformRules: rules, period, startDate: raw.startDate });
  let rawOutput: unknown;
  try {
    rawOutput = await provider.generate({ context, strategy, rules, period, startDate: raw.startDate, prompt });
  } catch {
    throw new DomainError("Plan sağlayıcısına ulaşılamadı; mevcut planlar korunuyor.", "PROVIDER_FAILED");
  }
  const parsed = planningOutputSchema.safeParse(rawOutput);
  if (!parsed.success) throw new DomainError("Plan sağlayıcısı geçersiz bir çıktı döndürdü; hiçbir plan kaydedilmedi.", "VALIDATION_ERROR");
  assertOutputMatchesInputs(parsed.data, { context, strategy, rules, period, startDate });
  const goals = new Map((await prisma.businessGoal.findMany({ where: { businessId } })).map((goal) => [goal.type, goal]));
  const media = await Promise.all(parsed.data.contentItems.map((item) => mediaForRequirement(businessId, item.mediaRequirement)));
  const businessSector = (await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { sector: true } })).sector;
  try {
    return await prisma.$transaction(async (tx) => {
    const previous = await tx.contentPlan.findFirst({ where: { businessId, period, startDate }, orderBy: { version: "desc" }, include: { items: { where: { status: "ACTIVE" }, select: { id: true } } } });
    if (!options.force && previous?.inputHash === inputHash && (previous.status === "DRAFT" || previous.status === "APPROVED")) {
      return tx.contentPlan.findUniqueOrThrow({ where: { id: previous.id }, include: { items: { where: { status: "ACTIVE" }, orderBy: [{ plannedDate: "asc" }, { recommendedTime: "asc" }] } } });
    }
    const plan = await tx.contentPlan.create({
      data: {
        businessId,
        strategyId: strategyRecord.id,
        period,
        startDate,
        endDate: addDays(startDate, period === "SEVEN_DAYS" ? 6 : 29),
        timezone: context.business.timezone,
        version: (previous?.version ?? 0) + 1,
        strategySummary: parsed.data.strategySummary,
        strategySnapshot: strategy as Prisma.InputJsonValue,
        platformStrategies: parsed.data.platformStrategies as Prisma.InputJsonValue,
        contentMix: parsed.data.contentMix as Prisma.InputJsonValue,
        provider: provider.provider,
        model: provider.model,
        promptVersion: contentPlanningPromptV1.id,
        inputHash,
        supersedesId: previous?.id,
      },
    });
    await tx.contentPlanItem.createMany({ data: parsed.data.contentItems.map((item, index) => ({
      planId: plan.id,
      goalId: goals.get(item.businessGoal)!.id,
      platform: item.platform,
      contentType: item.contentType,
      plannedDate: parseCalendarDate(item.date),
      recommendedTime: item.recommendedTime,
      pillar: item.pillar,
      topic: item.topic,
      concept: item.concept,
      hookCategory: item.hookCategory,
      hook: item.hook,
      captionDirection: item.captionDirection,
      cta: item.cta,
      language: item.language,
      mediaRequirement: item.mediaRequirement,
      mediaAvailability: media[index].mediaAvailability,
      mediaAssetId: media[index].mediaAssetId,
      reasoning: item.reasoning,
      platformRulesApplied: item.platformRulesApplied,
    })) });
    if (previous) {
      await tx.contentPlan.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
      await invalidateCaptureRequestsForInactiveItems(tx, previous.items.map((previousItem) => previousItem.id));
    }
    const createdItems = await tx.contentPlanItem.findMany({ where: { planId: plan.id, status: "ACTIVE" }, select: { id: true, mediaRequirement: true, mediaAvailability: true, plannedDate: true, contentType: true } });
    await syncCaptureRequestsForActiveItems(tx, { id: businessId, sector: businessSector, timezone: context.business.timezone }, createdItems);
    return tx.contentPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { items: { where: { status: "ACTIVE" }, orderBy: [{ plannedDate: "asc" }, { recommendedTime: "asc" }] } } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (!options.force && error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) {
      const winner = await prisma.contentPlan.findFirst({ where: { businessId, period, startDate, inputHash, status: { in: ["DRAFT", "APPROVED"] } }, include: { items: { where: { status: "ACTIVE" } } } });
      if (winner) return winner;
    }
    throw error;
  }
  });
}

async function requirePlan(userId: string, planId: string) {
  const plan = await prisma.contentPlan.findUnique({ where: { id: planId }, include: { strategy: true } });
  if (!plan) throw new DomainError("İçerik planı bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, plan.businessId);
  return plan;
}

export async function approveContentPlan(userId: string, planId: string) {
  const plan = await requirePlan(userId, planId);
  if (plan.status === "SUPERSEDED") throw new DomainError("Eski plan sürümü onaylanamaz.", "CONFLICT");
  return prisma.contentPlan.update({ where: { id: plan.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: userId } });
}

export async function regenerateContentPlan(userId: string, planId: string, options: PlanningOptions = {}) {
  const plan = await requirePlan(userId, planId);
  if (plan.status === "SUPERSEDED") throw new DomainError("Eski plan sürümü yenilenemez.", "CONFLICT");
  return generateContentPlan(userId, plan.businessId, { period: plan.period, startDate: plan.startDate.toISOString().slice(0, 10) }, { ...options, force: true });
}

function storedItemToOutput(item: Awaited<ReturnType<typeof prisma.contentPlanItem.findUniqueOrThrow>>, goalType: string): PlanningItem {
  return {
    date: item.plannedDate.toISOString().slice(0, 10), recommendedTime: item.recommendedTime, platform: item.platform, contentType: item.contentType,
    pillar: item.pillar as PlanningItem["pillar"], businessGoal: goalType as PlanningItem["businessGoal"], topic: item.topic, concept: item.concept,
    hookCategory: item.hookCategory, hook: item.hook, captionDirection: item.captionDirection, cta: item.cta, language: item.language,
    mediaRequirement: item.mediaRequirement, reasoning: item.reasoning, platformRulesApplied: item.platformRulesApplied as string[],
  };
}

export async function regenerateContentPlanItem(userId: string, itemId: string, options: PlanningOptions = {}) {
  const item = await prisma.contentPlanItem.findUnique({ where: { id: itemId }, include: { plan: { include: { strategy: true, business: { select: { sector: true, timezone: true } } } }, goal: true } });
  if (!item || item.status !== "ACTIVE") throw new DomainError("Plan öğesi bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, item.plan.businessId);
  if (item.plan.status === "SUPERSEDED") throw new DomainError("Eski plan sürümündeki öğe yenilenemez.", "CONFLICT");
  if (item.contentItemId) throw new DomainError("İçeriğe bağlanmış plan öğesi yenilenemez; önce içerik bağlantısını gözden geçirin.", "CONFLICT");
  const strategyResult = strategyInputSchema.safeParse(item.plan.strategySnapshot);
  if (!strategyResult.success) throw new DomainError("Bu planın strateji geçmişi geçersiz.", "VALIDATION_ERROR");
  const strategy = strategyResult.data;
  const [context, rules] = await Promise.all([
    buildBusinessContext(userId, item.plan.businessId),
    getActivePlatformRules(userId, item.plan.businessId, { platforms: strategy.platformSettings.filter((entry) => entry.enabled).map((entry) => entry.platform) }),
  ]);
  const current = storedItemToOutput(item, item.goal.type);
  const provider = options.provider ?? getContentPlanningProvider();
  const inputHash = hash({ planId: item.planId, itemId: item.id, revision: item.revision, context, strategy, rules: rules.map((rule) => ({ id: rule.id, updatedAt: rule.updatedAt })) });
  return withPlanningRun({ userId, businessId: item.plan.businessId, period: item.plan.period, scope: "ITEM", provider, inputHash, skipRateLimit: options.skipRateLimit }, async () => {
  const prompt = buildContentPlanningPrompt({ canonicalContext: context, strategy, activePlatformRules: rules, period: item.plan.period, startDate: item.plan.startDate.toISOString().slice(0, 10), itemToRegenerate: current });
  let rawOutput: unknown;
  try {
    rawOutput = await provider.generate({ context, strategy, rules, period: item.plan.period, startDate: item.plan.startDate.toISOString().slice(0, 10), prompt, itemToRegenerate: current });
  } catch {
    throw new DomainError("Plan sağlayıcısına ulaşılamadı; mevcut öğe korundu.", "PROVIDER_FAILED");
  }
  const parsed = planningOutputSchema.safeParse(rawOutput);
  if (!parsed.success) throw new DomainError("Geçersiz yenileme çıktısı; mevcut öğe korundu.", "VALIDATION_ERROR");
  assertOutputMatchesInputs(parsed.data, { context, strategy, rules, period: item.plan.period, startDate: item.plan.startDate, itemToRegenerate: current });
  const next = parsed.data.contentItems[0];
  const goal = await prisma.businessGoal.findFirst({ where: { businessId: item.plan.businessId, type: next.businessGoal } });
  if (!goal) throw new DomainError("Yenileme çıktısındaki hedef geçersiz.", "VALIDATION_ERROR");
  const media = await mediaForRequirement(item.plan.businessId, next.mediaRequirement);
  return prisma.$transaction(async (tx) => {
    await tx.contentPlanItem.update({ where: { id: item.id }, data: { status: "REPLACED" } });
    await invalidateCaptureRequestsForInactiveItems(tx, [item.id]);
    await tx.contentPlan.update({ where: { id: item.planId }, data: { status: "DRAFT", approvedAt: null, approvedById: null } });
    const created = await tx.contentPlanItem.create({ data: {
      planId: item.planId, goalId: goal.id, platform: next.platform, contentType: next.contentType, plannedDate: parseCalendarDate(next.date), recommendedTime: next.recommendedTime,
      pillar: next.pillar, topic: next.topic, concept: next.concept, hookCategory: next.hookCategory, hook: next.hook, captionDirection: next.captionDirection,
      cta: next.cta, language: next.language, mediaRequirement: next.mediaRequirement, ...media, reasoning: next.reasoning,
      platformRulesApplied: next.platformRulesApplied, revision: item.revision + 1, replacesItemId: item.id,
    } });
    await syncCaptureRequestsForActiveItems(tx, { id: item.plan.businessId, sector: item.plan.business.sector, timezone: item.plan.business.timezone }, [created]);
    return created;
  }, { isolationLevel: "Serializable" });
  });
}

export async function assignPlanItemMedia(userId: string, itemId: string, mediaAssetId: string) {
  const item = await prisma.contentPlanItem.findUnique({ where: { id: itemId }, include: { plan: true } });
  if (!item) throw new DomainError("Plan öğesi bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, item.plan.businessId);
  if (item.plan.status === "SUPERSEDED") throw new DomainError("Eski plan sürümünün medyası değiştirilemez.", "CONFLICT");
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset || asset.businessId !== item.plan.businessId) throw new DomainError("Medya bu işletmeye ait değil.", "FORBIDDEN");
  if (item.mediaRequirement === "NO_NEW_MEDIA_REQUIRED") throw new DomainError("Bu öğe için yeni medya gerekmiyor.", "VALIDATION_ERROR");
  if (!asset.tags.includes(item.mediaRequirement)) throw new DomainError("Medya bu plan öğesinin gereksinimiyle eşleşmiyor.", "VALIDATION_ERROR");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.contentPlanItem.update({ where: { id: item.id }, data: { mediaAssetId: asset.id, mediaAvailability: "AVAILABLE" } });
    await fulfillCaptureRequestsForItems(tx, [item.id], asset.id);
    return updated;
  }, { isolationLevel: "Serializable" });
}

export async function getContentPlanningState(userId: string, businessId: string) {
  await requireMembership(userId, businessId);
  const [strategy, plans] = await Promise.all([
    prisma.contentStrategy.findUnique({ where: { businessId } }),
    prisma.contentPlan.findMany({
      where: { businessId },
      include: { items: { where: { status: "ACTIVE" }, include: { goal: true, mediaAsset: true }, orderBy: [{ plannedDate: "asc" }, { recommendedTime: "asc" }] } },
      orderBy: [{ createdAt: "desc" }],
    }),
  ]);
  return { strategy, plans };
}
