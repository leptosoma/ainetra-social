-- CreateEnum
CREATE TYPE "ContentFallbackKind" AS ENUM ('UNUSED_AUTHENTIC_MEDIA', 'OLDER_UNUSED_AUTHENTIC_MEDIA', 'REUSABLE_AUTHENTIC_MEDIA', 'FORMAT_ADAPTATION', 'CONFIRMED_BUSINESS_INFO', 'VERIFIED_SOCIAL_PROOF', 'BRAND_CREATIVE_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "ContentFallbackProposalStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'INVALIDATED');

-- CreateTable
CREATE TABLE "ContentFallbackProposal" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "contentPlanItemId" TEXT NOT NULL,
    "itemRevision" INTEGER NOT NULL,
    "kind" "ContentFallbackKind" NOT NULL,
    "mediaAssetId" TEXT,
    "targetMediaRequirement" "MediaRequirement" NOT NULL,
    "rationale" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "ContentFallbackProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentFallbackProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentFallbackProposal_contentPlanItemId_status_idx" ON "ContentFallbackProposal"("contentPlanItemId", "status");

-- CreateIndex
CREATE INDEX "ContentFallbackProposal_businessId_status_createdAt_idx" ON "ContentFallbackProposal"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentFallbackProposal_planId_idx" ON "ContentFallbackProposal"("planId");

-- CreateIndex
CREATE INDEX "ContentFallbackProposal_mediaAssetId_idx" ON "ContentFallbackProposal"("mediaAssetId");

-- CreateIndex
CREATE INDEX "ContentFallbackProposal_acceptedById_idx" ON "ContentFallbackProposal"("acceptedById");

-- AddForeignKey
ALTER TABLE "ContentFallbackProposal" ADD CONSTRAINT "ContentFallbackProposal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFallbackProposal" ADD CONSTRAINT "ContentFallbackProposal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFallbackProposal" ADD CONSTRAINT "ContentFallbackProposal_contentPlanItemId_fkey" FOREIGN KEY ("contentPlanItemId") REFERENCES "ContentPlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFallbackProposal" ADD CONSTRAINT "ContentFallbackProposal_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFallbackProposal" ADD CONSTRAINT "ContentFallbackProposal_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
