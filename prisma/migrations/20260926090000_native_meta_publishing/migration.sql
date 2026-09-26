-- P6-03: additive only. Existing attempts/intents stay valid with NULL values.
-- AlterTable
ALTER TABLE "PublishAttempt" ADD COLUMN     "adapterKey" TEXT,
ADD COLUMN     "adapterVersion" INTEGER,
ADD COLUMN     "providerContainerId" TEXT;

-- AlterTable
ALTER TABLE "PublishIntent" ADD COLUMN     "currentAttemptId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PublishIntent_currentAttemptId_key" ON "PublishIntent"("currentAttemptId");

