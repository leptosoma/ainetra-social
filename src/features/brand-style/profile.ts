import { brandStyleAlternatives, type BrandStyleAlternative, type BrandStyleProfileSnapshot } from "./schemas";

// Kullanıcının kendi doldurduğu BrandProfile tercihlerinden (toneDimensions) basit, açıklanabilir bir
// görsel stil profili türetilir. Bu değerler bilimsel bir ölçüm değil, kullanıcı tercihidir; bu yüzden
// yalnızca "hangi karakter öne çıkıyor" sorusuna kaba bir yanıt verirler ve arayüzde ham hâlleriyle
// (alan adı ya da sayı) hiçbir zaman gösterilmezler.
//
// Tek yetkili kaynak mevcut BrandProfile satırıdır. Profil yoksa veya tercihler eksikse davranış açıkça
// nötrdür: eksik tercih 50 (denge) kabul edilir ve kullanıcıya bunun neden böyle olduğu söylenir.
// Bu modül BrandProfile'ı ya da başka bir Business Brain kaydını hiçbir koşulda yazmaz.

export const BRAND_STYLE_PROFILE_VERSION = "brand-style-profile-v1";

/** BrandProfile'da tutulan, kullanıcı tarafından sürgülerle belirlenen tercih eksenleri. */
export const brandToneKeys = ["corporateFriendly", "minimalVibrant", "luxuryAccessible", "modernNatural", "seriousPlayful"] as const;
export type BrandToneKey = typeof brandToneKeys[number];

export type BrandProfileInput = { id: string; updatedAt: Date; toneDimensions: unknown } | null;

export type BrandProfileState = "MISSING" | "INCOMPLETE" | "COMPLETE";

export type BrandVisualStyleProfile = {
  profileVersion: string;
  state: BrandProfileState;
  profileId: string | null;
  profileUpdatedAt: Date | null;
  /** 0–100 aralığına indirgenmiş tercihler; eksik olanlar 50 (nötr) kabul edilir. */
  tones: Record<BrandToneKey, number>;
  /** "Markama göre" seçiminin karakterce en yakın olduğu sabit stil. */
  nearestStyle: BrandStyleAlternative;
  /** Kullanıcıya sunulacak sabit alternatifler: markanın kendi karakterini tekrar eden seçenek çıkarılır. */
  alternatives: BrandStyleAlternative[];
  /** Kısa, anlaşılır Türkçe başlık. */
  headline: string;
  /** Neden bu öneri; ham değer veya iç alan adı içermez. */
  rationale: string;
};

const neutral = 50;

function readTone(tones: Record<string, unknown>, key: BrandToneKey): number | null {
  const value = tones[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

const headlines: Record<BrandStyleAlternative, string> = {
  NATURAL: "Doğal ve dengeli",
  VIBRANT: "Canlı ve sıcak",
  PREMIUM: "Sade ve seçkin",
};

const rationales: Record<BrandStyleAlternative, string> = {
  NATURAL: "Marka tercihleriniz dengeli bir karakter tarif ediyor; bu yüzden fotoğrafı olduğu gibi bırakan, yalnızca ışığı ve netliği toparlayan bir ayar öneriyoruz.",
  VIBRANT: "Marka tercihleriniz daha canlı ve sıcak bir karakter tarif ediyor; bu yüzden renkleri ölçülü biçimde öne çıkaran bir ayar öneriyoruz.",
  PREMIUM: "Marka tercihleriniz daha sade ve seçkin bir karakter tarif ediyor; bu yüzden renkleri öne çıkarmayan, kontrastı ve netliği toparlayan ölçülü bir ayar öneriyoruz.",
};

/**
 * Basit ve açıklanabilir eşleme:
 * lüks yönü baskınsa ve canlılık tercihi düşükse seçkin, canlılık/eğlence tercihi yüksekse canlı,
 * aksi hâlde doğal. Denge noktasındaki (ya da bilinmeyen) bir marka her zaman doğal tarafa düşer.
 */
export function nearestStyleFor(tones: Record<BrandToneKey, number>): BrandStyleAlternative {
  const luxury = 100 - tones.luxuryAccessible;
  if (luxury >= 60 && tones.minimalVibrant <= 55) return "PREMIUM";
  if (tones.minimalVibrant >= 60 || tones.seriousPlayful >= 70) return "VIBRANT";
  return "NATURAL";
}

/** BrandProfile satırı → sürümlü görsel stil profili. Yazma yapmaz; eksik veriyi uydurmaz. */
export function deriveBrandVisualStyleProfile(profile: BrandProfileInput): BrandVisualStyleProfile {
  const raw = profile && typeof profile.toneDimensions === "object" && profile.toneDimensions !== null
    ? (profile.toneDimensions as Record<string, unknown>)
    : {};
  const read = brandToneKeys.map((key) => [key, readTone(raw, key)] as const);
  const tones = Object.fromEntries(read.map(([key, value]) => [key, value ?? neutral])) as Record<BrandToneKey, number>;
  const state: BrandProfileState = !profile ? "MISSING" : read.every(([, value]) => value !== null) ? "COMPLETE" : "INCOMPLETE";
  const nearestStyle = state === "MISSING" ? "NATURAL" : nearestStyleFor(tones);
  const rationale = state === "MISSING"
    ? "Marka profiliniz henüz doldurulmadığı için nötr ve doğal bir ayar öneriyoruz. Marka profilinizi doldurduğunuzda öneri markanıza göre değişir."
    : state === "INCOMPLETE"
      ? `${rationales[nearestStyle]} Marka profilinizdeki bazı tercihler henüz belirtilmediğinden bunlar dengede kabul edildi.`
      : rationales[nearestStyle];
  return {
    profileVersion: BRAND_STYLE_PROFILE_VERSION,
    state,
    profileId: profile?.id ?? null,
    profileUpdatedAt: profile?.updatedAt ?? null,
    tones,
    nearestStyle,
    // Markanın kendi karakteriyle aynı olan sabit seçenek listeden çıkarılır: "Markama göre" zaten odur.
    alternatives: brandStyleAlternatives.filter((style) => style !== nearestStyle),
    headline: state === "MISSING" ? "Nötr ve doğal" : headlines[nearestStyle],
    rationale,
  };
}

/** Kayıtta saklanacak anlık görüntü: sonradan profil değişse de geçmiş çalıştırma aynı kalır. */
export function brandStyleProfileSnapshot(profile: BrandVisualStyleProfile): BrandStyleProfileSnapshot {
  return {
    profileVersion: profile.profileVersion,
    available: profile.state !== "MISSING",
    complete: profile.state === "COMPLETE",
    nearestStyle: profile.nearestStyle,
    tones: profile.tones,
  };
}
