import "server-only";

import { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { PUBLISHING_ROUTES, isSupportedPublishingPlatform } from "./adapter";
import { DISPATCHABLE_INTENT_STATES, planIntentTransition, type PublishIntentEvidence, type PublishIntentState } from "./intent-state";
import {
  PUBLISH_SNAPSHOT_VERSION,
  buildPublishSnapshot,
  derivePublishIdempotencyKey,
  hashPublishSnapshot,
  verifyPublishSnapshotHash,
} from "./snapshot";

// P6-01: PostgreSQL outbox (PublishIntent) domain komutları. Bu modül hiçbir dış sağlayıcıyı çağırmaz,
// worker çalıştırmaz ve mevcut ScheduledPost satırlarını kendiliğinden kuyruğa almaz.

const FIRST_GENERATION = 1;
const maxConflictRetries = 3;
const expectedVersionSchema = z.number().int().positive();

/** Serializable çakışması (P2034 / 40001) ya da eşzamanlı eklemede unique ihlali (P2002). */
function isRetryableConflict(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 2) return false;
  const candidate = error as { code?: unknown; kind?: unknown; originalCode?: unknown; cause?: unknown };
  if (["P2034", "P2002"].includes(String(candidate.code)) || candidate.kind === "TransactionWriteConflict" || String(candidate.originalCode) === "40001") return true;
  return isRetryableConflict(candidate.cause, depth + 1);
}

async function withConflictRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableConflict(error) || attempt >= maxConflictRetries) throw error;
    }
  }
}

/**
 * Onaylı güncel sürüm için dayanıklı bir yayın niyeti (outbox satırı) ve değişmez snapshot'ı tek bir
 * Serializable işlemde oluşturur. Aynı post/nesil için tekrarlanan ya da eşzamanlı eşdeğer istekler aynı
 * intent'i döndürür; farklı sürüm/snapshot CONFLICT verir ve yeni nesil sessizce oluşturulmaz.
 * Doğrulama başarısızsa hiçbir satır yazılmaz. Deneme (PublishAttempt) oluşturulmaz.
 */
export async function requestPublishIntent(userId: string, scheduledPostId: string, expectedVersion: number) {
  const version = expectedVersionSchema.parse(expectedVersion);
  const post = await prisma.scheduledPost.findUnique({ where: { id: scheduledPostId } });
  if (!post) throw new DomainError("Planlanmış gönderi bulunamadı.", "NOT_FOUND");
  const businessId = post.businessId;
  await requireMembership(userId, businessId);

  return withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const fresh = await tx.scheduledPost.findUnique({ where: { id: scheduledPostId } });
      if (!fresh || fresh.businessId !== businessId) {
        throw new DomainError("Planlanmış gönderi değişti veya bulunamadı.", "CONFLICT");
      }
      if (fresh.status !== "SCHEDULED") {
        throw new DomainError("Yalnızca planlı durumdaki gönderi için yayın niyeti oluşturulabilir.", "CONFLICT");
      }

      const variant = await tx.contentVariant.findUnique({
        where: { id: fresh.contentVariantId },
        include: { contentItem: true },
      });
      if (!variant || variant.contentItem.businessId !== businessId) {
        throw new DomainError("İçerik varyantı bu işletmeye ait değil.", "FORBIDDEN");
      }
      if (version !== fresh.contentVersion || version !== variant.version) {
        throw new DomainError("İçerik sürümü değişti; güncel sürümü onaylayıp yeniden planlayın.", "CONFLICT");
      }
      const approval = await tx.approval.findUnique({
        where: { contentVariantId_approvedVersion: { contentVariantId: variant.id, approvedVersion: variant.version } },
      });
      if (!approval) {
        throw new DomainError("Yalnızca güncel sürümü onaylanmış içerik yayına hazırlanabilir.", "VALIDATION_ERROR");
      }

      const account = await tx.socialAccount.findUnique({ where: { id: fresh.socialAccountId } });
      if (!account || account.businessId !== businessId) {
        throw new DomainError("Sosyal hesap bu işletmeye ait değil.", "FORBIDDEN");
      }
      if (!isSupportedPublishingPlatform(account.platform)) {
        throw new DomainError("Bu platform için yayınlama desteklenmiyor.", "VALIDATION_ERROR");
      }
      if (account.platform !== variant.platform) {
        throw new DomainError("Sosyal hesap platformu içerik varyantıyla eşleşmiyor.", "VALIDATION_ERROR");
      }
      // CONNECTED yalnızca bir yer tutucudur; OAuth kimlik bilgisinin kanıtı değildir (P6-02/03 doğrular).
      if (account.status !== "CONNECTED") {
        throw new DomainError("Sosyal hesap bağlı değil.", "VALIDATION_ERROR");
      }

      const media = variant.mediaAssetId ? await tx.mediaAsset.findUnique({ where: { id: variant.mediaAssetId } }) : null;
      if (variant.mediaAssetId && (!media || media.businessId !== businessId)) {
        throw new DomainError("Medya bu işletmeye ait değil.", "FORBIDDEN");
      }

      const snapshot = buildPublishSnapshot({
        businessId,
        post: fresh,
        account: { id: account.id, platform: account.platform, externalAccountId: account.externalAccountId },
        variant: {
          id: variant.id,
          version: variant.version,
          caption: variant.caption,
          cta: variant.cta,
          language: variant.language,
          aspectRatio: variant.aspectRatio,
          formatMetadata: variant.formatMetadata,
          contentItem: { id: variant.contentItem.id, contentType: variant.contentItem.contentType },
        },
        approval,
        media,
      });
      const snapshotHash = hashPublishSnapshot(snapshot);

      const existing = await tx.publishIntent.findUnique({
        where: { scheduledPostId_generation: { scheduledPostId: fresh.id, generation: FIRST_GENERATION } },
      });
      if (existing) {
        if (existing.snapshotHash !== snapshotHash || existing.sourceVersion !== variant.version) {
          throw new DomainError("Bu gönderi için farklı bir yayın niyeti zaten var.", "CONFLICT");
        }
        return existing;
      }

      const route = PUBLISHING_ROUTES[account.platform];
      return tx.publishIntent.create({
        data: {
          businessId,
          socialAccountId: account.id,
          scheduledPostId: fresh.id,
          sourceVariantId: variant.id,
          sourceVersion: variant.version,
          approvalId: approval.id,
          platform: account.platform,
          dueAt: fresh.scheduledAt,
          adapterKey: route.adapterKey,
          adapterVersion: route.adapterVersion,
          generation: FIRST_GENERATION,
          idempotencyKey: derivePublishIdempotencyKey(fresh.id, FIRST_GENERATION),
          snapshotVersion: PUBLISH_SNAPSHOT_VERSION,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          snapshotHash,
        },
      });
    }, { isolationLevel: "Serializable" }),
  );
}

/**
 * İçerik düzenleme işlemi içinde çağrılır (updateContentVariant ile aynı transaction). Planlı postun
 * gönderilmemiş intent'lerini gönderilemez yapar; snapshot'a dokunmaz. IN_FLIGHT intent sağlayıcıya
 * ulaşmış olabileceğinden silinmez veya geçersiz sayılmaz: UNKNOWN'a alınır ve mutabakat bekler.
 */
export async function invalidatePublishIntentsForVariant(tx: Prisma.TransactionClient, variantId: string, now: Date) {
  const scheduledPost = { contentVariantId: variantId, status: "SCHEDULED" as const };
  await tx.publishIntent.updateMany({
    where: { scheduledPost, state: { in: ["PENDING", "RETRY_WAIT"] } },
    data: { state: "INVALIDATED", invalidatedAt: now, stateChangedAt: now },
  });
  await tx.publishIntent.updateMany({
    where: { scheduledPost, state: "UNKNOWN", invalidatedAt: null },
    data: { invalidatedAt: now },
  });
  await tx.publishIntent.updateMany({
    where: { scheduledPost, state: "IN_FLIGHT" },
    data: { state: "UNKNOWN", invalidatedAt: now, stateChangedAt: now },
  });
}

function evidenceRecord(evidence: PublishIntentEvidence, now: Date): Prisma.InputJsonValue {
  const record: Record<string, string | boolean> = { kind: evidence.kind, recordedAt: now.toISOString() };
  if ("providerReference" in evidence) record.providerReference = evidence.providerReference;
  if ("publishedAt" in evidence) record.publishedAt = evidence.publishedAt.toISOString();
  if ("retryable" in evidence) record.retryable = evidence.retryable;
  if ("errorCode" in evidence) record.errorCode = evidence.errorCode;
  if ("reason" in evidence) record.reason = evidence.reason;
  return record;
}

/**
 * Tek geçiş kapısı: beklenen durumla karşılaştır-ve-yaz. Eski (stale) veya yinelenen geçiş CONFLICT
 * verir. ScheduledPost yalnızca doğrulanmış sağlayıcı kanıtıyla PUBLISHED olur. P6-01 bu kapıyı hiçbir
 * worker/sağlayıcı akışına bağlamaz; sonraki görevler kullanır.
 */
export async function transitionPublishIntent(input: {
  intentId: string;
  expectedState: PublishIntentState;
  evidence: PublishIntentEvidence;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const intent = await tx.publishIntent.findUnique({ where: { id: input.intentId } });
    if (!intent) throw new DomainError("Yayın niyeti bulunamadı.", "NOT_FOUND");
    if (intent.state !== input.expectedState) {
      throw new DomainError("Yayın niyeti başka bir işlem tarafından değiştirildi.", "CONFLICT");
    }
    const planned = planIntentTransition(intent, input.evidence);
    const evidence = input.evidence;
    const data: Prisma.PublishIntentUpdateManyMutationInput = {
      state: planned.to,
      stateChangedAt: now,
      providerEvidence: evidenceRecord(evidence, now),
    };
    if (evidence.kind === "LEASE_ACQUIRED") data.leaseExpiresAt = evidence.leaseExpiresAt;
    if (evidence.kind === "PROVIDER_CONFIRMED" || evidence.kind === "RECONCILED_PUBLISHED") {
      data.providerReference = evidence.providerReference;
      data.publishedAt = evidence.publishedAt;
    }
    if (planned.to !== "IN_FLIGHT") data.leaseExpiresAt = null;
    if (planned.to === "INVALIDATED") data.invalidatedAt = now;

    const updated = await tx.publishIntent.updateMany({ where: { id: intent.id, state: input.expectedState }, data });
    if (updated.count !== 1) throw new DomainError("Yayın niyeti başka bir işlem tarafından değiştirildi.", "CONFLICT");

    if (planned.to === "PUBLISHED") {
      await tx.scheduledPost.updateMany({
        where: { id: intent.scheduledPostId, status: { in: ["SCHEDULED", "INVALIDATED"] } },
        data: { status: "PUBLISHED" },
      });
    } else if (planned.to === "FAILED") {
      await tx.scheduledPost.updateMany({ where: { id: intent.scheduledPostId, status: "SCHEDULED" }, data: { status: "FAILED" } });
    }
    return tx.publishIntent.findUniqueOrThrow({ where: { id: intent.id } });
  }, { isolationLevel: "Serializable" });
}

export type DispatchReadiness =
  | { dispatchable: true }
  | { dispatchable: false; reason: string };

/**
 * Gelecekteki gönderim, dış işten hemen önce bunu çağırmalıdır: kiracı/hesap, planlı post durumu,
 * onay/sürüm ve snapshot özeti yeniden doğrulanır. Salt okunur; hiçbir şeyi değiştirmez.
 */
export async function checkPublishIntentDispatchable(intentId: string): Promise<DispatchReadiness> {
  const intent = await prisma.publishIntent.findUnique({
    where: { id: intentId },
    include: { scheduledPost: true, socialAccount: true, sourceVariant: { include: { contentItem: true } } },
  });
  if (!intent) return { dispatchable: false, reason: "NOT_FOUND" };
  if (!DISPATCHABLE_INTENT_STATES.has(intent.state) || intent.invalidatedAt) return { dispatchable: false, reason: "STATE" };
  const { scheduledPost: post, socialAccount: account, sourceVariant: variant } = intent;
  if (post.status !== "SCHEDULED" || post.businessId !== intent.businessId) return { dispatchable: false, reason: "SCHEDULE" };
  if (
    account.businessId !== intent.businessId ||
    account.id !== post.socialAccountId ||
    account.platform !== intent.platform ||
    account.status !== "CONNECTED"
  ) {
    return { dispatchable: false, reason: "ACCOUNT" };
  }
  if (variant.contentItem.businessId !== intent.businessId || variant.version !== intent.sourceVersion || post.contentVersion !== intent.sourceVersion) {
    return { dispatchable: false, reason: "VERSION" };
  }
  const approval = await prisma.approval.findUnique({
    where: { contentVariantId_approvedVersion: { contentVariantId: variant.id, approvedVersion: variant.version } },
  });
  if (!approval || approval.id !== intent.approvalId) return { dispatchable: false, reason: "APPROVAL" };
  if (intent.snapshotVersion !== PUBLISH_SNAPSHOT_VERSION || !verifyPublishSnapshotHash(intent.snapshot, intent.snapshotHash)) {
    return { dispatchable: false, reason: "SNAPSHOT" };
  }
  return { dispatchable: true };
}
