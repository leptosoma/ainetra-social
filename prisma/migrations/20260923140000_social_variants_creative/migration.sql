-- AlterEnum
ALTER TYPE "MediaAssetOrigin" ADD VALUE 'SOCIAL_VARIANT';
ALTER TYPE "MediaAssetOrigin" ADD VALUE 'CREATIVE_CAMPAIGN';

-- CreateEnum
CREATE TYPE "MediaSocialVariantFormat" AS ENUM ('FEED', 'STORY', 'REEL_COVER', 'SQUARE');

-- CreateEnum
CREATE TYPE "MediaSocialVariantFit" AS ENUM ('COVER', 'CONTAIN');

-- CreateEnum
CREATE TYPE "MediaSocialVariantStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'INVALID_OUTPUT');

-- CreateEnum
CREATE TYPE "MediaSocialVariantDecision" AS ENUM ('KEPT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "MediaSocialVariantProvenance" AS ENUM ('REAL', 'DEVELOPMENT');

-- CreateEnum
CREATE TYPE "MediaCreativeCategory" AS ENUM ('BUSINESS_INTRO', 'PRODUCTS_SERVICES', 'LOCATION_INFO', 'CONFIRMED_FACTS');

-- CreateEnum
CREATE TYPE "MediaCreativeStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'INVALID_OUTPUT');

-- CreateEnum
CREATE TYPE "MediaCreativeDecision" AS ENUM ('KEPT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "MediaCreativeProvenance" AS ENUM ('REAL', 'DEVELOPMENT');

-- CreateTable
CREATE TABLE "MediaSocialVariant" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "rootAssetId" TEXT,
    "sourceEnhancementId" TEXT,
    "sourceBrandStyleId" TEXT,
    "sourceAnalysisId" TEXT,
    "version" INTEGER NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "format" "MediaSocialVariantFormat" NOT NULL,
    "status" "MediaSocialVariantStatus" NOT NULL DEFAULT 'PENDING',
    "decision" "MediaSocialVariantDecision",
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provenance" "MediaSocialVariantProvenance" NOT NULL,
    "variantVersion" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "ruleEffectiveFrom" TIMESTAMP(3) NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "targetAspectRatio" TEXT NOT NULL,
    "fit" "MediaSocialVariantFit" NOT NULL,
    "reviewNeeded" BOOLEAN NOT NULL DEFAULT false,
    "operations" JSONB,
    "outputStorageKey" TEXT,
    "outputMimeType" TEXT,
    "outputSize" INTEGER,
    "outputWidth" INTEGER,
    "outputHeight" INTEGER,
    "outputAssetId" TEXT,
    "errorCode" TEXT,
    "triggeredById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaSocialVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaCreativeCampaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "category" "MediaCreativeCategory" NOT NULL,
    "status" "MediaCreativeStatus" NOT NULL DEFAULT 'PENDING',
    "decision" "MediaCreativeDecision",
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provenance" "MediaCreativeProvenance" NOT NULL,
    "creativeVersion" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "format" "MediaSocialVariantFormat" NOT NULL,
    "ruleId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "ruleEffectiveFrom" TIMESTAMP(3) NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "targetAspectRatio" TEXT NOT NULL,
    "factRefs" JSONB NOT NULL,
    "copy" JSONB NOT NULL,
    "brandProfileId" TEXT,
    "brandProfileUpdatedAt" TIMESTAMP(3),
    "brandSnapshot" JSONB NOT NULL,
    "sourceAssetId" TEXT,
    "rootAssetId" TEXT,
    "outputStorageKey" TEXT,
    "outputMimeType" TEXT,
    "outputSize" INTEGER,
    "outputWidth" INTEGER,
    "outputHeight" INTEGER,
    "outputAssetId" TEXT,
    "errorCode" TEXT,
    "triggeredById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaCreativeCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaSocialVariant_outputStorageKey_key" ON "MediaSocialVariant"("outputStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaSocialVariant_outputAssetId_key" ON "MediaSocialVariant"("outputAssetId");

-- CreateIndex
CREATE INDEX "MediaSocialVariant_businessId_createdAt_idx" ON "MediaSocialVariant"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaSocialVariant_sourceAssetId_platform_format_status_idx" ON "MediaSocialVariant"("sourceAssetId", "platform", "format", "status");

-- CreateIndex
CREATE INDEX "MediaSocialVariant_rootAssetId_idx" ON "MediaSocialVariant"("rootAssetId");

-- CreateIndex
CREATE INDEX "MediaSocialVariant_sourceEnhancementId_idx" ON "MediaSocialVariant"("sourceEnhancementId");

-- CreateIndex
CREATE INDEX "MediaSocialVariant_sourceBrandStyleId_idx" ON "MediaSocialVariant"("sourceBrandStyleId");

-- CreateIndex
CREATE INDEX "MediaSocialVariant_ruleId_idx" ON "MediaSocialVariant"("ruleId");

-- CreateIndex
CREATE INDEX "MediaSocialVariant_triggeredById_idx" ON "MediaSocialVariant"("triggeredById");

-- CreateIndex
CREATE INDEX "MediaSocialVariant_decidedById_idx" ON "MediaSocialVariant"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaSocialVariant_sourceAssetId_version_key" ON "MediaSocialVariant"("sourceAssetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MediaCreativeCampaign_outputStorageKey_key" ON "MediaCreativeCampaign"("outputStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaCreativeCampaign_outputAssetId_key" ON "MediaCreativeCampaign"("outputAssetId");

-- CreateIndex
CREATE INDEX "MediaCreativeCampaign_businessId_createdAt_idx" ON "MediaCreativeCampaign"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaCreativeCampaign_businessId_category_status_idx" ON "MediaCreativeCampaign"("businessId", "category", "status");

-- CreateIndex
CREATE INDEX "MediaCreativeCampaign_sourceAssetId_idx" ON "MediaCreativeCampaign"("sourceAssetId");

-- CreateIndex
CREATE INDEX "MediaCreativeCampaign_rootAssetId_idx" ON "MediaCreativeCampaign"("rootAssetId");

-- CreateIndex
CREATE INDEX "MediaCreativeCampaign_brandProfileId_idx" ON "MediaCreativeCampaign"("brandProfileId");

-- CreateIndex
CREATE INDEX "MediaCreativeCampaign_ruleId_idx" ON "MediaCreativeCampaign"("ruleId");

-- CreateIndex
CREATE INDEX "MediaCreativeCampaign_triggeredById_idx" ON "MediaCreativeCampaign"("triggeredById");

-- CreateIndex
CREATE INDEX "MediaCreativeCampaign_decidedById_idx" ON "MediaCreativeCampaign"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaCreativeCampaign_businessId_version_key" ON "MediaCreativeCampaign"("businessId", "version");

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_rootAssetId_fkey" FOREIGN KEY ("rootAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_sourceEnhancementId_fkey" FOREIGN KEY ("sourceEnhancementId") REFERENCES "MediaEnhancement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_sourceBrandStyleId_fkey" FOREIGN KEY ("sourceBrandStyleId") REFERENCES "MediaBrandStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_sourceAnalysisId_fkey" FOREIGN KEY ("sourceAnalysisId") REFERENCES "MediaAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PlatformRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSocialVariant" ADD CONSTRAINT "MediaSocialVariant_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCreativeCampaign" ADD CONSTRAINT "MediaCreativeCampaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCreativeCampaign" ADD CONSTRAINT "MediaCreativeCampaign_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCreativeCampaign" ADD CONSTRAINT "MediaCreativeCampaign_rootAssetId_fkey" FOREIGN KEY ("rootAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCreativeCampaign" ADD CONSTRAINT "MediaCreativeCampaign_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCreativeCampaign" ADD CONSTRAINT "MediaCreativeCampaign_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCreativeCampaign" ADD CONSTRAINT "MediaCreativeCampaign_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PlatformRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCreativeCampaign" ADD CONSTRAINT "MediaCreativeCampaign_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCreativeCampaign" ADD CONSTRAINT "MediaCreativeCampaign_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
