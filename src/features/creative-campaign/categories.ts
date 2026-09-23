import type { BusinessAttributeCategory } from "../../../generated/prisma/enums";
import { creativeCopySchema, creativeFactRefSchema, type CreativeCategory, type CreativeCopy, type CreativeFactRef } from "./schemas";

// Kasıtlı olarak küçük bir kreatif kümesi. Her kategori, hangi ONAYLI bilgi olmadan üretilemeyeceğini
// kendi tanımında söyler. Bu tablo dışında bir kaynak yoktur: çıkarım (INFERRED), onay bekleyen
// (NEEDS_CONFIRMATION), reddedilmiş (REJECTED) ya da kanonik olmayan hiçbir kayıt kullanılmaz.
//
// "Açık ve doğrulanmış kullanıcı girdisi" de bu yoldan gelir: kullanıcı bilgiyi Business Brain'e
// kendisi ekleyip onayladığında satır kanonik ve CONFIRMED olur ve burada görünür. Kreatif akışının
// kendi serbest metin alanı yoktur; böylece bu ekrandan olgu uydurulamaz.

export type CreativeCategoryDefinition = {
  /** Kullanıcıya gösterilen kısa ad. */
  label: string;
  /** Ne hazırlandığı; tasarım olduğu her zaman açıktır. */
  description: string;
  /** Bu kategorinin beslendiği kanonik bilgi kategorileri (öncelik sırasıyla). */
  requires: readonly BusinessAttributeCategory[];
  /** Bilgi yoksa kullanıcıya söylenen tam eksik; burada genel bir hata metni kullanılmaz. */
  missingReason: string;
};

export const creativeCategoryDefinitions: Record<CreativeCategory, CreativeCategoryDefinition> = {
  BUSINESS_INTRO: {
    label: "İşletme tanıtımı",
    description: "Onaylı işletme tanımınızı kullanan sade bir tanıtım tasarımı.",
    requires: ["DESCRIPTION"],
    missingReason: "İşletme tanımınız henüz onaylanmadı. Business Brain'de işletme tanımınızı ekleyip onayladığınızda bu tasarım hazırlanabilir.",
  },
  PRODUCTS_SERVICES: {
    label: "Ürün ve hizmet bilgisi",
    description: "Onaylı ürün ve hizmet bilginizi kullanan bilgilendirici bir tasarım.",
    requires: ["PRODUCTS_SERVICES"],
    missingReason: "Onaylı ürün veya hizmet bilginiz yok. Business Brain'de ürün/hizmet bilginizi ekleyip onayladığınızda bu tasarım hazırlanabilir. Fiyat, kampanya veya stok bilgisi hiçbir koşulda üretilmez.",
  },
  LOCATION_INFO: {
    label: "Konum bilgisi",
    description: "Onaylı konum bilginizi kullanan yol tarifi niteliğinde bir tasarım.",
    requires: ["LOCATION_CONTEXT"],
    missingReason: "Onaylı konum bilginiz yok. Business Brain'de konum bilginizi ekleyip onayladığınızda bu tasarım hazırlanabilir. Çalışma saati veya uygunluk bilgisi uydurulmaz.",
  },
  CONFIRMED_FACTS: {
    label: "Onaylı işletme bilgisi",
    description: "Onayladığınız işletme bilgilerinden birini öne çıkaran sade bir tasarım.",
    requires: ["FACT"],
    missingReason: "Onaylanmış bir işletme bilginiz yok. Business Brain'de bilgiyi ekleyip onayladığınızda bu tasarım hazırlanabilir.",
  },
};

export const maxFactsPerCreative = 3;

/** Metin basılmadan önce okunabilir uzunluğa indirilir; anlam değiştirilmez, yalnızca kısaltılır. */
function trimLine(value: string, limit = 160) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

export type CandidateFact = {
  id: string;
  category: BusinessAttributeCategory;
  key: string;
  value: string;
  source: string;
  confirmedAt: Date | null;
};

/**
 * Kategoriye uyan onaylı bilgiler → deterministik sıra. Aynı girdi her zaman aynı metni verir:
 * önce kategori önceliği, sonra onay zamanı, sonra kimlik.
 */
export function selectFactsForCategory(category: CreativeCategory, facts: CandidateFact[]): CandidateFact[] {
  const order = creativeCategoryDefinitions[category].requires;
  return facts
    .filter((fact) => order.includes(fact.category) && fact.value.trim().length > 0)
    .sort((left, right) =>
      order.indexOf(left.category) - order.indexOf(right.category) ||
      (left.confirmedAt?.getTime() ?? 0) - (right.confirmedAt?.getTime() ?? 0) ||
      left.id.localeCompare(right.id),
    )
    .slice(0, maxFactsPerCreative);
}

export function toFactRefs(facts: CandidateFact[]): CreativeFactRef[] {
  return facts.map((fact) => creativeFactRefSchema.parse({
    attributeId: fact.id,
    category: fact.category,
    key: fact.key,
    value: trimLine(fact.value, 400),
    source: fact.source,
    confirmedAt: fact.confirmedAt?.toISOString() ?? null,
  }));
}

/** Tasarımın üzerinde de görünen sabit işaret: bu bir tasarımdır, fotoğraf değildir. */
export const creativeDesignNote = "Tasarım görseli";

/**
 * Onaylı bilgiler + işletme adı → basılacak metin. Buradan geçen her satır bir olgu referansına
 * karşılık gelir; ek cümle, çağrı, slogan veya teklif kurulmaz.
 */
export function buildCreativeCopy(businessName: string, facts: CandidateFact[]): CreativeCopy {
  return creativeCopySchema.parse({
    headline: trimLine(businessName, 80),
    lines: facts.map((fact) => trimLine(fact.value)),
    designNote: creativeDesignNote,
  });
}
