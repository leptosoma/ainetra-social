import { describe, expect, it } from "vitest";
import { BRAND_STYLE_PROFILE_VERSION, deriveBrandVisualStyleProfile } from "@/features/brand-style/profile";
import { assertBrandStyleOperations, buildBrandStyleOperations, clampToTier } from "@/features/brand-style/styles";
import { brandStyleOperationsSchema } from "@/features/brand-style/schemas";
import { safeEnhanceOperationsSchema } from "@/features/safe-enhance/schemas";

const fullTones = { corporateFriendly: 65, minimalVibrant: 50, luxuryAccessible: 45, modernNatural: 50, seriousPlayful: 40 };

function profileFor(toneDimensions: unknown) {
  return deriveBrandVisualStyleProfile({ id: "brand-1", updatedAt: new Date("2026-09-01T00:00:00.000Z"), toneDimensions });
}

describe("Ainetra P5-03 — brand visual style profile", () => {
  it("derives an understandable recommendation from the user-maintained tone preferences", () => {
    const premium = profileFor({ ...fullTones, luxuryAccessible: 20, minimalVibrant: 30 });
    expect(premium).toMatchObject({ profileVersion: BRAND_STYLE_PROFILE_VERSION, state: "COMPLETE", nearestStyle: "PREMIUM", headline: "Sade ve seçkin" });
    expect(premium.alternatives).toEqual(["NATURAL", "VIBRANT"]);
    expect(premium.rationale).toContain("sade ve seçkin");

    const vibrant = profileFor({ ...fullTones, luxuryAccessible: 80, minimalVibrant: 85, seriousPlayful: 75 });
    expect(vibrant).toMatchObject({ nearestStyle: "VIBRANT", headline: "Canlı ve sıcak" });
    expect(vibrant.alternatives).toEqual(["NATURAL", "PREMIUM"]);

    const balanced = profileFor(fullTones);
    expect(balanced).toMatchObject({ nearestStyle: "NATURAL", headline: "Doğal ve dengeli" });
    expect(balanced.alternatives).toEqual(["VIBRANT", "PREMIUM"]);
  });

  it("falls back to explicitly neutral behavior for a missing or incomplete profile without inventing preferences", () => {
    const missing = deriveBrandVisualStyleProfile(null);
    expect(missing).toMatchObject({ state: "MISSING", profileId: null, profileUpdatedAt: null, nearestStyle: "NATURAL", headline: "Nötr ve doğal" });
    expect(Object.values(missing.tones)).toEqual([50, 50, 50, 50, 50]);
    expect(missing.rationale).toContain("Marka profiliniz henüz doldurulmadığı");

    // Eksik ve bozuk tercihler dengede kabul edilir; belirtilenler olduğu gibi okunur.
    const incomplete = profileFor({ minimalVibrant: 90, luxuryAccessible: "yüksek", unknownDimension: 10 });
    expect(incomplete.state).toBe("INCOMPLETE");
    expect(incomplete.tones).toEqual({ corporateFriendly: 50, minimalVibrant: 90, luxuryAccessible: 50, modernNatural: 50, seriousPlayful: 50 });
    expect(incomplete.nearestStyle).toBe("VIBRANT");
    expect(incomplete.rationale).toContain("dengede kabul edildi");

    // Aralık dışı bir tercih uydurulmuş bir yöne değil, en yakın geçerli sınıra indirgenir.
    expect(profileFor({ ...fullTones, minimalVibrant: 400 }).tones.minimalVibrant).toBe(100);
  });

  it("keeps every style inside the closed safe-operation contract and narrows it further for sensitive media", () => {
    const profile = profileFor({ ...fullTones, luxuryAccessible: 10, minimalVibrant: 95, seriousPlayful: 95, corporateFriendly: 100 });
    for (const tier of ["RELAXED", "STANDARD", "STRICT"] as const) {
      for (const choice of ["BRAND_RECOMMENDED", "NATURAL", "VIBRANT", "PREMIUM"] as const) {
        const operations = buildBrandStyleOperations(choice, profile, tier);
        expect(Object.keys(operations).sort()).toEqual(["brightness", "contrast", "denoise", "saturation", "sharpen", "warmth"]);
        // Marka Stili sözleşmesi P5-02'nin kapalı kümesinin alt kümesidir.
        expect(safeEnhanceOperationsSchema.safeParse(operations).success).toBe(true);
        expect(brandStyleOperationsSchema(tier).safeParse(operations).success).toBe(true);
      }
    }

    // Aynı stil, hassas görselde ölçülü biçimde daraltılır: özgünlük stilin üstündedir.
    const relaxed = buildBrandStyleOperations("VIBRANT", profile, "RELAXED");
    const strict = buildBrandStyleOperations("VIBRANT", profile, "STRICT");
    expect(strict.saturation).toBeLessThan(relaxed.saturation);
    expect(strict.contrast).toBeLessThanOrEqual(relaxed.contrast);
    expect(Math.abs(strict.warmth)).toBeLessThanOrEqual(Math.abs(relaxed.warmth));
    expect(strict.sharpen).toBeLessThanOrEqual(relaxed.sharpen);
    // Medyan gürültü azaltma gerçek dokuyu yumuşatabildiği için en dar katmanda hiç uygulanmaz.
    expect(buildBrandStyleOperations("PREMIUM", profile, "RELAXED").denoise).toBe(true);
    expect(buildBrandStyleOperations("PREMIUM", profile, "STRICT").denoise).toBe(false);
    expect(clampToTier({ brightness: 2, contrast: 2, saturation: 2, warmth: 1, sharpen: 5, denoise: true }, "STRICT"))
      .toEqual({ brightness: 1.05, contrast: 1.05, saturation: 1.04, warmth: 0.02, sharpen: 0.8, denoise: false });
  });

  it("rejects any style request that cannot be expressed inside the safe-operation contract", () => {
    const operations = buildBrandStyleOperations("NATURAL", profileFor(fullTones), "STANDARD");
    // Üretken/nesne işlemleri sözleşmede ifade edilemez.
    expect(() => assertBrandStyleOperations({ ...operations, replaceBackground: true }, "STANDARD")).toThrowError(/güvenli işlem sınırlarının dışında/);
    expect(() => assertBrandStyleOperations({ ...operations, generateProduct: "tabak" }, "STANDARD")).toThrowError(/güvenli işlem sınırlarının dışında/);
    // Sınır dışı bir yoğunluk isteği de reddedilir; sessizce uygulanmaz.
    expect(() => assertBrandStyleOperations({ ...operations, saturation: 1.4 }, "STANDARD")).toThrowError(/güvenli işlem sınırlarının dışında/);
    expect(() => assertBrandStyleOperations({ ...operations, saturation: 1.08 }, "STRICT")).toThrowError(/güvenli işlem sınırlarının dışında/);
    expect(() => assertBrandStyleOperations({ ...operations, denoise: true }, "STRICT")).toThrowError(/güvenli işlem sınırlarının dışında/);
    // Geçerli bir set aynı değerlerle geri döner.
    expect(assertBrandStyleOperations(operations, "STANDARD")).toEqual(operations);
  });
});
