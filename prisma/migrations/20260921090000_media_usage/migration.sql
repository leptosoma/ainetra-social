-- CreateEnum
CREATE TYPE "MediaUsageType" AS ENUM ('EXPORTED');

-- AlterTable
-- Geçici DEFAULT: tablo şu ana kadar hiçbir üretim servisi tarafından yazılmadı, ancak
-- mevcut satır olsa bile NOT NULL eklemenin güvenli olması için önce varsayılanla eklenir,
-- ardından varsayılan kaldırılır (şema modelinde default yoktur).
ALTER TABLE "MediaUsage" ADD COLUMN "usageType" "MediaUsageType" NOT NULL DEFAULT 'EXPORTED';
ALTER TABLE "MediaUsage" ALTER COLUMN "usageType" DROP DEFAULT;
ALTER TABLE "MediaUsage" ALTER COLUMN "mediaRequirement" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MediaUsage_contentVariantId_mediaAssetId_usageType_key" ON "MediaUsage"("contentVariantId", "mediaAssetId", "usageType");
