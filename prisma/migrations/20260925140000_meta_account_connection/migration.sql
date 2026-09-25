-- CreateEnum
CREATE TYPE "MetaOAuthAttemptStatus" AS ENUM ('PENDING', 'PROCESSING', 'AWAITING_SELECTION', 'SELECTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MetaConnectionAuditAction" AS ENUM ('CONNECT_STARTED', 'CALLBACK_FAILED', 'ASSETS_DISCOVERED', 'SELECTION_FAILED', 'CONNECTED', 'RECONNECTED', 'VALIDATED', 'REAUTH_REQUIRED', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "MetaOAuthAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "status" "MetaOAuthAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "reconnectSocialAccountId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "selectionHandleHash" TEXT,
    "selectionExpiresAt" TIMESTAMP(3),
    "candidates" JSONB,
    "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pendingCiphertext" BYTEA,
    "pendingNonce" BYTEA,
    "pendingAuthTag" BYTEA,
    "pendingKeyId" TEXT,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaOAuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaConnection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "metaPageId" TEXT NOT NULL,
    "instagramAccountId" TEXT,
    "pageName" TEXT NOT NULL,
    "instagramUsername" TEXT,
    "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pageTasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenType" TEXT,
    "credentialRef" TEXT,
    "ciphertext" BYTEA,
    "nonce" BYTEA,
    "authTag" BYTEA,
    "keyId" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "dataAccessExpiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "lastValidatedAt" TIMESTAMP(3),
    "reauthRequiredAt" TIMESTAMP(3),
    "reauthReason" TEXT,
    "disconnectedAt" TIMESTAMP(3),
    "providerRevocation" TEXT,
    "connectedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaConnectionAudit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "attemptId" TEXT,
    "actorUserId" TEXT,
    "action" "MetaConnectionAuditAction" NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaConnectionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaOAuthAttempt_stateHash_key" ON "MetaOAuthAttempt"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "MetaOAuthAttempt_selectionHandleHash_key" ON "MetaOAuthAttempt"("selectionHandleHash");

-- CreateIndex
CREATE INDEX "MetaOAuthAttempt_businessId_createdAt_idx" ON "MetaOAuthAttempt"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "MetaOAuthAttempt_userId_idx" ON "MetaOAuthAttempt"("userId");

-- CreateIndex
CREATE INDEX "MetaOAuthAttempt_sessionId_idx" ON "MetaOAuthAttempt"("sessionId");

-- CreateIndex
CREATE INDEX "MetaOAuthAttempt_expiresAt_idx" ON "MetaOAuthAttempt"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_socialAccountId_key" ON "MetaConnection"("socialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_credentialRef_key" ON "MetaConnection"("credentialRef");

-- CreateIndex
CREATE INDEX "MetaConnection_businessId_idx" ON "MetaConnection"("businessId");

-- CreateIndex
CREATE INDEX "MetaConnection_platform_providerAccountId_idx" ON "MetaConnection"("platform", "providerAccountId");

-- CreateIndex
CREATE INDEX "MetaConnectionAudit_businessId_createdAt_idx" ON "MetaConnectionAudit"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "MetaConnectionAudit_socialAccountId_idx" ON "MetaConnectionAudit"("socialAccountId");

-- CreateIndex
CREATE INDEX "MetaConnectionAudit_attemptId_idx" ON "MetaConnectionAudit"("attemptId");

-- AddForeignKey
ALTER TABLE "MetaOAuthAttempt" ADD CONSTRAINT "MetaOAuthAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaOAuthAttempt" ADD CONSTRAINT "MetaOAuthAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaOAuthAttempt" ADD CONSTRAINT "MetaOAuthAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaOAuthAttempt" ADD CONSTRAINT "MetaOAuthAttempt_reconnectSocialAccountId_fkey" FOREIGN KEY ("reconnectSocialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnectionAudit" ADD CONSTRAINT "MetaConnectionAudit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnectionAudit" ADD CONSTRAINT "MetaConnectionAudit_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnectionAudit" ADD CONSTRAINT "MetaConnectionAudit_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "MetaOAuthAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnectionAudit" ADD CONSTRAINT "MetaConnectionAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A provider account maps to at most one SocialAccount per business/platform. Legacy rows without a
-- provider ID (seed/mock placeholders) are intentionally excluded.
CREATE UNIQUE INDEX "SocialAccount_business_platform_external_key"
ON "SocialAccount"("businessId", "platform", "externalAccountId")
WHERE "externalAccountId" IS NOT NULL;

-- Only one live (credential-bearing) mapping may exist for a Meta asset across all businesses.
CREATE UNIQUE INDEX "MetaConnection_live_provider_account_key"
ON "MetaConnection"("platform", "providerAccountId")
WHERE "credentialRef" IS NOT NULL;

-- Credential material is stored or removed as one unit.
ALTER TABLE "MetaConnection"
ADD CONSTRAINT "MetaConnection_credential_complete"
CHECK (
  ("credentialRef" IS NULL AND "ciphertext" IS NULL AND "nonce" IS NULL AND "authTag" IS NULL AND "keyId" IS NULL)
  OR ("credentialRef" IS NOT NULL AND "ciphertext" IS NOT NULL AND "nonce" IS NOT NULL AND "authTag" IS NOT NULL AND "keyId" IS NOT NULL)
);

ALTER TABLE "MetaOAuthAttempt"
ADD CONSTRAINT "MetaOAuthAttempt_pending_secret_complete"
CHECK (
  ("pendingCiphertext" IS NULL AND "pendingNonce" IS NULL AND "pendingAuthTag" IS NULL AND "pendingKeyId" IS NULL)
  OR ("pendingCiphertext" IS NOT NULL AND "pendingNonce" IS NOT NULL AND "pendingAuthTag" IS NOT NULL AND "pendingKeyId" IS NOT NULL)
);
