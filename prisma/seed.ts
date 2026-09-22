import "dotenv/config";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../src/features/auth/password";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const reviewedAt = new Date("2026-09-18T00:00:00.000Z");

const platformRuleSeeds = [
  { platform: "INSTAGRAM", contentType: "REEL", category: "ASPECT_RATIO", ruleKey: "meta.reels.vertical-9-16", value: { recommended: "9:16", appliesTo: ["INSTAGRAM_REELS", "FACEBOOK_REELS"] }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://www.facebook.com/business/ads/facebook-instagram-reels-ads", confidence: 0.98 },
  { platform: "INSTAGRAM", contentType: "REEL", category: "SAFE_ZONE", ruleKey: "meta.reels.safe-zone", value: { instruction: "Ana mesajları ve görsel öğeleri Reels güvenli alanında tut." }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://www.facebook.com/business/ads/facebook-instagram-reels-ads", confidence: 0.98 },
  { platform: "INSTAGRAM", contentType: "REEL", category: "AUDIO", ruleKey: "meta.reels.quality-audio", value: { instruction: "Reels için kaliteli ve içeriğe uygun ses planla." }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://www.facebook.com/business/ads/facebook-instagram-reels-ads", confidence: 0.95 },
  { platform: "INSTAGRAM", contentType: null, category: "ORIGINALITY", ruleKey: "instagram.rights-owned-or-licensed", value: { instruction: "Yalnız işletmenin ürettiği veya kullanım hakkına sahip olduğu içeriği planla." }, recommendationType: "TECHNICAL_REQUIREMENT", source: "OFFICIAL_PLATFORM", sourceUrl: "https://www.facebook.com/help/354736791367645/", confidence: 1 },
  { platform: "INSTAGRAM", contentType: "REEL", category: "AUDIO", ruleKey: "instagram.commercial-music-rights", value: { instruction: "Ticari kullanımda lisans durumunu doğrula; uygun olduğunda Meta Sound Collection kullan." }, recommendationType: "TECHNICAL_REQUIREMENT", source: "OFFICIAL_PLATFORM", sourceUrl: "https://www.facebook.com/help/instagram/402084904469945", confidence: 0.98 },
  { platform: "FACEBOOK", contentType: "REEL", category: "ASPECT_RATIO", ruleKey: "meta.reels.vertical-9-16", value: { recommended: "9:16", appliesTo: ["INSTAGRAM_REELS", "FACEBOOK_REELS"] }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://www.facebook.com/business/ads/facebook-instagram-reels-ads", confidence: 0.98 },
  { platform: "FACEBOOK", contentType: "REEL", category: "SAFE_ZONE", ruleKey: "meta.reels.safe-zone", value: { instruction: "Ana mesajları ve görsel öğeleri Reels güvenli alanında tut." }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://www.facebook.com/business/ads/facebook-instagram-reels-ads", confidence: 0.98 },
  { platform: "FACEBOOK", contentType: "REEL", category: "FORMAT", ruleKey: "facebook.reels.flexible-video", value: { supportedOrientations: "ANY", supportedLength: "ANY", note: "Facebook'un 2025 video/Reels değişikliği sonrası destek bilgisi; performans tavsiyesi değildir." }, recommendationType: "TECHNICAL_REQUIREMENT", source: "OFFICIAL_PLATFORM", sourceUrl: "https://www.facebook.com/help/262748009210134/", confidence: 0.95 },
  { platform: "TIKTOK", contentType: "REEL", category: "ASPECT_RATIO", ruleKey: "tiktok.vertical-9-16", value: { recommended: "9:16", minimumResolution: "720p" }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://ads.tiktok.com/business/en/creative-codes", confidence: 0.98 },
  { platform: "TIKTOK", contentType: "REEL", category: "SAFE_ZONE", ruleKey: "tiktok.ui-safe-space", value: { instruction: "Ana öğeleri TikTok arayüzünün kapatmadığı güvenli alanda tut." }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://ads.tiktok.com/business/en/creative-codes", confidence: 0.98 },
  { platform: "TIKTOK", contentType: "REEL", category: "HOOK", ruleKey: "tiktok.hook-body-close", value: { structure: ["HOOK", "BODY", "CLOSE"], instruction: "Açılışta dikkat çek, gövdede mesajı ver, kapanışta net CTA kullan." }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://ads.tiktok.com/business/en/creative-codes", confidence: 0.95 },
  { platform: "TIKTOK", contentType: "REEL", category: "AUDIO", ruleKey: "tiktok.sound-led", value: { instruction: "İçeriğe uygun müzik, seslendirme veya ses efekti planla." }, recommendationType: "BEST_PRACTICE", source: "OFFICIAL_PLATFORM", sourceUrl: "https://ads.tiktok.com/business/en/creative-codes", confidence: 0.95 },
  { platform: "TIKTOK", contentType: "REEL", category: "SUBTITLES", ruleKey: "tiktok.captions-context", value: { instruction: "Konuşmalı videoda anlamı destekleyen altyazı veya metin katmanı kullan." }, recommendationType: "GENERAL_RECOMMENDATION", source: "OFFICIAL_PLATFORM", sourceUrl: "https://ads.tiktok.com/business/creativecenter/quicktok/online/5_creative_tips/pc/en", confidence: 0.88 },
  // P5-01 görsel analizi için fotoğraf formatlarına yönelik oran önerileri. Ainetra başlangıç önerisidir;
  // platform teknik gerekliliği değildir ve yalnızca uyum değerlendirmesinde okunur.
  { platform: "INSTAGRAM", contentType: "POST", category: "ASPECT_RATIO", ruleKey: "ainetra.aspect.feed-photo", value: { recommended: "4:5", supported: ["1:1", "3:4"], note: "Ainetra başlangıç önerisi; platform kuralı değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.6 },
  { platform: "INSTAGRAM", contentType: "CAROUSEL", category: "ASPECT_RATIO", ruleKey: "ainetra.aspect.feed-photo", value: { recommended: "4:5", supported: ["1:1", "3:4"], note: "Ainetra başlangıç önerisi; platform kuralı değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.6 },
  { platform: "INSTAGRAM", contentType: "STORY", category: "ASPECT_RATIO", ruleKey: "ainetra.aspect.story-photo", value: { recommended: "9:16", note: "Ainetra başlangıç önerisi; platform kuralı değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.6 },
  { platform: "FACEBOOK", contentType: "POST", category: "ASPECT_RATIO", ruleKey: "ainetra.aspect.feed-photo", value: { recommended: "4:5", supported: ["1:1"], note: "Ainetra başlangıç önerisi; platform kuralı değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.6 },
  { platform: "INSTAGRAM", contentType: null, category: "FORMAT", ruleKey: "ainetra.format.planning", value: { contentTypes: ["REEL", "POST", "CAROUSEL", "STORY"], note: "Ainetra planlama kapsamı; yayın API yeteneği değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.8 },
  { platform: "FACEBOOK", contentType: null, category: "FORMAT", ruleKey: "ainetra.format.planning", value: { contentTypes: ["POST", "REEL", "CAROUSEL"], note: "Ainetra planlama kapsamı; yayın API yeteneği değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.8 },
  { platform: "TIKTOK", contentType: null, category: "FORMAT", ruleKey: "ainetra.format.planning", value: { contentTypes: ["REEL"], note: "Ainetra planlama kapsamı; yayın API yeteneği değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.8 },
  { platform: "INSTAGRAM", contentType: null, category: "FREQUENCY", ruleKey: "ainetra.frequency.local-hospitality", value: { minPerWeek: 3, recommendedPerWeek: 4, maxPerWeek: 5, note: "Ainetra başlangıç önerisi; platform kuralı değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.55 },
  { platform: "FACEBOOK", contentType: null, category: "FREQUENCY", ruleKey: "ainetra.frequency.local-hospitality", value: { minPerWeek: 2, recommendedPerWeek: 3, maxPerWeek: 4, note: "Ainetra başlangıç önerisi; platform kuralı değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.55 },
  { platform: "TIKTOK", contentType: null, category: "FREQUENCY", ruleKey: "ainetra.frequency.local-hospitality", value: { minPerWeek: 2, recommendedPerWeek: 3, maxPerWeek: 4, note: "Ainetra başlangıç önerisi; platform kuralı değildir." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.5 },
  { platform: "INSTAGRAM", contentType: null, category: "POSTING_TIME", ruleKey: "ainetra.time.local-hospitality", value: { localTimes: ["12:30", "19:30"], note: "İşletme verisi birikene kadar kullanılan düşük güvenli başlangıç önerisi." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.4 },
  { platform: "FACEBOOK", contentType: null, category: "POSTING_TIME", ruleKey: "ainetra.time.local-hospitality", value: { localTimes: ["12:00", "18:30"], note: "İşletme verisi birikene kadar kullanılan düşük güvenli başlangıç önerisi." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.4 },
  { platform: "TIKTOK", contentType: null, category: "POSTING_TIME", ruleKey: "ainetra.time.local-hospitality", value: { localTimes: ["18:30", "21:00"], note: "İşletme verisi birikene kadar kullanılan düşük güvenli başlangıç önerisi." }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.4 },
  { platform: "INSTAGRAM", contentType: null, category: "CONTENT_DIVERSITY", ruleKey: "ainetra.mix.local-hospitality", value: { recommendedMix: { PRODUCT: 25, ATMOSPHERE: 20, PEOPLE: 15, SOCIAL_PROOF: 10, EDUCATIONAL: 10, PROMOTIONAL: 10, BEHIND_THE_SCENES: 10 } }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.55 },
  { platform: "FACEBOOK", contentType: null, category: "CONTENT_DIVERSITY", ruleKey: "ainetra.mix.local-hospitality", value: { recommendedMix: { PRODUCT: 20, ATMOSPHERE: 15, PEOPLE: 15, SOCIAL_PROOF: 15, EDUCATIONAL: 15, PROMOTIONAL: 10, COMMUNITY: 10 } }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.55 },
  { platform: "TIKTOK", contentType: null, category: "CONTENT_DIVERSITY", ruleKey: "ainetra.mix.local-hospitality", value: { recommendedMix: { PRODUCT: 20, ATMOSPHERE: 15, PEOPLE: 15, EDUCATIONAL: 15, BEHIND_THE_SCENES: 20, TREND: 10, PROMOTIONAL: 5 } }, recommendationType: "GENERAL_RECOMMENDATION", source: "MANUAL_ADMIN_RULE", sourceUrl: null, confidence: 0.5 },
] as const;

async function seedPlatformRules() {
  for (const rule of platformRuleSeeds) {
    const existing = await prisma.platformRule.findFirst({
      where: { businessId: null, platform: rule.platform, contentType: rule.contentType, ruleKey: rule.ruleKey, effectiveFrom: reviewedAt },
    });
    const data = { ...rule, businessId: null, effectiveFrom: reviewedAt, reviewedAt, sectorScope: rule.source === "OFFICIAL_PLATFORM" ? [] : ["RESTAURANT", "HOTEL", "LOCAL_BUSINESS"], active: true };
    if (existing) await prisma.platformRule.update({ where: { id: existing.id }, data });
    else await prisma.platformRule.create({ data });
  }
}

async function createDemoImage(storageKey: string, color: string, title: string) {
  const target = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_ROOT ?? ".data/uploads", storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  const svg = `<svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1500" fill="${color}"/><circle cx="940" cy="260" r="330" fill="#ffffff18"/><text x="90" y="1180" fill="#fff8e8" font-family="Georgia" font-size="105">${title}</text><text x="96" y="1270" fill="#e9ad45" font-family="Arial" font-size="34" letter-spacing="8">MIMOZA BODRUM</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(target, bytes);
  return bytes.length;
}

async function main() {
  await seedPlatformRules();
  const email = "owner@mimoza.test";
  const existing = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  if (existing?.memberships.length) {
    const existingBusinessId = existing.memberships[0].businessId;
    await prisma.mediaAsset.updateMany({ where: { businessId: existingBusinessId, originalFilename: { contains: "steak" } }, data: { tags: ["PHOTO_PRODUCT"] } });
    await prisma.mediaAsset.updateMany({ where: { businessId: existingBusinessId, originalFilename: { contains: "sunset" } }, data: { tags: ["PHOTO_ATMOSPHERE"] } });
    const tableAsset = await prisma.mediaAsset.findFirst({ where: { businessId: existingBusinessId, originalFilename: { contains: "table" } } });
    if (tableAsset) {
      await prisma.mediaAsset.update({ where: { id: tableAsset.id }, data: { tags: ["PHOTO_ATMOSPHERE"] } });
      await prisma.contentPlanItem.updateMany({ where: { mediaAssetId: tableAsset.id, mediaRequirement: "PHOTO_PEOPLE" }, data: { mediaAssetId: null, mediaAvailability: "MISSING" } });
    }
    console.log("Platform rules and demo media tags refreshed; existing demo records preserved.");
    return;
  }

  const user = existing ?? await prisma.user.create({
    data: { name: "Deniz Kaya", email, passwordHash: await hashPassword("Ainetra123!") },
  });
  const business = await prisma.business.create({
    data: {
      name: "Mimoza Bodrum Restaurant",
      sector: "RESTAURANT",
      location: "Yalıkavak, Bodrum",
      website: "https://example.com",
      instagramHandle: "@mimozabodrum",
      timezone: "Europe/Istanbul",
      memberships: { create: { userId: user.id, role: "OWNER" } },
      brandProfile: {
        create: {
          description: "Ege kıyısının taze ürünlerini modern tabaklarla sunan samimi bir Bodrum restoranı.",
          targetAudience: "Bodrum'da iyi yemek, gün batımı ve seçkin ama rahat bir deneyim arayan yerli ve yabancı misafirler.",
          languages: ["tr", "en"],
          productsSummary: "Mevsimsel Ege mutfağı, steak seçenekleri, imza kokteyller ve canlı müzik akşamları.",
          toneDimensions: { corporateFriendly: 78, minimalVibrant: 58, luxuryAccessible: 34, modernNatural: 55, seriousPlayful: 38 },
        },
      },
    },
  });
  const [primaryGoal, secondaryGoal] = await Promise.all([
    prisma.businessGoal.create({ data: { businessId: business.id, type: "RESERVATIONS", priority: "PRIMARY" } }),
    prisma.businessGoal.create({ data: { businessId: business.id, type: "BRAND_AWARENESS", priority: "SECONDARY" } }),
  ]);
  const instagram = await prisma.socialAccount.create({
    data: { businessId: business.id, platform: "INSTAGRAM", displayName: "@mimozabodrum (Demo)", externalAccountId: "demo-instagram-001", status: "DISCONNECTED" },
  });

  const mediaInputs = [
    ["seed/mimoza-steak.png", "#6e3329", "Friday Steak"],
    ["seed/mimoza-sunset.png", "#b87043", "Bodrum Sunset"],
    ["seed/mimoza-table.png", "#31584c", "Mimoza Table"],
  ] as const;
  const media = [];
  for (const [storageKey, color, title] of mediaInputs) {
    const size = await createDemoImage(`${business.id}/${storageKey}`, color, title);
    const tags = storageKey.includes("steak") ? ["PHOTO_PRODUCT"] : ["PHOTO_ATMOSPHERE"];
    media.push(await prisma.mediaAsset.create({ data: { businessId: business.id, originalFilename: storageKey.split("/").at(-1)!, mimeType: "image/png", size, width: 1200, height: 1500, storageKey: `${business.id}/${storageKey}`, tags } }));
  }

  await prisma.contentItem.create({
    data: { businessId: business.id, goalId: secondaryGoal.id, title: "Bodrum gün batımı", topic: "Gün batımı ve kokteyl", contentType: "POST", variants: { create: { platform: "INSTAGRAM", caption: "Bodrum'un altın saatinde masanız hazır. Gün batımına bir Mimoza imzası ekleyin.", cta: "Bu akşam için yerinizi ayırtın.", mediaAssetId: media[1].id, aspectRatio: "4:5" } } },
  });
  const approved = await prisma.contentItem.create({
    data: { businessId: business.id, goalId: primaryGoal.id, title: "Cuma steak gecesi", topic: "Steak, şarap ve rezervasyon", contentType: "REEL", status: "ACTIVE", variants: { create: { platform: "INSTAGRAM", caption: "Ateşin sesi, iyi bir kadeh ve Bodrum gecesi. Cuma akşamı Mimoza'da buluşalım.", cta: "Rezervasyon için DM gönderin.", mediaAssetId: media[0].id, aspectRatio: "9:16" } } },
    include: { variants: true },
  });
  await prisma.approval.create({ data: { contentVariantId: approved.variants[0].id, approvedVersion: 1, approvedById: user.id } });
  const scheduled = await prisma.contentItem.create({
    data: { businessId: business.id, goalId: primaryGoal.id, title: "Pazar sofrası", topic: "Uzun pazar öğle yemeği", contentType: "CAROUSEL", status: "ACTIVE", variants: { create: { platform: "INSTAGRAM", caption: "Pazar sofraları aceleye gelmez. Mevsim tabakları ve uzun sohbetler için yerinizi hazırladık.", cta: "Masanızı şimdi ayırtın.", mediaAssetId: media[2].id, aspectRatio: "4:5" } } },
    include: { variants: true },
  });
  await prisma.approval.create({ data: { contentVariantId: scheduled.variants[0].id, approvedVersion: 1, approvedById: user.id } });
  await prisma.scheduledPost.create({ data: { businessId: business.id, socialAccountId: instagram.id, contentVariantId: scheduled.variants[0].id, contentVersion: 1, scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) } });
  console.log("Seed completed: owner@mimoza.test / Ainetra123!");
}

main().finally(() => prisma.$disconnect());
