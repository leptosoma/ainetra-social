-- P6-04: additive only. Existing intents/attempts keep NULL values (no automatic retry, legacy attempts stay unprovable).
-- AlterTable
ALTER TABLE "PublishAttempt" ADD COLUMN     "publishCallStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PublishIntent" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PublishIntent_state_nextAttemptAt_idx" ON "PublishIntent"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PublishIntent_state_leaseExpiresAt_idx" ON "PublishIntent"("state", "leaseExpiresAt");

