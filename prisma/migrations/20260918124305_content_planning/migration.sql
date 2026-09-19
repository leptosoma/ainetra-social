-- CreateEnum
CREATE TYPE "PlatformRuleCategory" AS ENUM ('FREQUENCY', 'FORMAT', 'ASPECT_RATIO', 'VIDEO_LENGTH', 'HOOK', 'SAFE_ZONE', 'CAPTION', 'CTA', 'ORIGINALITY', 'CONTENT_DIVERSITY', 'POSTING_TIME', 'AUDIO', 'SUBTITLES');

-- CreateEnum
CREATE TYPE "PlatformRecommendationType" AS ENUM ('TECHNICAL_REQUIREMENT', 'BEST_PRACTICE', 'GENERAL_RECOMMENDATION', 'BUSINESS_LEARNED');

-- CreateEnum
CREATE TYPE "PlatformRuleSource" AS ENUM ('OFFICIAL_PLATFORM', 'VERIFIED_INTERNAL_ANALYSIS', 'BUSINESS_PERFORMANCE', 'MANUAL_ADMIN_RULE');

-- CreateEnum
CREATE TYPE "ContentStrategyMode" AS ENUM ('AINETRA_RECOMMENDED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ContentPlanPeriod" AS ENUM ('SEVEN_DAYS', 'THIRTY_DAYS');

-- CreateEnum
CREATE TYPE "ContentPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ContentPlanItemStatus" AS ENUM ('ACTIVE', 'REPLACED');

-- CreateEnum
CREATE TYPE "MediaRequirement" AS ENUM ('PHOTO_PRODUCT', 'PHOTO_ATMOSPHERE', 'PHOTO_PEOPLE', 'VIDEO_VERTICAL', 'VIDEO_KITCHEN', 'CUSTOM_GRAPHIC', 'NO_NEW_MEDIA_REQUIRED');

-- CreateEnum
CREATE TYPE "MediaAvailability" AS ENUM ('AVAILABLE', 'MISSING', 'NOT_REQUIRED');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "PlatformRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "contentType" "ContentType",
    "category" "PlatformRuleCategory" NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "recommendationType" "PlatformRecommendationType" NOT NULL,
    "source" "PlatformRuleSource" NOT NULL,
    "sourceUrl" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sectorScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentStrategy" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mode" "ContentStrategyMode" NOT NULL DEFAULT 'AINETRA_RECOMMENDED',
    "platformSettings" JSONB NOT NULL,
    "contentMix" JSONB NOT NULL,
    "languages" TEXT[],
    "rationale" TEXT NOT NULL,
    "userOverrideFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "period" "ContentPlanPeriod" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ContentPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "strategySummary" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "recommendedTime" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "hookCategory" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "captionDirection" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "mediaRequirement" "MediaRequirement" NOT NULL,
    "mediaAvailability" "MediaAvailability" NOT NULL,
    "mediaAssetId" TEXT,
    "reasoning" TEXT NOT NULL,
    "platformRulesApplied" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "ContentPlanItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "replacesItemId" TEXT,
    "contentItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformRule_platform_active_effectiveFrom_idx" ON "PlatformRule"("platform", "active", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PlatformRule_businessId_platform_active_idx" ON "PlatformRule"("businessId", "platform", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformRule_businessId_platform_contentType_ruleKey_effect_key" ON "PlatformRule"("businessId", "platform", "contentType", "ruleKey", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ContentStrategy_businessId_key" ON "ContentStrategy"("businessId");

-- CreateIndex
CREATE INDEX "ContentPlan_businessId_period_status_createdAt_idx" ON "ContentPlan"("businessId", "period", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentPlan_strategyId_idx" ON "ContentPlan"("strategyId");

-- CreateIndex
CREATE INDEX "ContentPlan_approvedById_idx" ON "ContentPlan"("approvedById");

-- CreateIndex
CREATE INDEX "ContentPlan_supersedesId_idx" ON "ContentPlan"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPlan_businessId_period_startDate_version_key" ON "ContentPlan"("businessId", "period", "startDate", "version");

-- CreateIndex
CREATE INDEX "ContentPlanItem_planId_status_plannedDate_idx" ON "ContentPlanItem"("planId", "status", "plannedDate");

-- CreateIndex
CREATE INDEX "ContentPlanItem_goalId_idx" ON "ContentPlanItem"("goalId");

-- CreateIndex
CREATE INDEX "ContentPlanItem_mediaAssetId_idx" ON "ContentPlanItem"("mediaAssetId");

-- CreateIndex
CREATE INDEX "ContentPlanItem_replacesItemId_idx" ON "ContentPlanItem"("replacesItemId");

-- CreateIndex
CREATE INDEX "ContentPlanItem_contentItemId_idx" ON "ContentPlanItem"("contentItemId");

-- AddForeignKey
ALTER TABLE "PlatformRule" ADD CONSTRAINT "PlatformRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentStrategy" ADD CONSTRAINT "ContentStrategy_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "ContentStrategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ContentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanItem" ADD CONSTRAINT "ContentPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanItem" ADD CONSTRAINT "ContentPlanItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "BusinessGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanItem" ADD CONSTRAINT "ContentPlanItem_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanItem" ADD CONSTRAINT "ContentPlanItem_replacesItemId_fkey" FOREIGN KEY ("replacesItemId") REFERENCES "ContentPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanItem" ADD CONSTRAINT "ContentPlanItem_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
