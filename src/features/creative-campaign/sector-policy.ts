import { DomainError } from "@/lib/domain-error";
import { creativeCategories, type CreativeCategory, type CreativeCopy, type CreativeFactRef } from "./schemas";

// Kreatif Kampanya için sektöre duyarlı politika. Bilinçli olarak KÜÇÜK tutulmuştur: burada bir kural
// motoru, ayrı bir tablo veya yönetim ekranı yoktur. Politika `Business.sector` alanından deterministik
// olarak çözülür ve üç adet sabit tanımdan birine düşer. Tanınmayan sektör en dar politikaya düşer;
// böylece bilinmeyen bir işletme türü yanlışlıkla en gevşek kuralı almaz.
//
// Öncelik sırası her yolda aynıdır ve aşağıdaki sabitle ifade edilir:
//   ÖZGÜNLÜK > ONAYLI BİLGİ > SEKTÖR POLİTİKASI > MARKA STİLİ > KREATİF SERBESTLİK
// Üstteki katman alttakini her zaman geçersiz kılar: örneğin marka stili özgünlüğü gevşetemez ve
// sektör politikası onaylı bilgi zorunluluğunu kaldıramaz.

export const creativePolicyPrecedence = ["AUTHENTICITY", "CONFIRMED_FACTS", "SECTOR_POLICY", "BRAND_STYLE", "CREATIVE_FREEDOM"] as const;
export type CreativePolicyLayer = typeof creativePolicyPrecedence[number];

export const creativeSectorPolicyKeys = ["HOSPITALITY_STANDARD", "FOOD_STRICT_AUTHENTIC", "HEALTH_STRICT_COMPLIANCE"] as const;
export type CreativeSectorPolicyKey = typeof creativeSectorPolicyKeys[number];

export const creativeRestrictedClaims = ["GUARANTEE", "RISK_FREE", "CERTAIN_SUCCESS", "SUCCESS_RATE", "BEFORE_AFTER", "PATIENT_PROOF"] as const;
export type CreativeRestrictedClaim = typeof creativeRestrictedClaims[number];

export type CreativeSectorPolicy = {
  key: CreativeSectorPolicyKey;
  /** Sektör metni tanınan bir kümeye düştü mü; tanınmadıysa en dar politika uygulandığı söylenir. */
  sectorRecognized: boolean;
  /** Bu sektörde hazırlanabilen kreatif türleri. Dışındaki türler ekranda kapalı kalır. */
  allowedCategories: readonly CreativeCategory[];
  /** Her politikada zorunlu: metin yalnızca kanonik ve ONAYLI bilgilerden kurulur. */
  requiresConfirmedFacts: true;
  /** Her politikada zorunlu: çıktı açık bir insan kararı (Sakla/At) olmadan kullanıma geçmez. */
  requiresHumanReview: true;
  /** Yalnızca sağlık politikasında: saklamak için ayrıca açık bir kabul beyanı gerekir. */
  requiresExplicitAcceptance: boolean;
  /** STRICT: arka planın gerçek fotoğraf izi çözülemiyorsa kreatif hazırlanmaz. */
  authenticityStrictness: "STANDARD" | "STRICT";
  /**
   * Üretken bir sağlayıcının bu sektörde kullanılıp kullanılamayacağı. Bugün hiçbir politikada
   * açık değildir: sentetik bir "ürün fotoğrafı" gerçek ürün çekiminin, sentetik bir "deniz
   * manzarası" da gerçek odanın/mekânın yerine geçemez. Alan yine de politika başına durur;
   * çıktının anlamını doğrulayan bir denetim eklendiğinde gevşetilecek yer burasıdır.
   */
  allowsGenerativeImagery: boolean;
  /** Onaylı olsa bile basılamayan iddia türleri. */
  restrictedClaims: readonly CreativeRestrictedClaim[];
  /** Kullanıcıya gösterilen kısa politika adı ve açıklaması. */
  label: string;
  summary: string;
};

type RestrictedClaimRule = {
  label: string;
  /** ASCII'ye katlanmış metin üzerinde çalışır; bkz. `foldForClaimScan`. */
  pattern: RegExp;
  /** Kullanıcıya söylenen tam gerekçe; genel bir hata metni kullanılmaz. */
  reason: string;
};

export const creativeRestrictedClaimRules: Record<CreativeRestrictedClaim, RestrictedClaimRule> = {
  GUARANTEE: {
    label: "Garanti iddiası",
    pattern: /\bgaranti|guarantee/,
    reason: "Bu bilgi bir garanti iddiası içeriyor. Sağlık alanında sonuç garantisi verilemez; bilgi onaylı olsa bile tasarıma basılmaz.",
  },
  RISK_FREE: {
    label: "Risksizlik iddiası",
    pattern: /\brisksiz\b|risk[\s-]?free|\brisk yok\b|hicbir risk|yan etki(si)? yok/,
    reason: "Bu bilgi işlemin risksiz veya yan etkisiz olduğunu söylüyor. Sağlık alanında böyle bir iddia tasarıma basılmaz.",
  },
  CERTAIN_SUCCESS: {
    label: "Kesin başarı iddiası",
    pattern: /kesin sonuc|kesin basari|sonuc kesin|kesinlikle (iyilesir|gecer|sonuc)|mutlaka (iyilesir|gecer|sonuc)|certain success/,
    reason: "Bu bilgi kesin başarı veya kesin sonuç söylüyor. Sağlık alanında sonuç taahhüdü tasarıma basılmaz.",
  },
  SUCCESS_RATE: {
    label: "Başarı oranı iddiası",
    pattern: /basari orani|success rate|%\s?\d|\d\s?%/,
    reason: "Bu bilgi bir başarı oranı veya yüzde içeriyor. Ainetra bu oranı doğrulayamadığı için sağlık alanında tasarıma basılmaz.",
  },
  BEFORE_AFTER: {
    label: "Öncesi/sonrası iddiası",
    pattern: /oncesi[\s\-/]*(ve)?[\s\-/]*sonrasi|\bonce[\s\-/]+sonra\b|before[\s\-/]*(and)?[\s\-/]*after/,
    reason: "Bu bilgi öncesi/sonrası karşılaştırması içeriyor. Sağlık alanında öncesi-sonrası anlatımı tasarıma basılmaz.",
  },
  PATIENT_PROOF: {
    label: "Hasta referansı iddiası",
    pattern: /hasta (yorum|referans|gorus|deneyim|kanit)|hastalarimiz(in)? (yorum|anlat|deneyim)|patient (testimonial|proof|review)/,
    reason: "Bu bilgi hasta yorumuna veya hasta referansına dayanıyor. Sağlık alanında hasta deneyimi tasarıma basılmaz.",
  },
};

const healthRestrictedClaims = [...creativeRestrictedClaims] as const;

/**
 * Üç sabit politika. Alan sayısı bilinçli olarak azdır; yeni bir sektör ihtiyacı çıkarsa burada bir
 * satır eklenir, ayrı bir motor veya şema kurulmaz.
 */
const policyDefinitions: Record<CreativeSectorPolicyKey, Omit<CreativeSectorPolicy, "sectorRecognized">> = {
  HOSPITALITY_STANDARD: {
    key: "HOSPITALITY_STANDARD",
    allowedCategories: creativeCategories,
    requiresConfirmedFacts: true,
    requiresHumanReview: true,
    requiresExplicitAcceptance: false,
    authenticityStrictness: "STANDARD",
    // Üretken görsel burada da kapalıdır. Ainetra çıktının ANLAMINI doğrulamıyor: üretken bir
    // sağlayıcı olmayan bir deniz manzarası, oda, havuz veya tesis uydurduğunda bunu yakalayacak
    // bir denetim yok. Böyle bir doğrulama eklenene kadar konaklamada da yalnızca deterministik
    // grafik şablonlarıyla tasarım hazırlanır.
    allowsGenerativeImagery: false,
    restrictedClaims: [],
    label: "Konaklama",
    summary: "Tasarımdaki her satır onayladığınız işletme bilgisinden gelir. Oda, manzara, yıldız, fiyat veya uygunluk bilgisi onaylanmadan basılmaz. Üretken görsel üretilmez; tasarım onaylı bilgi metinleri ve marka renkleriyle hazırlanır.",
  },
  FOOD_STRICT_AUTHENTIC: {
    key: "FOOD_STRICT_AUTHENTIC",
    allowedCategories: creativeCategories,
    requiresConfirmedFacts: true,
    requiresHumanReview: true,
    requiresExplicitAcceptance: false,
    authenticityStrictness: "STRICT",
    allowsGenerativeImagery: false,
    restrictedClaims: [],
    label: "Yeme-içme",
    summary: "Ürün görseli üretilmez. Tasarım yalnızca onaylı bilgi metinleri ve marka renkleriyle hazırlanır; sentetik bir ürün görseli gerçek ürün fotoğrafının yerine geçemez.",
  },
  HEALTH_STRICT_COMPLIANCE: {
    key: "HEALTH_STRICT_COMPLIANCE",
    // Sağlıkta hizmet/tedavi tanıtımı yapılmaz: yalnızca bilgilendirici türler açıktır.
    allowedCategories: ["BUSINESS_INTRO", "LOCATION_INFO", "CONFIRMED_FACTS"],
    requiresConfirmedFacts: true,
    requiresHumanReview: true,
    requiresExplicitAcceptance: true,
    authenticityStrictness: "STRICT",
    allowsGenerativeImagery: false,
    restrictedClaims: healthRestrictedClaims,
    label: "Sağlık",
    summary: "Yalnızca bilgilendirici tasarım hazırlanır. Garanti, risksizlik, kesin başarı, başarı oranı, öncesi/sonrası ve hasta referansı iddiaları bilgi onaylı olsa bile basılmaz; saklamak için açık kabul beyanınız gerekir.",
  },
};

/**
 * Sektör metni → politika anahtarı. `Business.sector` serbest metindir (Türkçe veya İngilizce
 * yazılabilir, ek alabilir), bu yüzden eşleştirme katlanmış metin üzerinde SÖZCÜK BAŞINDAN yapılır:
 * "restoranı" tanınır ama "berber" yemek-içme sanılmaz. Kısa ve başka sözcüklerin içine düşebilen
 * anahtarlar (`bar`, `pub`, `apart`) tam sözcük olarak aranır. `hospital` yalnızca hastane
 * anlamında eşleşir: `hospitality` konaklamadır ve sağlığa düşmez.
 *
 * Sıra dar politikadan gevşeğe doğrudur: birden çok eşleşmede (ör. "Otel Restoran") daha dar olan
 * politika kazanır. Liste kasıtlı olarak kısadır ve tanınmayan her şey en dar politikaya düşer.
 */
const sectorMatchers: ReadonlyArray<{ policy: CreativeSectorPolicyKey; patterns: readonly RegExp[] }> = [
  {
    policy: "HEALTH_STRICT_COMPLIANCE",
    patterns: [
      /\bsaglik/, /\bhealth/, /\bklinik/, /\bclinic/, /\bpoliklinik/, /\bhastane/, /\bhospital(?!ity)/,
      /\bdoktor/, /\bdoctor/, /\bhekim/, /\bmedikal/, /\bmedical/, /\bdis hekim/, /\bdentist/, /\bdental/,
      /\bestetik/, /\baesthetic/, /\bdermatolog/, /\bfizyoterapi/, /\bphysiotherap/, /\bpsikolog/,
      /\bpsycholog/, /\beczane/, /\bpharmac/, /\btip merkezi/, /\bsac ekim/, /\bhair transplant/,
    ],
  },
  {
    policy: "FOOD_STRICT_AUTHENTIC",
    patterns: [
      /\brestoran/, /\brestaurant/, /\blokanta/, /\bcafe\b/, /\bkafe\b/, /\bkahveci/, /\bcoffee/,
      /\bbar\b/, /\bpub\b/, /\bmeyhane/, /\bpastane/, /\bpatisserie/, /\bbakery/, /\bfirin\b/,
      /\bfood\b/, /\byemek/, /\bcatering/, /\bpizza/, /\bburger/, /\bkebap/, /\bdondurma/,
      /\bbistro/, /\bbrasserie/, /\bbeach club/, /\bbeach kulu/,
    ],
  },
  {
    policy: "HOSPITALITY_STANDARD",
    patterns: [
      /\bhotel/, /\botel/, /\bpansiyon/, /\bhostel/, /\bresort/, /\bkonaklama/, /\bmotel/, /\bapart\b/, /\btatil koyu/,
      /\bvilla/, /\bhospitality/,
    ],
  },
];

/**
 * Türkçe metni ASCII'ye katlar: `İ`/`ı` noktaları, şapkalar ve diğer birleşen işaretler düşer.
 * Böylece iddia kalıpları tek biçimde (ASCII) yazılır ve "GARANTİ", "garantı", "Garanti" aynı
 * sonucu verir.
 */
export function foldForClaimScan(value: string) {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `Business.sector` → politika. Tanınmayan sektör en dar politikaya (sağlık) düşer. */
export function resolveCreativeSectorPolicy(sector: string): CreativeSectorPolicy {
  const folded = foldForClaimScan(sector);
  for (const entry of sectorMatchers) {
    if (folded && entry.patterns.some((pattern) => pattern.test(folded))) {
      return { ...policyDefinitions[entry.policy], sectorRecognized: true };
    }
  }
  // Güvenli geri düşüş: sektör tanınmadığında en dar politika uygulanır ve bu kullanıcıya söylenir.
  return { ...policyDefinitions.HEALTH_STRICT_COMPLIANCE, sectorRecognized: false };
}

/** Tanınmayan sektörde en dar politikanın neden uygulandığı; sağlık iddiası değildir. */
export const unrecognizedSectorNote = "İşletme sektörünüz tanınmadığı için en dar kreatif politikası uygulandı. Ayarlardan sektörünüzü yazdığınızda kendi sektörünüzün politikası geçerli olur.";

export function sectorPolicyAllowsCategory(policy: CreativeSectorPolicy, category: CreativeCategory) {
  return policy.allowedCategories.includes(category);
}

/** Kategori bu sektörde kapalıysa kullanıcıya söylenen tam gerekçe. */
export function categoryBlockedReason(policy: CreativeSectorPolicy, category: CreativeCategory) {
  return category === "PRODUCTS_SERVICES" && policy.key === "HEALTH_STRICT_COMPLIANCE"
    ? "Sağlık politikasında hizmet veya tedavi tanıtımı tasarımı hazırlanmaz. Bilgilendirici türleri kullanabilirsiniz."
    : `${policy.label} politikasında bu tasarım türü hazırlanmaz.`;
}

/** ÖZGÜNLÜK katmanı: arka planın gerçek fotoğraf izi. STRICT politikada iz zorunludur. */
export function assertAuthenticBackground(policy: CreativeSectorPolicy, background: { rootAssetId: string | null } | null) {
  if (!background) return;
  if (policy.authenticityStrictness === "STRICT" && !background.rootAssetId) {
    throw new DomainError("Seçilen görselin gerçek fotoğraf izi çözülemedi; bu sektörde arka plan olarak kullanılamaz.", "VALIDATION_ERROR");
  }
}

/**
 * ÖZGÜNLÜK katmanı: üretken sağlayıcı sınırı. Hiçbir sektörde üretken bir sağlayıcı kullanılamaz;
 * sentetik bir ürün/oda/manzara görseli gerçek çekimin yerine geçemez ve çıktının ne gösterdiğini
 * doğrulayan bir denetim yoktur. Üretken olmayan (deterministik) şablon sağlayıcıları etkilenmez.
 */
export function assertProviderAllowed(policy: CreativeSectorPolicy, provider: { generative: boolean }) {
  if (provider.generative && !policy.allowsGenerativeImagery) {
    throw new DomainError("Bu sektörde üretken görsel üretimi kullanılamaz; tasarım yalnızca onaylı bilgi metinleri ve marka renkleriyle hazırlanır.", "VALIDATION_ERROR");
  }
}

/** SEKTÖR POLİTİKASI katmanı: kategori bu sektörde açık mı. */
export function assertCategoryAllowed(policy: CreativeSectorPolicy, category: CreativeCategory) {
  if (!sectorPolicyAllowsCategory(policy, category)) {
    throw new DomainError(categoryBlockedReason(policy, category), "VALIDATION_ERROR");
  }
}

export type RestrictedClaimHit = { claim: CreativeRestrictedClaim; label: string; reason: string; text: string };

/** Politikanın yasakladığı ilk iddiayı döner. Sıra sabittir; aynı metin her zaman aynı sonucu verir. */
export function findRestrictedClaim(policy: CreativeSectorPolicy, text: string): RestrictedClaimHit | null {
  if (!policy.restrictedClaims.length) return null;
  const folded = foldForClaimScan(text);
  for (const claim of creativeRestrictedClaims) {
    if (!policy.restrictedClaims.includes(claim)) continue;
    const rule = creativeRestrictedClaimRules[claim];
    if (rule.pattern.test(folded)) return { claim, label: rule.label, reason: rule.reason, text };
  }
  return null;
}

/**
 * SEKTÖR POLİTİKASI katmanı: yasaklı iddia taraması. Bilgi ONAYLI olsa bile geçmez — onay, iddianın
 * doğruluğunu Ainetra için doğrulanabilir yapmaz.
 */
export function assertClaimsAllowed(policy: CreativeSectorPolicy, texts: readonly string[]) {
  for (const text of texts) {
    const hit = findRestrictedClaim(policy, text);
    if (hit) throw new DomainError(hit.reason, "VALIDATION_ERROR");
  }
}

/**
 * ONAYLI BİLGİ katmanı: basılacak her satır bir olgu referansına birebir karşılık gelmelidir.
 * Karşılığı olmayan bir satır, kaynağı olmayan bir iddiadır ve hiçbir yolda kabul edilmez.
 */
export function assertCopyTracesToConfirmedFacts(copy: CreativeCopy, factRefs: readonly CreativeFactRef[]) {
  if (!factRefs.length) throw new DomainError("Tasarım metninin onaylı bilgi karşılığı yok.", "VALIDATION_ERROR");
  const sources = factRefs.map((fact) => fact.value);
  for (const line of copy.lines) {
    // `buildCreativeCopy` satırları yalnızca kısaltır; bu yüzden ön ek karşılaştırması yeterlidir.
    const trimmed = line.replace(/…$/, "");
    if (!sources.some((source) => source.startsWith(trimmed))) {
      throw new DomainError("Tasarım metninde onaylı bilgi karşılığı olmayan bir satır var; tasarım kullanılamaz.", "VALIDATION_ERROR");
    }
  }
}

/** SEKTÖR POLİTİKASI katmanı: sağlıkta saklamak için açık kabul beyanı. */
export function assertHumanAcceptance(policy: CreativeSectorPolicy, acceptance: string | null | undefined) {
  if (!policy.requiresExplicitAcceptance) return;
  if (acceptance !== policy.key) {
    throw new DomainError(healthAcceptanceRequiredMessage, "VALIDATION_ERROR");
  }
}

export const healthAcceptanceRequiredMessage = "Bu tasarımı saklamak için politika beyanını açıkça kabul etmeniz gerekiyor: tasarımdaki bilgilerin doğruluğundan ve sağlık tanıtım kurallarına uygunluğundan siz sorumlusunuz.";

export const acceptanceCheckboxLabel = "Tasarımdaki bilgilerin doğru ve sağlık tanıtım kurallarına uygun olduğunu, sorumluluğun bana ait olduğunu kabul ediyorum.";

/**
 * ÖZGÜNLÜK katmanı: hiçbir sektörde tasarım çıktısı gerçek fotoğraf kanıtının yerine geçmez.
 * Saklanan varlık yalnızca CREATIVE_CAMPAIGN kökenli ve yalnızca CUSTOM_GRAPHIC etiketli olabilir.
 */
export function assertNoSyntheticProductSubstitution(asset: { origin: string; tags: readonly string[] }) {
  if (asset.origin !== "CREATIVE_CAMPAIGN" || asset.tags.some((tag) => tag !== "CUSTOM_GRAPHIC")) {
    throw new DomainError("Tasarım çıktısı gerçek fotoğraf gerektiren bir ihtiyaç için işaretlenemez.", "VALIDATION_ERROR");
  }
}
