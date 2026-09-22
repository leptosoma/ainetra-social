-- CreateEnum
CREATE TYPE "MediaAssetOrigin" AS ENUM ('UPLOAD', 'SAFE_ENHANCE');

-- CreateEnum
CREATE TYPE "MediaEnhancementPreset" AS ENUM ('NATURAL', 'BRIGHT', 'CLEAN', 'WARM');

-- CreateEnum
CREATE TYPE "MediaEnhancementStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'INVALID_OUTPUT');

-- CreateEnum
CREATE TYPE "MediaEnhancementDecision" AS ENUM ('KEPT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "MediaEnhancementProvenance" AS ENUM ('REAL', 'DEVELOPMENT');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "derivedFromId" TEXT,
ADD COLUMN     "origin" "MediaAssetOrigin" NOT NULL DEFAULT 'UPLOAD';

-- CreateTable
CREATE TABLE "MediaEnhancement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "preset" "MediaEnhancementPreset" NOT NULL,
    "status" "MediaEnhancementStatus" NOT NULL DEFAULT 'PENDING',
    "decision" "MediaEnhancementDecision",
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provenance" "MediaEnhancementProvenance" NOT NULL,
    "parameterVersion" TEXT NOT NULL,
    "operations" JSONB,
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

    CONSTRAINT "MediaEnhancement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaEnhancement_outputStorageKey_key" ON "MediaEnhancement"("outputStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaEnhancement_outputAssetId_key" ON "MediaEnhancement"("outputAssetId");

-- CreateIndex
CREATE INDEX "MediaEnhancement_businessId_createdAt_idx" ON "MediaEnhancement"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaEnhancement_sourceAssetId_preset_status_idx" ON "MediaEnhancement"("sourceAssetId", "preset", "status");

-- CreateIndex
CREATE INDEX "MediaEnhancement_triggeredById_idx" ON "MediaEnhancement"("triggeredById");

-- CreateIndex
CREATE INDEX "MediaEnhancement_decidedById_idx" ON "MediaEnhancement"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaEnhancement_sourceAssetId_version_key" ON "MediaEnhancement"("sourceAssetId", "version");

-- CreateIndex
CREATE INDEX "MediaAsset_derivedFromId_idx" ON "MediaAsset"("derivedFromId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_derivedFromId_fkey" FOREIGN KEY ("derivedFromId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaEnhancement" ADD CONSTRAINT "MediaEnhancement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaEnhancement" ADD CONSTRAINT "MediaEnhancement_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaEnhancement" ADD CONSTRAINT "MediaEnhancement_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaEnhancement" ADD CONSTRAINT "MediaEnhancement_sourceAnalysisId_fkey" FOREIGN KEY ("sourceAnalysisId") REFERENCES "MediaAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaEnhancement" ADD CONSTRAINT "MediaEnhancement_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaEnhancement" ADD CONSTRAINT "MediaEnhancement_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
