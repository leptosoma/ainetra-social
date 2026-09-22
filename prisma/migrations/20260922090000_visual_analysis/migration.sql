-- CreateEnum
CREATE TYPE "MediaAnalysisStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'INVALID_OUTPUT');

-- CreateEnum
CREATE TYPE "MediaAnalysisProvenance" AS ENUM ('REAL', 'DEVELOPMENT');

-- CreateEnum
CREATE TYPE "VisualCategory" AS ENUM ('FOOD', 'DRINK', 'INTERIOR', 'EXTERIOR', 'PEOPLE', 'TEAM', 'PRODUCT', 'SERVICE', 'EVENT', 'GRAPHIC', 'OTHER', 'UNKNOWN');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "currentAnalysisId" TEXT;

-- CreateTable
CREATE TABLE "MediaAnalysis" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "MediaAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provenance" "MediaAnalysisProvenance" NOT NULL,
    "analysisVersion" TEXT NOT NULL,
    "category" "VisualCategory",
    "result" JSONB,
    "errorCode" TEXT,
    "triggeredById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAnalysis_businessId_createdAt_idx" ON "MediaAnalysis"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAnalysis_triggeredById_idx" ON "MediaAnalysis"("triggeredById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAnalysis_mediaAssetId_version_key" ON "MediaAnalysis"("mediaAssetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_currentAnalysisId_key" ON "MediaAsset"("currentAnalysisId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_currentAnalysisId_fkey" FOREIGN KEY ("currentAnalysisId") REFERENCES "MediaAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAnalysis" ADD CONSTRAINT "MediaAnalysis_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAnalysis" ADD CONSTRAINT "MediaAnalysis_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAnalysis" ADD CONSTRAINT "MediaAnalysis_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
