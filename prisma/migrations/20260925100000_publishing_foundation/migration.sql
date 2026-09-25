-- P6-01 Publishing Domain Foundation: PostgreSQL outbox (PublishIntent) + uyumlu PublishAttempt genisletmesi.
-- Ileriye donuk ve eklemeli: mevcut ScheduledPost/PublishAttempt satirlari degismez; yeni kolonlar bos olabilir.
-- Bilincli olarak geriye donuk doldurma (backfill) yapilmaz: mevcut planli gonderiler otomatik kuyruga alinmaz.

-- CreateEnum
CREATE TYPE "PublishIntentState" AS ENUM ('PENDING', 'IN_FLIGHT', 'UNKNOWN', 'RETRY_WAIT', 'PUBLISHED', 'FAILED', 'CANCELLED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "PublishOutcomeClass" AS ENUM ('PUBLISHED', 'RETRYABLE_REJECTION', 'PERMANENT_REJECTION', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "PublishAttemptStatus" ADD VALUE 'UNKNOWN';

-- AlterTable
ALTER TABLE "PublishAttempt" ADD COLUMN     "attemptNumber" INTEGER,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "diagnostics" JSONB,
ADD COLUMN     "outcome" "PublishOutcomeClass",
ADD COLUMN     "providerReference" TEXT,
ADD COLUMN     "publishIntentId" TEXT;

-- CreateTable
CREATE TABLE "PublishIntent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "scheduledPostId" TEXT NOT NULL,
    "sourceVariantId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "approvalId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "adapterVersion" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "state" "PublishIntentState" NOT NULL DEFAULT 'PENDING',
    "stateChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "providerReference" TEXT,
    "providerEvidence" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublishIntent_idempotencyKey_key" ON "PublishIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishIntent_state_dueAt_idx" ON "PublishIntent"("state", "dueAt");

-- CreateIndex
CREATE INDEX "PublishIntent_businessId_createdAt_idx" ON "PublishIntent"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "PublishIntent_socialAccountId_idx" ON "PublishIntent"("socialAccountId");

-- CreateIndex
CREATE INDEX "PublishIntent_sourceVariantId_idx" ON "PublishIntent"("sourceVariantId");

-- CreateIndex
CREATE INDEX "PublishIntent_approvalId_idx" ON "PublishIntent"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishIntent_scheduledPostId_generation_key" ON "PublishIntent"("scheduledPostId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_publishIntentId_attemptNumber_key" ON "PublishAttempt"("publishIntentId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_publishIntentId_fkey" FOREIGN KEY ("publishIntentId") REFERENCES "PublishIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishIntent" ADD CONSTRAINT "PublishIntent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishIntent" ADD CONSTRAINT "PublishIntent_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishIntent" ADD CONSTRAINT "PublishIntent_scheduledPostId_fkey" FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishIntent" ADD CONSTRAINT "PublishIntent_sourceVariantId_fkey" FOREIGN KEY ("sourceVariantId") REFERENCES "ContentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishIntent" ADD CONSTRAINT "PublishIntent_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Nesil ve surum pozitif olmalidir.
ALTER TABLE "PublishIntent" ADD CONSTRAINT "PublishIntent_generation_check" CHECK ("generation" >= 1);
ALTER TABLE "PublishIntent" ADD CONSTRAINT "PublishIntent_sourceVersion_check" CHECK ("sourceVersion" >= 1);
