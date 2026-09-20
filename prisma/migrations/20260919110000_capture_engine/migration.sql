-- CreateEnum
CREATE TYPE "CaptureRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'DISMISSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CaptureRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contentPlanItemId" TEXT NOT NULL,
    "mediaRequirement" "MediaRequirement" NOT NULL,
    "requestedMediaType" "MediaType" NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "CaptureRequestStatus" NOT NULL DEFAULT 'OPEN',
    "fulfilledByMediaAssetId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaUsage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "contentVariantId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "mediaRequirement" "MediaRequirement" NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptureRequest_contentPlanItemId_mediaRequirement_key" ON "CaptureRequest"("contentPlanItemId", "mediaRequirement");

-- CreateIndex
CREATE INDEX "CaptureRequest_businessId_status_dueAt_idx" ON "CaptureRequest"("businessId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CaptureRequest_fulfilledByMediaAssetId_idx" ON "CaptureRequest"("fulfilledByMediaAssetId");

-- CreateIndex
CREATE INDEX "MediaUsage_businessId_mediaAssetId_usedAt_idx" ON "MediaUsage"("businessId", "mediaAssetId", "usedAt");

-- CreateIndex
CREATE INDEX "MediaUsage_contentVariantId_idx" ON "MediaUsage"("contentVariantId");

-- AddForeignKey
ALTER TABLE "CaptureRequest" ADD CONSTRAINT "CaptureRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRequest" ADD CONSTRAINT "CaptureRequest_contentPlanItemId_fkey" FOREIGN KEY ("contentPlanItemId") REFERENCES "ContentPlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRequest" ADD CONSTRAINT "CaptureRequest_fulfilledByMediaAssetId_fkey" FOREIGN KEY ("fulfilledByMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRequest" ADD CONSTRAINT "CaptureRequest_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_contentVariantId_fkey" FOREIGN KEY ("contentVariantId") REFERENCES "ContentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
