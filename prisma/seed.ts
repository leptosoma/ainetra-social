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

async function createDemoImage(storageKey: string, color: string, title: string) {
  const target = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_ROOT ?? ".data/uploads", storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  const svg = `<svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1500" fill="${color}"/><circle cx="940" cy="260" r="330" fill="#ffffff18"/><text x="90" y="1180" fill="#fff8e8" font-family="Georgia" font-size="105">${title}</text><text x="96" y="1270" fill="#e9ad45" font-family="Arial" font-size="34" letter-spacing="8">MIMOZA BODRUM</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(target, bytes);
  return bytes.length;
}

async function main() {
  const email = "owner@mimoza.test";
  const existing = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  if (existing?.memberships.length) {
    console.log("Seed data already exists; no records changed.");
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
    media.push(await prisma.mediaAsset.create({ data: { businessId: business.id, originalFilename: storageKey.split("/").at(-1)!, mimeType: "image/png", size, width: 1200, height: 1500, storageKey: `${business.id}/${storageKey}` } }));
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
