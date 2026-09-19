-- CreateEnum
CREATE TYPE "ContentPlanningRunStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'INVALID_OUTPUT');

-- CreateTable
CREATE TABLE "ContentPlanningRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "triggeredById" TEXT NOT NULL,
    "period" "ContentPlanPeriod" NOT NULL,
    "scope" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" "ContentPlanningRunStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ContentPlanningRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPlanningRun_businessId_createdAt_idx" ON "ContentPlanningRun"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentPlanningRun_triggeredById_createdAt_idx" ON "ContentPlanningRun"("triggeredById", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentPlanningRun" ADD CONSTRAINT "ContentPlanningRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanningRun" ADD CONSTRAINT "ContentPlanningRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
