-- AlterEnum
ALTER TYPE "MediaAssetOrigin" ADD VALUE 'BRAND_STYLE';

-- CreateEnum
CREATE TYPE "MediaBrandStyleChoice" AS ENUM ('BRAND_RECOMMENDED', 'NATURAL', 'VIBRANT', 'PREMIUM');

-- CreateEnum
CREATE TYPE "MediaBrandStyleStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'INVALID_OUTPUT');

-- CreateEnum
CREATE TYPE "MediaBrandStyleDecision" AS ENUM ('KEPT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "MediaBrandStyleProvenance" AS ENUM ('REAL', 'DEVELOPMENT');

-- CreateEnum
CREATE TYPE "MediaBrandStyleAuthenticityTier" AS ENUM ('RELAXED', 'STANDARD', 'STRICT');

-- CreateTable
CREATE TABLE "MediaBrandStyle" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "sourceEnhancementId" TEXT,
    "version" INTEGER NOT NULL,
    "choice" "MediaBrandStyleChoice" NOT NULL,
    "status" "MediaBrandStyleStatus" NOT NULL DEFAULT 'PENDING',
    "decision" "MediaBrandStyleDecision",
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provenance" "MediaBrandStyleProvenance" NOT NULL,
    "styleVersion" TEXT NOT NULL,
    "profileVersion" TEXT NOT NULL,
    "brandProfileId" TEXT,
    "brandProfileUpdatedAt" TIMESTAMP(3),
    "styleProfile" JSONB,
    "operations" JSONB,
    "authenticityTier" "MediaBrandStyleAuthenticityTier" NOT NULL DEFAULT 'STRICT',
    "authenticitySensitive" BOOLEAN NOT NULL DEFAULT true,
    "sourceAnalysisId" TEXT,
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

    CONSTRAINT "MediaBrandStyle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaBrandStyle_outputStorageKey_key" ON "MediaBrandStyle"("outputStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaBrandStyle_outputAssetId_key" ON "MediaBrandStyle"("outputAssetId");

-- CreateIndex
CREATE INDEX "MediaBrandStyle_businessId_createdAt_idx" ON "MediaBrandStyle"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaBrandStyle_sourceAssetId_choice_status_idx" ON "MediaBrandStyle"("sourceAssetId", "choice", "status");

-- CreateIndex
CREATE INDEX "MediaBrandStyle_sourceEnhancementId_idx" ON "MediaBrandStyle"("sourceEnhancementId");

-- CreateIndex
CREATE INDEX "MediaBrandStyle_brandProfileId_idx" ON "MediaBrandStyle"("brandProfileId");

-- CreateIndex
CREATE INDEX "MediaBrandStyle_triggeredById_idx" ON "MediaBrandStyle"("triggeredById");

-- CreateIndex
CREATE INDEX "MediaBrandStyle_decidedById_idx" ON "MediaBrandStyle"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaBrandStyle_sourceAssetId_version_key" ON "MediaBrandStyle"("sourceAssetId", "version");

-- AddForeignKey
ALTER TABLE "MediaBrandStyle" ADD CONSTRAINT "MediaBrandStyle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBrandStyle" ADD CONSTRAINT "MediaBrandStyle_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBrandStyle" ADD CONSTRAINT "MediaBrandStyle_sourceEnhancementId_fkey" FOREIGN KEY ("sourceEnhancementId") REFERENCES "MediaEnhancement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBrandStyle" ADD CONSTRAINT "MediaBrandStyle_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBrandStyle" ADD CONSTRAINT "MediaBrandStyle_sourceAnalysisId_fkey" FOREIGN KEY ("sourceAnalysisId") REFERENCES "MediaAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBrandStyle" ADD CONSTRAINT "MediaBrandStyle_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBrandStyle" ADD CONSTRAINT "MediaBrandStyle_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBrandStyle" ADD CONSTRAINT "MediaBrandStyle_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
