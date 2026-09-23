import type { ContentType, SocialPlatform } from "../../../generated/prisma/enums";
import { type ActivePlatformRule, rulesForItem } from "@/features/platform-intelligence/service";
import { parseAspectRatio } from "@/features/visual-analysis/normalize";
import { socialVariantRuleSnapshotSchema, type SocialVariantFormat, type SocialVariantRuleSnapshot } from "./schemas";

// "Bunu nerede kullanacaksınız?" sorusunun yanıt kümesi. Formatlar Ainetra'nın EYLEM adlarıdır
// (Akış, Hikâye, Reel kapağı, Kare); hedef oran her zaman mevcut bir Platform Intelligence
// ASPECT_RATIO kuralından okunur. Kural yoksa o seçenek hiç sunulmaz: burada teknik platform
// gereksinimi çoğaltılmaz, uydurulmaz ve varsayılan bir oran kabul edilmez.
//
// Sosyal Varyant ve Kreatif Kampanya aynı çözümlemeyi kullanır; ikisi de yalnızca gerçek kural
// bağlamının izin verdiği hedefleri sunar.

type FormatDefinition = {
  contentType: ContentType;
  /** RECOMMENDED: kuralın önerdiği oran. FIXED: yalnızca kural bu oranı destekliyorsa sunulur. */
  target: { kind: "RECOMMENDED" } | { kind: "FIXED"; label: string };
};

const formatDefinitions: Record<SocialVariantFormat, FormatDefinition> = {
  FEED: { contentType: "POST", target: { kind: "RECOMMENDED" } },
  STORY: { contentType: "STORY", target: { kind: "RECOMMENDED" } },
  REEL_COVER: { contentType: "REEL", target: { kind: "RECOMMENDED" } },
  SQUARE: { contentType: "POST", target: { kind: "FIXED", label: "1:1" } },
};

export const socialPlatforms: readonly SocialPlatform[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK"];

export const formatContentTypes: Record<SocialVariantFormat, ContentType> = {
  FEED: formatDefinitions.FEED.contentType,
  STORY: formatDefinitions.STORY.contentType,
  REEL_COVER: formatDefinitions.REEL_COVER.contentType,
  SQUARE: formatDefinitions.SQUARE.contentType,
};

export type FormatTarget = {
  platform: SocialPlatform;
  contentType: ContentType;
  format: SocialVariantFormat;
  /** Kuraldan okunan hedef oran etiketi (ör. "4:5"). */
  targetAspectRatio: string;
  targetRatio: number;
  ruleId: string;
  ruleKey: string;
  ruleEffectiveFrom: Date;
  snapshot: SocialVariantRuleSnapshot;
};

const recommendationPriority: Record<ActivePlatformRule["recommendationType"], number> = {
  TECHNICAL_REQUIREMENT: 0,
  BEST_PRACTICE: 1,
  GENERAL_RECOMMENDATION: 2,
  BUSINESS_LEARNED: 3,
};

function ruleValue(rule: ActivePlatformRule): { recommended: string | null; supported: string[] } {
  const value = rule.value && typeof rule.value === "object" && !Array.isArray(rule.value) ? rule.value as Record<string, unknown> : {};
  const recommended = typeof value.recommended === "string" && parseAspectRatio(value.recommended) !== null ? value.recommended : null;
  const supported = Array.isArray(value.supported)
    ? value.supported.filter((entry): entry is string => typeof entry === "string" && parseAspectRatio(entry) !== null)
    : [];
  return { recommended, supported };
}

/**
 * Bir (platform, içerik türü) için tek ve deterministik oran kuralı. Aynı anahtar için birden çok
 * kural varsa: önce içerik türü tam eşleşen, sonra daha bağlayıcı öneri türü, sonra yüksek güven,
 * en sonda kural anahtarı. Seçim açıklanabilir olmalıdır; rastgele veya gizli bir tercih yoktur.
 */
function selectAspectRatioRule(rules: ActivePlatformRule[], platform: SocialPlatform, contentType: ContentType): ActivePlatformRule | null {
  const candidates = rulesForItem(rules, platform, contentType)
    .filter((rule) => rule.category === "ASPECT_RATIO" && ruleValue(rule).recommended !== null);
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) =>
    Number(left.contentType === null) - Number(right.contentType === null) ||
    recommendationPriority[left.recommendationType] - recommendationPriority[right.recommendationType] ||
    right.confidence - left.confidence ||
    left.ruleKey.localeCompare(right.ruleKey),
  )[0];
}

function toSnapshot(rule: ActivePlatformRule, recommendedAspectRatio: string, supported: string[]): SocialVariantRuleSnapshot {
  return socialVariantRuleSnapshotSchema.parse({
    ruleId: rule.id,
    ruleKey: rule.ruleKey,
    platform: rule.platform,
    contentType: rule.contentType,
    category: rule.category,
    recommendationType: rule.recommendationType,
    source: rule.source,
    sourceUrl: rule.sourceUrl,
    recommendedAspectRatio,
    supportedAspectRatios: supported,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    reviewedAt: rule.reviewedAt.toISOString(),
    confidence: rule.confidence,
  });
}

/**
 * Aktif platform kurallarından sunulabilir format hedefleri. Kuralı olmayan bir platform/format
 * için satır üretilmez; "kare" yalnızca kuralın 1:1 oranını gerçekten desteklediği yerde çıkar.
 */
export function resolveFormatTargets(rules: ActivePlatformRule[]): FormatTarget[] {
  const targets: FormatTarget[] = [];
  for (const platform of socialPlatforms) {
    for (const format of Object.keys(formatDefinitions) as SocialVariantFormat[]) {
      const definition = formatDefinitions[format];
      const rule = selectAspectRatioRule(rules, platform, definition.contentType);
      if (!rule) continue;
      const { recommended, supported } = ruleValue(rule);
      if (!recommended) continue;
      const label = definition.target.kind === "RECOMMENDED" ? recommended : definition.target.label;
      // Sabit oranlı bir eylem (kare) yalnızca kuralın kendisi o oranı destekliyorsa sunulur.
      if (definition.target.kind === "FIXED" && recommended !== label && !supported.includes(label)) continue;
      const targetRatio = parseAspectRatio(label);
      if (targetRatio === null) continue;
      targets.push({
        platform,
        contentType: definition.contentType,
        format,
        targetAspectRatio: label,
        targetRatio,
        ruleId: rule.id,
        ruleKey: rule.ruleKey,
        ruleEffectiveFrom: rule.effectiveFrom,
        snapshot: toSnapshot(rule, recommended, supported),
      });
    }
  }
  return targets;
}

export function findFormatTarget(targets: FormatTarget[], platform: string, format: string): FormatTarget | null {
  return targets.find((target) => target.platform === platform && target.format === format) ?? null;
}
