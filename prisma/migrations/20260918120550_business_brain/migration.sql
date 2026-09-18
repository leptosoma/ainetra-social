-- CreateEnum
CREATE TYPE "BusinessAnalysisStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'INVALID_OUTPUT');

-- CreateEnum
CREATE TYPE "BusinessAttributeSource" AS ENUM ('USER', 'WEBSITE', 'INSTAGRAM', 'AI_INFERENCE', 'IMPORT');

-- CreateEnum
CREATE TYPE "BusinessAttributeStatus" AS ENUM ('CONFIRMED', 'INFERRED', 'NEEDS_CONFIRMATION', 'REJECTED');

-- CreateEnum
CREATE TYPE "BusinessAttributeCategory" AS ENUM ('DESCRIPTION', 'PRODUCTS_SERVICES', 'TARGET_AUDIENCE', 'LANGUAGE', 'BRAND_TONE', 'BRAND_PERSONALITY', 'LOCATION_CONTEXT', 'WEBSITE', 'INSTAGRAM_IDENTITY', 'BUSINESS_GOAL', 'FACT', 'RESTRICTION', 'AVOID_WORD', 'NOTE');

-- CreateTable
CREATE TABLE "BusinessAnalysisRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "triggeredById" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputSources" JSONB NOT NULL,
    "outputSnapshot" JSONB,
    "status" "BusinessAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessAttribute" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "analysisRunId" TEXT,
    "category" "BusinessAttributeCategory" NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" "BusinessAttributeSource" NOT NULL,
    "sourceReference" TEXT,
    "confidence" DOUBLE PRECISION,
    "verificationStatus" "BusinessAttributeStatus" NOT NULL,
    "isCanonical" BOOLEAN NOT NULL DEFAULT false,
    "supersedesId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessAnalysisRun_businessId_status_createdAt_idx" ON "BusinessAnalysisRun"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessAnalysisRun_triggeredById_idx" ON "BusinessAnalysisRun"("triggeredById");

-- CreateIndex
CREATE INDEX "BusinessAttribute_businessId_key_idx" ON "BusinessAttribute"("businessId", "key");

-- CreateIndex
CREATE INDEX "BusinessAttribute_businessId_category_verificationStatus_idx" ON "BusinessAttribute"("businessId", "category", "verificationStatus");

-- CreateIndex
CREATE INDEX "BusinessAttribute_analysisRunId_idx" ON "BusinessAttribute"("analysisRunId");

-- CreateIndex
CREATE INDEX "BusinessAttribute_supersedesId_idx" ON "BusinessAttribute"("supersedesId");

-- CreateIndex
CREATE INDEX "BusinessAttribute_confirmedById_idx" ON "BusinessAttribute"("confirmedById");

-- AddForeignKey
ALTER TABLE "BusinessAnalysisRun" ADD CONSTRAINT "BusinessAnalysisRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAnalysisRun" ADD CONSTRAINT "BusinessAnalysisRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAttribute" ADD CONSTRAINT "BusinessAttribute_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAttribute" ADD CONSTRAINT "BusinessAttribute_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "BusinessAnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAttribute" ADD CONSTRAINT "BusinessAttribute_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "BusinessAttribute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAttribute" ADD CONSTRAINT "BusinessAttribute_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only one trusted value can be active for a logical business attribute.
CREATE UNIQUE INDEX "BusinessAttribute_one_canonical_key"
ON "BusinessAttribute"("businessId", "key")
WHERE "isCanonical" = true;

-- Keep confidence and canonical state valid even when data is written outside Prisma.
ALTER TABLE "BusinessAttribute"
ADD CONSTRAINT "BusinessAttribute_confidence_range"
CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "BusinessAttribute"
ADD CONSTRAINT "BusinessAttribute_ai_confidence_required"
CHECK ("source" <> 'AI_INFERENCE' OR "confidence" IS NOT NULL);

ALTER TABLE "BusinessAttribute"
ADD CONSTRAINT "BusinessAttribute_canonical_is_confirmed"
CHECK (NOT "isCanonical" OR "verificationStatus" = 'CONFIRMED');
