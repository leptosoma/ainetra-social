import { CONTENT_PLANNING_PROMPT_VERSION, type PlanningItem, type PlanningOutput } from "../schemas";
import type { ContentPlanningProvider, ContentPlanningProviderInput } from "./types";

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function pillarSequence(mix: ContentPlanningProviderInput["strategy"]["contentMix"], count: number) {
  const active = mix.filter((entry) => entry.percentage > 0);
  const used = new Map(active.map((entry) => [entry.pillar, 0]));
  const sequence: typeof active[number]["pillar"][] = [];
  for (let index = 0; index < count; index += 1) {
    const ranked = active
      .map((entry) => ({ ...entry, score: entry.percentage * (index + 1) / 100 - (used.get(entry.pillar) ?? 0) }))
      .sort((left, right) => right.score - left.score || right.percentage - left.percentage);
    const previous = sequence.at(-1);
    const selected = ranked.find((entry) => entry.pillar !== previous) ?? ranked[0];
    sequence.push(selected.pillar);
    used.set(selected.pillar, (used.get(selected.pillar) ?? 0) + 1);
  }
  return sequence;
}

function mediaFor(pillar: PlanningItem["pillar"], contentType: PlanningItem["contentType"]): PlanningItem["mediaRequirement"] {
  if (contentType === "REEL") return pillar === "BEHIND_THE_SCENES" ? "VIDEO_KITCHEN" : "VIDEO_VERTICAL";
  if (pillar === "PRODUCT") return "PHOTO_PRODUCT";
  if (pillar === "ATMOSPHERE") return "PHOTO_ATMOSPHERE";
  if (["PEOPLE", "SOCIAL_PROOF", "COMMUNITY"].includes(pillar)) return "PHOTO_PEOPLE";
  if (["PROMOTIONAL", "EVENT", "EDUCATIONAL"].includes(pillar)) return "CUSTOM_GRAPHIC";
  return "NO_NEW_MEDIA_REQUIRED";
}

function topicFor(pillar: PlanningItem["pillar"], input: ContentPlanningProviderInput) {
  const product = input.context.profile.productsServices[0]?.split(/[,;]/)[0]?.trim();
  const location = input.context.profile.locationContext || input.context.business.location || input.context.business.name;
  const sector = ({ RESTAURANT: "restoran", CAFE: "kafe", BAR: "bar", HOTEL: "otel" } as Record<string, string>)[input.context.business.sector] ?? "işletme";
  const values: Record<PlanningItem["pillar"], string> = {
    PRODUCT: product || `${input.context.business.name} deneyimi`,
    ATMOSPHERE: `${location} atmosferi`,
    PEOPLE: "Ekibin günlük emeği",
    SOCIAL_PROOF: "Misafir deneyimini anlatan güvenli bir soru",
    EDUCATIONAL: `${sector} deneyimi hakkında pratik bilgi`,
    PROMOTIONAL: "Ana iş hedefine yönlendiren tanıtım",
    BEHIND_THE_SCENES: "Hazırlık sürecinden bir kesit",
    EVENT: input.context.facts.find((fact) => /etkinlik|event|müzik/i.test(fact)) || "Olası etkinlik fikri (tarih ve ayrıntılar teyit edilmeli)",
    COMMUNITY: `${location} topluluğuyla bağ`,
    TREND: "Markaya uygun güncel anlatım formatı",
  };
  return values[pillar];
}

function ctaFor(goal: string, platform: PlanningItem["platform"], index: number) {
  const values: Record<string, string[]> = {
    RESERVATIONS: ["Rezervasyon için bize yazın.", "Rezervasyonla ilgili sorularınızı iletin.", "Yer ayırtmak için bizimle iletişime geçin."],
    FOOT_TRAFFIC: ["Konumumuzu kaydedin.", "Bizi ziyaret etmek için yol tarifi alın.", "Uğramadan önce bize yazın."],
    DELIVERY: ["Sipariş seçeneklerini bize sorun.", "Sipariş ayrıntıları için yazın.", "Paket servis hakkında bilgi alın."],
    PRODUCT_SALES: ["Ürün ayrıntılarını bize sorun.", "Seçenekleri öğrenmek için yazın.", "Detaylar için iletişime geçin."],
    BRAND_AWARENESS: ["Bu fikri kaydedin.", "Siz ne düşünüyorsunuz? Yorumlarda paylaşın.", "Yeni fikirler için hesabı takip edin."],
    EVENT: ["Etkinlik ayrıntıları için bize yazın.", "Katılım koşullarını bize sorun.", "Bilgi almak için iletişime geçin."],
    FOLLOWER_GROWTH: ["Yeni içerikler için hesabı takip edin.", "İlginizi çeken konuyu yorumlara yazın.", "Bu fikri kaydedin."],
  };
  const offset = platform === "INSTAGRAM" ? 0 : platform === "FACEBOOK" ? 1 : 2;
  const choices = values[goal] ?? values.PRODUCT_SALES;
  return choices[(index + offset) % choices.length];
}

function platformDirection(platform: PlanningItem["platform"], contentType: PlanningItem["contentType"], topic: string) {
  if (platform === "TIKTOK") return {
    concept: `${topic}: dikey, doğal çekimle konuya gir; kısa bir gelişme ve net kapanış çağrısı kur. Ses ve ekran yazısını üretim aşamasında planla.`,
    hook: `${topic} için ilk karede hareketli bir detay göster.`,
    caption: `${topic} için kısa bir açıklama yönü ver; video açılışı, ses ve kapanış çağrısı birbirini tamamlasın. Yeni iddia ekleme.`,
  };
  if (platform === "INSTAGRAM" && contentType === "REEL") return {
    concept: `${topic} için dikey bir görsel akış tasarla; ilk karede ana görüntüyü göster, metni güvenli alanda tut.`,
    hook: `${topic} hakkında yakın plan bir görüntüyle aç.`,
    caption: `${topic} için marka tonunda kısa bir metin yönü yaz; görseldeki gerçek ayrıntıya odaklan. Yeni iddia ekleme.`,
  };
  if (platform === "INSTAGRAM") return {
    concept: `${topic} için güçlü bir kapak veya ilk görsel seç; sonraki karelerde tek ana fikri aç.`,
    hook: `${topic} hakkında merak uyandıran bir ilk kare seç.`,
    caption: `${topic} için görseli tamamlayan, marka tonunda kısa bir metin yönü yaz. Yeni iddia ekleme.`,
  };
  return {
    concept: `${topic} için bağlamı açık bir ${contentType === "REEL" ? "video" : "gönderi"} tasarla; konuyu anlaşılır bir açıklamayla destekle.`,
    hook: `${topic} hakkında net bir soru veya giriş cümlesi kullan.`,
    caption: `${topic} için açıklayıcı bir metin yönü yaz ve uygun bir sohbet sorusuyla bitir. Yeni iddia ekleme.`,
  };
}

function appliedRules(input: ContentPlanningProviderInput, platform: PlanningItem["platform"], contentType: PlanningItem["contentType"]) {
  const keys = input.rules.filter((rule) => rule.platform === platform && (!rule.contentType || rule.contentType === contentType)).map((rule) => rule.ruleKey);
  return [...new Set(keys)].slice(0, 8);
}

function postingTimes(input: ContentPlanningProviderInput, platform: PlanningItem["platform"]) {
  const rule = input.rules.find((candidate) => candidate.platform === platform && candidate.category === "POSTING_TIME");
  const times = jsonObject(rule?.value).localTimes;
  return Array.isArray(times) && times.every((entry) => typeof entry === "string") ? times as string[] : ["12:00"];
}

function createItem(input: ContentPlanningProviderInput, options: { platform: PlanningItem["platform"]; contentType: PlanningItem["contentType"]; pillar: PlanningItem["pillar"]; date: string; index: number; goal: string }): PlanningItem {
  const topic = topicFor(options.pillar, input);
  const language = input.strategy.languages[options.index % input.strategy.languages.length];
  const times = postingTimes(input, options.platform);
  const rules = appliedRules(input, options.platform, options.contentType);
  const direction = platformDirection(options.platform, options.contentType, topic);
  const pillarLabels: Record<PlanningItem["pillar"], string> = { PRODUCT: "ürün/hizmet", ATMOSPHERE: "atmosfer", PEOPLE: "ekip", SOCIAL_PROOF: "sosyal kanıt", EDUCATIONAL: "bilgilendirici", PROMOTIONAL: "tanıtım", BEHIND_THE_SCENES: "kamera arkası", EVENT: "etkinlik", COMMUNITY: "topluluk", TREND: "trend" };
  const goalLabels: Record<string, string> = { RESERVATIONS: "rezervasyon", FOOT_TRAFFIC: "ziyaret", DELIVERY: "paket servis", PRODUCT_SALES: "ürün satışı", BRAND_AWARENESS: "marka bilinirliği", EVENT: "etkinlik", FOLLOWER_GROWTH: "takipçi artışı" };
  return {
    date: options.date,
    recommendedTime: times[options.index % times.length],
    platform: options.platform,
    contentType: options.contentType,
    pillar: options.pillar,
    businessGoal: options.goal as PlanningItem["businessGoal"],
    topic,
    concept: direction.concept,
    hookCategory: options.pillar === "EDUCATIONAL" ? "SORU" : options.pillar === "PRODUCT" ? "DETAY" : "MERAK",
    hook: direction.hook,
    captionDirection: direction.caption,
    cta: ctaFor(options.goal, options.platform, options.index),
    language,
    mediaRequirement: mediaFor(options.pillar, options.contentType),
    reasoning: `${goalLabels[options.goal] ?? "işletme"} hedefini ${pillarLabels[options.pillar]} içeriğiyle ${options.platform === "INSTAGRAM" ? "Instagram" : options.platform === "FACEBOOK" ? "Facebook" : "TikTok"} için destekler.`,
    platformRulesApplied: rules,
  };
}

export class LocalContentPlanningProvider implements ContentPlanningProvider {
  readonly provider = "local";
  readonly model = "rules-grounded-planner-v1";

  async generate(input: ContentPlanningProviderInput): Promise<PlanningOutput> {
    const enabled = input.strategy.platformSettings.filter((entry) => entry.enabled);
    const goals = input.context.goals.flatMap((goal) => goal.priority === "PRIMARY" ? [goal.type, goal.type] : [goal.type]);
    if (!goals.length) throw new Error("PLANNING_GOAL_REQUIRED");

    if (input.itemToRegenerate) {
      const current = input.itemToRegenerate;
      const alternatives = input.strategy.contentMix.filter((entry) => entry.percentage > 0 && entry.pillar !== current.pillar);
      const pillar = alternatives[0]?.pillar ?? current.pillar;
      return {
        meta: { promptVersion: CONTENT_PLANNING_PROMPT_VERSION },
        planPeriod: input.period,
        strategySummary: "Tek plan öğesi kullanıcı tercihleri korunarak yenilendi.",
        platformStrategies: enabled.map((entry) => ({ platform: entry.platform, objective: `${input.context.goals[0].type} hedefini desteklemek`, weeklyFrequency: entry.weeklyFrequency, rationale: "Kullanıcının onayladığı platform stratejisi korundu." })),
        contentMix: input.strategy.contentMix,
        contentItems: [createItem(input, { platform: current.platform, contentType: current.contentType, pillar, date: current.date, index: 1, goal: current.businessGoal })],
      };
    }

    const days = input.period === "SEVEN_DAYS" ? 7 : 30;
    const counts = enabled.map((entry) => ({ entry, count: input.period === "SEVEN_DAYS" ? entry.weeklyFrequency : Math.max(1, Math.round(entry.weeklyFrequency * days / 7)) }));
    const total = counts.reduce((sum, value) => sum + value.count, 0);
    const pillars = pillarSequence(input.strategy.contentMix, total);
    const items: PlanningItem[] = [];
    let globalIndex = 0;
    for (const { entry, count } of counts) {
      for (let index = 0; index < count; index += 1) {
        const contentType = entry.contentTypes[index % entry.contentTypes.length];
        const dateOffset = Math.min(days - 1, Math.floor(index * days / count));
        items.push(createItem(input, {
          platform: entry.platform,
          contentType,
          pillar: pillars[globalIndex],
          date: addDays(input.startDate, dateOffset),
          index: globalIndex,
          goal: goals[globalIndex % goals.length],
        }));
        globalIndex += 1;
      }
    }
    items.sort((left, right) => left.date.localeCompare(right.date) || left.recommendedTime.localeCompare(right.recommendedTime));
    return {
      meta: { promptVersion: CONTENT_PLANNING_PROMPT_VERSION },
      planPeriod: input.period,
      strategySummary: `${input.context.business.name} için iş hedefleri, kullanıcı tercihleri ve güncel platform kuralları birlikte uygulandı.`,
      platformStrategies: enabled.map((entry) => ({ platform: entry.platform, objective: `${input.context.goals[0].type} hedefini desteklemek`, weeklyFrequency: entry.weeklyFrequency, rationale: "Sıklık kullanıcı tarafından onaylanan stratejiden alınmıştır." })),
      contentMix: input.strategy.contentMix,
      contentItems: items,
    };
  }
}
