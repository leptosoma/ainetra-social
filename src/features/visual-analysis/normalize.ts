import type { MediaAnalysisProvenance } from "../../../generated/prisma/enums";
import type { ActivePlatformRule } from "@/features/platform-intelligence/service";
import { VISUAL_ANALYSIS_VERSION, type PlatformFitEntry, type ProviderOutput, type VisualAnalysisResult } from "./schemas";

// Sağlayıcı gözlemlerini deterministik alan kurallarıyla normalize sonuca dönüştürür.
// Buradaki her karar açıklanabilir olmalıdır; yapay zekâ çıkarımı değildir.

const commonAspectRatios: Array<{ label: string; value: number }> = [
  { label: "1:1", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "3:4", value: 3 / 4 },
  { label: "2:3", value: 2 / 3 },
  { label: "9:16", value: 9 / 16 },
  { label: "5:4", value: 5 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "1.91:1", value: 1.91 },
];

/** İki oran %3 toleransla aynı kabul edilir; ufak kenar farkları kırpma gerektirmez. */
const aspectTolerance = 0.03;

function ratiosMatch(left: number, right: number) {
  return Math.abs(left - right) / right <= aspectTolerance;
}

export function parseAspectRatio(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(label.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

export function describeAspectRatio(width: number, height: number): VisualAnalysisResult["aspectRatio"] {
  const value = width / height;
  const known = commonAspectRatios.find((candidate) => ratiosMatch(value, candidate.value));
  return { value: Number(value.toFixed(3)), label: known?.label ?? `${value.toFixed(2)}:1` };
}

export function describeOrientation(width: number, height: number): VisualAnalysisResult["orientation"] {
  if (ratiosMatch(width / height, 1)) return "SQUARE";
  return width > height ? "LANDSCAPE" : "PORTRAIT";
}

export function describeResolution(width: number, height: number): VisualAnalysisResult["quality"]["resolution"] {
  const shortSide = Math.min(width, height);
  if (shortSide < 720) return "LOW";
  if (shortSide < 1080) return "MEDIUM";
  return "HIGH";
}

/**
 * Var olan platform kurallarından (ASPECT_RATIO kategorisi) uyum değerlendirmesi. Kural
 * çoğaltılmaz: yalnızca `value.recommended` (ve varsa `value.supported`) okunur. Kuralı olmayan
 * platform/format için satır üretilmez; uydurma bir "uygun" iddiası yapılmaz.
 */
export function evaluatePlatformFit(width: number, height: number, rules: ActivePlatformRule[]): PlatformFitEntry[] {
  const imageRatio = width / height;
  const entries: PlatformFitEntry[] = [];
  for (const rule of rules) {
    if (rule.category !== "ASPECT_RATIO") continue;
    const value = rule.value && typeof rule.value === "object" && !Array.isArray(rule.value) ? rule.value as Record<string, unknown> : {};
    const recommended = parseAspectRatio(value.recommended);
    if (recommended === null || typeof value.recommended !== "string") continue;
    const supported = Array.isArray(value.supported) ? value.supported.map(parseAspectRatio).filter((ratio): ratio is number => ratio !== null) : [];
    const fits = ratiosMatch(imageRatio, recommended) || supported.some((ratio) => ratiosMatch(imageRatio, ratio));
    entries.push({
      platform: rule.platform,
      contentType: rule.contentType,
      fit: fits ? "FIT" : "CROP_NEEDED",
      recommendedAspectRatio: value.recommended,
      ruleKey: rule.ruleKey,
      recommendationType: rule.recommendationType,
    });
  }
  return entries.sort((left, right) => left.platform.localeCompare(right.platform) || (left.contentType ?? "").localeCompare(right.contentType ?? ""));
}

/**
 * Özgünlük politikası: gerçek bir sahneyi belgeleyen her fotoğraf hassastır; yalnızca içeriği
 * görsel olarak doğrulanmış saf bir tasarım görseli hassas değildir. Bu gevşetme yalnızca REAL
 * provenance ile mümkündür: geliştirme sağlayıcısı pikselleri tanımaz, GRAPHIC sınıfı kullanıcının
 * CUSTOM_GRAPHIC planlama etiketinden gelir ve bir etiket görselde gerçek ürün/mekân/kişi
 * olmadığının kanıtı değildir. Bu yüzden DEVELOPMENT sonuçları her zaman hassas kalır.
 */
export function evaluateAuthenticity(output: ProviderOutput, provenance: MediaAnalysisProvenance): VisualAnalysisResult["authenticity"] {
  const claimsPureGraphic = output.imageKind === "GRAPHIC" && output.category === "GRAPHIC" && !output.peopleVisible;
  if (claimsPureGraphic && provenance === "REAL") {
    return { sensitive: false, reason: "Tasarım görseli; gerçek bir ürün, mekân veya kişiyi belgelemiyor." };
  }
  if (claimsPureGraphic) {
    return { sensitive: true, reason: "Tasarım görseli sınıfı planlama etiketinden geldi; içerik görsel olarak doğrulanmadı. Görselde gerçek ürün, mekân veya kişi olabilir; hiçbir öğe değiştirilmemeli." };
  }
  const byCategory: Partial<Record<ProviderOutput["category"], string>> = {
    FOOD: "Gerçek yemek görünümü: porsiyon, malzeme ve sunum değiştirilmemeli.",
    DRINK: "Gerçek içecek görünümü: miktar, içerik ve sunum değiştirilmemeli.",
    PRODUCT: "Gerçek ürün görünümü: ürünün kendisi, boyutu ve durumu değiştirilmemeli.",
    PEOPLE: "Gerçek kişiler: yüz, beden ve ifadeler değiştirilmemeli.",
    TEAM: "Gerçek ekip: kişiler, kıyafet ve çalışma ortamı değiştirilmemeli.",
    INTERIOR: "Gerçek mekân: düzen, kapasite ve manzara değiştirilmemeli.",
    EXTERIOR: "Gerçek dış görünüm: cephe, manzara ve çevre değiştirilmemeli.",
    SERVICE: "Gerçek hizmet anı: hizmetin kapsamı ve koşulları değiştirilmemeli.",
    EVENT: "Gerçek etkinlik: katılım, tarih ve ortam koşulları değiştirilmemeli.",
    GRAPHIC: "Tasarım içinde gerçek kişi/ürün görünüyor; bu öğeler değiştirilmemeli.",
  };
  const base = byCategory[output.category] ?? "İçerik doğrulanmadı; gerçek fotoğraf gibi korunmalı ve hiçbir öğe eklenip çıkarılmamalı.";
  const people = output.peopleVisible && !["PEOPLE", "TEAM"].includes(output.category) ? " Görselde gerçek kişiler var; kişiler değiştirilmemeli." : "";
  return { sensitive: true, reason: `${base}${people}`.slice(0, 300) };
}

function overallQuality(resolution: VisualAnalysisResult["quality"]["resolution"], output: ProviderOutput): VisualAnalysisResult["quality"]["overall"] {
  if (resolution === "LOW" || output.sharpness === "SOFT") return "LOW";
  if (resolution === "MEDIUM" || output.lighting === "DARK" || output.lighting === "BRIGHT" || output.sharpness === "UNKNOWN") return "MEDIUM";
  return "GOOD";
}

type PartialResult = Omit<VisualAnalysisResult, "recommendedAction" | "recommendedActionReason">;

function recommendAction(result: PartialResult, provenance: MediaAnalysisProvenance): Pick<VisualAnalysisResult, "recommendedAction" | "recommendedActionReason"> {
  if (result.imageKind === "UNKNOWN" || result.category === "UNKNOWN") {
    return { recommendedAction: "REVIEW_MANUALLY", recommendedActionReason: "İçerik güvenle tanımlanamadı; kullanmadan önce görseli kendiniz kontrol edin." };
  }
  // Doğrulanmamış (etiketten türetilmiş) tasarım görseli iddiası: saflık kanıtlanamadığı için
  // kullanmadan önce manuel kontrol istenir; otomatik "olduğu gibi kullan" verilmez.
  if (provenance !== "REAL" && result.imageKind === "GRAPHIC") {
    return { recommendedAction: "REVIEW_MANUALLY", recommendedActionReason: "Tasarım görseli sınıfı yalnızca planlama etiketine dayanıyor; görselde gerçek ürün, mekân veya kişi olmadığını kendiniz kontrol edin." };
  }
  if (result.quality.resolution === "LOW") {
    return { recommendedAction: "RECAPTURE", recommendedActionReason: `Kısa kenar ${Math.min(result.dimensions.width, result.dimensions.height)} px; sosyal platformlar için düşük çözünürlük. Yeniden çekim önerilir.` };
  }
  const lightingIssue = result.observations.lighting === "DARK" || result.observations.lighting === "BRIGHT";
  if (result.quality.sharpness === "SOFT" || lightingIssue) {
    const cause = [
      result.quality.sharpness === "SOFT" ? "netlik düşük" : null,
      lightingIssue ? (result.observations.lighting === "DARK" ? "ışık yetersiz" : "ışık fazla") : null,
    ].filter(Boolean).join(", ");
    return { recommendedAction: "SAFE_ENHANCE_CANDIDATE", recommendedActionReason: `Görselde ${cause}; içeriği değiştirmeyen bir iyileştirme için aday.` };
  }
  if (result.platformFit.length && !result.platformFit.some((entry) => entry.fit === "FIT")) {
    return { recommendedAction: "CROP_FOR_PLATFORM", recommendedActionReason: `Görsel oranı (${result.aspectRatio.label}) tanımlı platform formatlarının hiçbiriyle örtüşmüyor; platforma göre kırpma gerekir.` };
  }
  return { recommendedAction: "USE_AS_IS", recommendedActionReason: "Çözünürlük, ışık ve netlik yeterli; görsel olduğu gibi kullanılabilir." };
}

export function buildVisualAnalysisResult(input: { output: ProviderOutput; width: number; height: number; rules: ActivePlatformRule[]; provenance: MediaAnalysisProvenance }): VisualAnalysisResult {
  const { output, width, height, provenance } = input;
  const resolution = describeResolution(width, height);
  const partial: PartialResult = {
    schemaVersion: VISUAL_ANALYSIS_VERSION,
    imageKind: output.imageKind,
    dominantSubject: output.dominantSubject,
    category: output.category,
    categoryConfidence: Number(output.confidence.toFixed(2)),
    dimensions: { width, height },
    orientation: describeOrientation(width, height),
    aspectRatio: describeAspectRatio(width, height),
    quality: { overall: overallQuality(resolution, output), resolution, sharpness: output.sharpness },
    observations: { lighting: output.lighting, framing: output.framing, background: output.background, notes: output.notes },
    platformFit: evaluatePlatformFit(width, height, input.rules),
    authenticity: evaluateAuthenticity(output, provenance),
  };
  return { ...partial, ...recommendAction(partial, provenance) };
}
