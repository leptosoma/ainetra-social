/*
  Warnings:

  - Added the required column `contentMix` to the `ContentPlan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platformStrategies` to the `ContentPlan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `strategySnapshot` to the `ContentPlan` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ContentPlan" ADD COLUMN     "contentMix" JSONB NOT NULL,
ADD COLUMN     "platformStrategies" JSONB NOT NULL,
ADD COLUMN     "strategySnapshot" JSONB NOT NULL;
