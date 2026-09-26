import "server-only";

import { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";
import { storage } from "@/lib/storage";
import { loadMetaConfig } from "@/features/meta-connection/config";
import { loadCredentialKeyring } from "@/features/meta-connection/crypto";
import { createMetaGraphClient, createMetaPublishingClient } from "@/features/meta-connection/graph-client";
import {
  getMetaAccountConnection,
  markMetaCredentialRejected,
  resolveMetaAccessToken,
  verifyMetaPublishingCredential,
  type MetaPublishingCredentialCheck,
} from "@/features/meta-connection/service";
import type { AccountConnection, PublishOutcome, PublishingAdapter, RedactedDiagnostics } from "./adapter";
import { checkPublishIntentDispatchable, evidenceRecord, requestPublishIntent } from "./intent";
import {
  DISPATCHABLE_INTENT_STATES,
  MAX_PUBLISH_ATTEMPTS,
  PUBLISH_CALL_GUARD_MARKER,
  attemptStatusForOutcome,
  evidenceForExpiredLease,
  evidenceFromSubmitOutcome,
  planIntentTransition,
  planRetry,
  type PublishIntentEvidence,
  type PublishIntentState,
} from "./intent-state";
import { PUBLISH_NOW_MESSAGES, type PublishNowErrorCode } from "./labels";
import { createSignedMediaUrl, loadMediaDeliveryConfig } from "./media-delivery";
import { createMetaPublishingAdapter } from "./meta-adapter";
import type { PublishSnapshotV1 } from "./snapshot";

// P6-03: onaylı, değişmez PublishIntent için tek, açık "şimdi yayınla" komutu (yalnızca dueAt <= şimdi).
// P6-04: aynı gönderim çekirdeği (dispatchPublishIntent) oturumsuz worker tarafından da kullanılır; ikinci bir
// yayın yolu yoktur. Mutabakat (UNKNOWN çözümü) P6-05'tir.
//
// Sıra: yetki → intent (oluştur/yeniden kullan) → zaman/onay/sürüm/snapshot → hedef/medya soyu → gerçek
// Meta kimlik bilgisi ve yayın izni (ağ) → kısa Serializable CAS ile IN_FLIGHT + tek numaralı deneme →
// dış çağrılardan önce sahiplik/kaynak yeniden denetimi → prepareMedia → (IG konteyner kimliği kalıcı) →
// sahiplik yeniden denetimi → submit → (gerçek yayın çağrısından hemen önce kalıcı çağrı-başladı işareti) →
// sonuç ve kanıt, kiralamayı tutan denemeye karşılaştır-ve-yaz ile.
// Hiçbir veritabanı işlemi Meta ağ çağrısı boyunca açık kalmaz.

const FIRST_GENERATION = 1;
export const PUBLISH_LEASE_MS = 5 * 60 * 1000;
const maxConflictRetries = 3;

export type PublishNowDeps = {
  adapter: PublishingAdapter | null;
  mediaDeliveryConfigured: boolean;
  resolveConnection: (businessId: string, socialAccountId: string) => Promise<AccountConnection | null>;
  /** Worker yolunda denetim aktörü yoktur (null); kullanıcı kimliği uydurulmaz. */
  verifyCredential: (connection: AccountConnection, actorUserId: string | null) => Promise<MetaPublishingCredentialCheck>;
  markCredentialRejected: (connection: AccountConnection, reason: string, now: Date) => Promise<void>;
  now: () => Date;
  leaseMs: number;
};

function defaultAdapter(): { adapter: PublishingAdapter | null; mediaDeliveryConfigured: boolean } {
  try {
    const config = loadMetaConfig();
    const keyring = loadCredentialKeyring();
    const delivery = loadMediaDeliveryConfig();
    if (!config || !keyring) return { adapter: null, mediaDeliveryConfigured: Boolean(delivery) };
    const adapter = createMetaPublishingAdapter({
      graph: createMetaPublishingClient(config),
      resolveToken: (target) => resolveMetaAccessToken(target, { keyring }),
      storage,
      signMediaUrl: (binding) => (delivery ? createSignedMediaUrl(delivery, binding, new Date()) : null),
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    return { adapter, mediaDeliveryConfigured: Boolean(delivery) };
  } catch {
    return { adapter: null, mediaDeliveryConfigured: false };
  }
}

function resolveDeps(overrides: Partial<PublishNowDeps>): PublishNowDeps {
  const needsDefault = overrides.adapter === undefined || overrides.mediaDeliveryConfigured === undefined;
  const fallback = needsDefault ? defaultAdapter() : { adapter: null, mediaDeliveryConfigured: false };
  return {
    adapter: overrides.adapter !== undefined ? overrides.adapter : fallback.adapter,
    mediaDeliveryConfigured: overrides.mediaDeliveryConfigured ?? fallback.mediaDeliveryConfigured,
    resolveConnection: overrides.resolveConnection ?? getMetaAccountConnection,
    verifyCredential:
      overrides.verifyCredential ??
      ((connection, actorUserId) => {
        const config = loadMetaConfig();
        return verifyMetaPublishingCredential(connection, actorUserId, { config, graph: config ? createMetaGraphClient(config) : null });
      }),
    markCredentialRejected: overrides.markCredentialRejected ?? markMetaCredentialRejected,
    now: overrides.now ?? (() => new Date()),
    leaseMs: overrides.leaseMs ?? PUBLISH_LEASE_MS,
  };
}

function fail(code: PublishNowErrorCode, domainCode: DomainError["code"] = "VALIDATION_ERROR"): never {
  throw new DomainError(PUBLISH_NOW_MESSAGES[code], domainCode);
}

/** Eylem hatasını kapalı bir koda çevirir; serbest metin URL'ye yazılmaz. */
export function publishNowErrorCode(error: unknown): PublishNowErrorCode {
  if (error instanceof DomainError) {
    const byMessage = (Object.entries(PUBLISH_NOW_MESSAGES) as Array<[PublishNowErrorCode, string]>).find(([, message]) => message === error.message);
    if (byMessage) return byMessage[0];
    if (error.code === "FORBIDDEN") return "FORBIDDEN";
    if (error.code === "CONFLICT" || error.code === "VALIDATION_ERROR" || error.code === "NOT_FOUND") return "NOT_PUBLISHABLE";
  }
  return "ACTION_FAILED";
}

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

export type PublishNowResult = { intentId: string; state: PublishIntentState; attemptId: string | null; dispatched: boolean };

function resultOf(intent: { id: string; state: PublishIntentState; currentAttemptId: string | null }, dispatched = false): PublishNowResult {
  return { intentId: intent.id, state: intent.state, attemptId: intent.currentAttemptId, dispatched };
}

type IntentRow = Awaited<ReturnType<typeof prisma.publishIntent.findUniqueOrThrow>>;

/**
 * Tek kanıt → veri çevirisi. RETRY_WAIT hedefinde deterministik bekleme yazılır; bütçe dolmuşsa aynı işlemde
 * mevcut RETRY_BUDGET_EXHAUSTED kanıtıyla FAILED'a geçilir (denemenin özgün redakte reddi denemede kalır).
 */
function transitionData(intent: IntentRow, evidence: PublishIntentEvidence, attemptNumber: number | null, now: Date) {
  const planned = planIntentTransition(intent, evidence);
  let to = planned.to;
  let recorded = evidence;
  const data: Prisma.PublishIntentUpdateManyMutationInput = { stateChangedAt: now, leaseExpiresAt: null, nextAttemptAt: null };
  if (evidence.kind === "PROVIDER_CONFIRMED") {
    data.providerReference = evidence.providerReference;
    data.publishedAt = evidence.publishedAt;
  }
  if (to === "RETRY_WAIT") {
    const retry = planRetry(attemptNumber ?? MAX_PUBLISH_ATTEMPTS, now);
    if (retry.kind === "RETRY") {
      data.nextAttemptAt = retry.nextAttemptAt;
    } else {
      recorded = { kind: "RETRY_BUDGET_EXHAUSTED" };
      to = planIntentTransition({ state: "RETRY_WAIT", invalidatedAt: intent.invalidatedAt }, recorded).to;
    }
  }
  data.state = to;
  data.providerEvidence = evidenceRecord(recorded, now);
  return { to, data };
}

async function syncScheduledPost(tx: Prisma.TransactionClient, scheduledPostId: string, to: PublishIntentState) {
  if (to === "PUBLISHED") {
    await tx.scheduledPost.updateMany({ where: { id: scheduledPostId, status: { in: ["SCHEDULED", "INVALIDATED"] } }, data: { status: "PUBLISHED" } });
  } else if (to === "FAILED") {
    await tx.scheduledPost.updateMany({ where: { id: scheduledPostId, status: "SCHEDULED" }, data: { status: "FAILED" } });
  }
}

/**
 * P6-04: süresi dolmuş IN_FLIGHT, dayanıklı deneme kanıtıyla değerlendirilir; kiralamanın dolması tek başına
 * "yayınlanmadı" kanıtı değildir. Korumalı denemede çağrı-başladı işareti yoksa, işaret boşken denemeyi aynı
 * işlemde kapatarak (eski işçi artık işaret yazamaz, yani Meta'yı çağıramaz) güvenli RETRY_WAIT'e geçilir.
 * Aksi halde (işaretli, işaretsiz eski deneme, deneme yok) UNKNOWN olur ve asla yeniden gönderilmez; deneme
 * satırına dokunulmaz, geç gelen gerçek sonuç denemeye yazılabilir, intent mutabakata (P6-05) kalır.
 */
export async function recoverExpiredLease(intentId: string, now: Date) {
  return withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const intent = await tx.publishIntent.findUniqueOrThrow({ where: { id: intentId } });
      const attempt = intent.currentAttemptId ? await tx.publishAttempt.findUnique({ where: { id: intent.currentAttemptId } }) : null;
      const evidence = evidenceForExpiredLease(intent, attempt && attempt.publishIntentId === intent.id ? attempt : null, now);
      if (!evidence) return intent;
      if (evidence.kind === "LEASE_EXPIRED_BEFORE_PUBLISH_CALL") {
        const fenced = await tx.publishAttempt.updateMany({
          where: { id: attempt!.id, status: attempt!.status, publishCallStartedAt: null },
          data:
            attempt!.status === "PENDING"
              ? { status: "FAILED", outcome: "RETRYABLE_REJECTION", errorCode: "LEASE_EXPIRED_BEFORE_PUBLISH", diagnostics: { stage: "LEASE_EXPIRED", publishCallMade: false }, completedAt: now }
              : { outcome: "RETRYABLE_REJECTION" },
        });
        if (fenced.count !== 1) throw new DomainError("Yayın denemesi başka bir işlem tarafından değiştirildi.", "CONFLICT");
      }
      const { to, data } = transitionData(intent, evidence, attempt?.attemptNumber ?? null, now);
      const updated = await tx.publishIntent.updateMany({ where: { id: intent.id, state: "IN_FLIGHT", currentAttemptId: intent.currentAttemptId, leaseExpiresAt: { lte: now } }, data });
      if (updated.count !== 1) throw new DomainError("Yayın niyeti başka bir işlem tarafından değiştirildi.", "CONFLICT");
      await syncScheduledPost(tx, intent.scheduledPostId, to);
      return tx.publishIntent.findUniqueOrThrow({ where: { id: intentId } });
    }, { isolationLevel: "Serializable" }),
  );
}

function snapshotMatchesIntent(snapshot: PublishSnapshotV1, intent: { businessId: string; socialAccountId: string; scheduledPostId: string; platform: string; approvalId: string; sourceVariantId: string; sourceVersion: number }) {
  return (
    snapshot?.snapshotVersion === 1 &&
    snapshot.businessId === intent.businessId &&
    snapshot.scheduledPostId === intent.scheduledPostId &&
    snapshot.target.socialAccountId === intent.socialAccountId &&
    snapshot.target.platform === intent.platform &&
    snapshot.content.platform === intent.platform &&
    snapshot.content.approvalId === intent.approvalId &&
    snapshot.content.variantId === intent.sourceVariantId &&
    snapshot.content.version === intent.sourceVersion
  );
}

/** Dondurulmuş medya satırı hâlâ aynı işletmede, aynı depo anahtarı/türüyle duruyor mu (soy ve kiracı). */
async function mediaLineageIntact(snapshot: PublishSnapshotV1) {
  const media = snapshot.media;
  if (!media) return true;
  const asset = await prisma.mediaAsset.findUnique({ where: { id: media.mediaAssetId } });
  return Boolean(asset && asset.businessId === snapshot.businessId && asset.storageKey === media.storageKey && asset.mimeType === media.mimeType && asset.type === media.type && asset.size === media.size);
}

/**
 * Tek, kısa Serializable işlem: dağıtılabilirliği yeniden doğrular, PENDING/RETRY_WAIT'i IN_FLIGHT olarak
 * kiralar ve kiralamaya bağlı tek numaralı PublishAttempt oluşturur. Kaybeden eşzamanlı çağıran null alır.
 */
/**
 * P6-04: worker'ın RETRY_WAIT'i otomatik yeniden deneyebilmesi için: kalıcı sonraki deneme zamanı gelmiş, son
 * deneme kesin güvenli (yayın öncesi / sağlayıcının açık reddi) ve bütçe kalmış olmalı. Boş nextAttemptAt
 * (P6-04 öncesi satırlar) otomatik denenmez.
 */
async function safeRetryDue(db: Prisma.TransactionClient, intent: IntentRow, now: Date) {
  if (intent.state !== "RETRY_WAIT" || !intent.nextAttemptAt || intent.nextAttemptAt > now || !intent.currentAttemptId) return false;
  const attempt = await db.publishAttempt.findUnique({ where: { id: intent.currentAttemptId } });
  if (!attempt || attempt.publishIntentId !== intent.id || attempt.status !== "FAILED") return false;
  const safe = attempt.outcome === "RETRYABLE_REJECTION" || (attempt.errorCode === "CLAIM_LOST_BEFORE_PUBLISH" && !attempt.publishCallStartedAt);
  if (!safe) return false;
  const used = await db.publishAttempt.count({ where: { publishIntentId: intent.id } });
  return used < MAX_PUBLISH_ATTEMPTS;
}

export type DispatchMode = "USER" | "WORKER";

async function claimIntent(intentId: string, adapter: PublishingAdapter, now: Date, leaseMs: number, mode: DispatchMode) {
  try {
    // Serializable yanlış-pozitif iptalleri yeniden denenir; yeniden okuma kaybedeni kesin olarak null'a çevirir.
    return await withConflictRetry(() => prisma.$transaction(async (tx) => {
      const fresh = await tx.publishIntent.findUnique({ where: { id: intentId }, include: { scheduledPost: true, sourceVariant: true } });
      if (!fresh || !DISPATCHABLE_INTENT_STATES.has(fresh.state) || fresh.invalidatedAt || fresh.dueAt > now) return null;
      if (fresh.scheduledPost.status !== "SCHEDULED" || fresh.sourceVariant.version !== fresh.sourceVersion || fresh.scheduledPost.contentVersion !== fresh.sourceVersion) return null;
      const approval = await tx.approval.findUnique({ where: { contentVariantId_approvedVersion: { contentVariantId: fresh.sourceVariantId, approvedVersion: fresh.sourceVersion } } });
      if (!approval || approval.id !== fresh.approvalId) return null;
      if (mode === "WORKER" && fresh.state === "RETRY_WAIT" && !(await safeRetryDue(tx, fresh, now))) return null;

      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const evidence = { kind: "LEASE_ACQUIRED" as const, leaseExpiresAt };
      planIntentTransition(fresh, evidence);
      const last = await tx.publishAttempt.aggregate({ where: { publishIntentId: fresh.id }, _max: { attemptNumber: true } });
      if ((last._max.attemptNumber ?? 0) >= MAX_PUBLISH_ATTEMPTS) return null;
      const attempt = await tx.publishAttempt.create({
        data: {
          scheduledPostId: fresh.scheduledPostId,
          publishIntentId: fresh.id,
          attemptNumber: (last._max.attemptNumber ?? 0) + 1,
          status: "PENDING",
          attemptedAt: now,
          adapterKey: adapter.adapterKey,
          adapterVersion: adapter.adapterVersion,
          // Korumalı protokol işareti: bu denemede yayın çağrısı yalnızca beginPublishCall başarılıysa yapılır.
          diagnostics: { publishGuard: PUBLISH_CALL_GUARD_MARKER },
        },
      });
      const updated = await tx.publishIntent.updateMany({
        where: { id: fresh.id, state: fresh.state, invalidatedAt: null },
        data: { state: "IN_FLIGHT", stateChangedAt: now, leaseExpiresAt, nextAttemptAt: null, currentAttemptId: attempt.id, providerEvidence: evidenceRecord(evidence, now) },
      });
      if (updated.count !== 1) throw new DomainError("Yayın niyeti başka bir işlem tarafından değiştirildi.", "CONFLICT");
      return { attemptId: attempt.id, leaseExpiresAt };
    }, { isolationLevel: "Serializable" }));
  } catch (error) {
    if (isRetryableConflict(error) || (error instanceof DomainError && error.code === "CONFLICT")) return null;
    throw error;
  }
}

/**
 * Dış çağrıdan hemen önce: kiralama hâlâ bu denemede mi ve kaynak (planlı post, sürüm, onay) geçerli mi?
 * İsteğe bağlı olarak IG konteyner kimliği yayın çağrısından ÖNCE aynı karşılaştır-ve-yaz ile kalıcılaşır.
 */
async function confirmClaim(intentId: string, attemptId: string, now: Date, containerId?: string) {
  return withConflictRetry(() => prisma.$transaction(async (tx) => {
    const intent = await tx.publishIntent.findUnique({ where: { id: intentId }, include: { scheduledPost: true, sourceVariant: true } });
    if (!intent || intent.state !== "IN_FLIGHT" || intent.currentAttemptId !== attemptId || intent.invalidatedAt) return false;
    if (!intent.leaseExpiresAt || intent.leaseExpiresAt <= now) return false;
    if (intent.scheduledPost.status !== "SCHEDULED" || intent.sourceVariant.version !== intent.sourceVersion) return false;
    if (containerId) {
      const saved = await tx.publishAttempt.updateMany({ where: { id: attemptId, status: "PENDING" }, data: { providerContainerId: containerId } });
      if (saved.count !== 1) return false;
    }
    return true;
  }, { isolationLevel: "Serializable" }));
}

/**
 * P6-04: gerçek yayın çağrısından hemen önce, aynı canlı kiralama/denemeye karşı kısa Serializable CAS ile
 * `publishCallStartedAt` yazılır. Yazılamazsa (kiralama geri alındı/doldu, kaynak değişti, çakışma) false döner
 * ve çağrı yapılmaz. Eşzamanlı kurtarma aynı deneme satırını işaret boşken kapattığından ikisinden yalnızca
 * biri kazanabilir: ya çağrı işaretlidir (sonuç belirsiz sayılır) ya da eski işçi çağıramaz.
 */
async function beginPublishCall(intentId: string, attemptId: string, now: Date) {
  try {
    return await withConflictRetry(() => prisma.$transaction(async (tx) => {
      const intent = await tx.publishIntent.findUnique({ where: { id: intentId }, include: { scheduledPost: true, sourceVariant: true } });
      if (!intent || intent.state !== "IN_FLIGHT" || intent.currentAttemptId !== attemptId || intent.invalidatedAt) return false;
      if (!intent.leaseExpiresAt || intent.leaseExpiresAt <= now) return false;
      if (intent.scheduledPost.status !== "SCHEDULED" || intent.sourceVariant.version !== intent.sourceVersion) return false;
      const marked = await tx.publishAttempt.updateMany({ where: { id: attemptId, publishIntentId: intentId, status: "PENDING", publishCallStartedAt: null }, data: { publishCallStartedAt: now } });
      return marked.count === 1;
    }, { isolationLevel: "Serializable" }));
  } catch {
    return false;
  }
}

function sanitizedDiagnostics(diagnostics: RedactedDiagnostics | undefined, extra: Record<string, string | number | boolean> = {}): Prisma.InputJsonValue {
  const record: Record<string, string | number | boolean> = { ...extra };
  if (diagnostics?.code && /^[A-Z0-9_]{1,80}$/.test(diagnostics.code)) record.code = diagnostics.code;
  if (typeof diagnostics?.httpStatus === "number") record.httpStatus = diagnostics.httpStatus;
  if (diagnostics?.providerRequestId && /^[A-Za-z0-9_-]{1,64}$/.test(diagnostics.providerRequestId)) record.providerRequestId = diagnostics.providerRequestId;
  return record;
}

/** Yayın çağrısı yapılmadan bırakılan deneme (kiralama/kaynak dış çağrıdan önce değişti). */
async function abandonBeforePublish(attemptId: string, now: Date, stage: string) {
  await prisma.publishAttempt.updateMany({
    where: { id: attemptId, status: "PENDING" },
    data: { status: "FAILED", errorCode: "CLAIM_LOST_BEFORE_PUBLISH", diagnostics: { stage, publishCallMade: false }, completedAt: now },
  });
}

/**
 * Sonuç, kiralamayı tutan tam denemeye karşı karşılaştır-ve-yaz ile kaydedilir. Deneme sonucu bir kez yazılır.
 * Intent artık bu denemede değilse (ör. kaynak düzenlendi → UNKNOWN, kiralama doldu) intent'e dokunulmaz;
 * kanıt denemede kalır ve mutabakata (P6-05) bırakılır. Eski bir işçi daha yeni kanıtın üzerine yazamaz.
 */
async function finalizeAttempt(intentId: string, attemptId: string, outcome: PublishOutcome, now: Date) {
  const attemptStatus = attemptStatusForOutcome("PENDING", outcome);
  const outcomeClass = outcome.kind === "PUBLISHED" ? "PUBLISHED" : outcome.kind === "UNKNOWN" ? "UNKNOWN" : outcome.retryable ? "RETRYABLE_REJECTION" : "PERMANENT_REJECTION";
  const errorCode = outcome.kind === "REJECTED" ? outcome.errorCode : outcome.kind === "UNKNOWN" ? outcome.reason : null;
  return withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const recorded = await tx.publishAttempt.updateMany({
        where: { id: attemptId, publishIntentId: intentId, status: "PENDING" },
        data: {
          status: attemptStatus,
          outcome: outcomeClass,
          errorCode,
          providerReference: outcome.kind === "PUBLISHED" ? outcome.providerReference : null,
          diagnostics: sanitizedDiagnostics(outcome.diagnostics),
          completedAt: now,
        },
      });
      const intent = await tx.publishIntent.findUniqueOrThrow({ where: { id: intentId } });
      if (recorded.count !== 1 || intent.state !== "IN_FLIGHT" || intent.currentAttemptId !== attemptId) return intent;

      const attempt = await tx.publishAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      const { to, data } = transitionData(intent, evidenceFromSubmitOutcome(outcome), attempt.attemptNumber, now);
      const updated = await tx.publishIntent.updateMany({ where: { id: intentId, state: "IN_FLIGHT", currentAttemptId: attemptId }, data });
      if (updated.count !== 1) throw new DomainError("Yayın niyeti başka bir işlem tarafından değiştirildi.", "CONFLICT");
      await syncScheduledPost(tx, intent.scheduledPostId, to);
      return tx.publishIntent.findUniqueOrThrow({ where: { id: intentId } });
    }, { isolationLevel: "Serializable" }),
  );
}

/**
 * Onaylı ve zamanı gelmiş planlı gönderiyi yalnızca değişmez snapshot'tan Meta'ya gönderir. Tarayıcıdan
 * yalnızca planlı post kimliği ve beklenen sürüm gelir; hesap, platform, sağlayıcı kimliği ve yük sunucuda
 * intent/snapshot'tan türetilir. Yinelenen tıklama veya eşzamanlı istek ikinci bir Meta çağrısı üretmez;
 * mevcut durumu döndürür. UNKNOWN/PUBLISHED/FAILED asla yeniden gönderilmez.
 */
export async function publishScheduledPostNow(userId: string, scheduledPostId: string, expectedVersion: number, overrides: Partial<PublishNowDeps> = {}): Promise<PublishNowResult> {
  const deps = resolveDeps(overrides);
  const now = deps.now();
  const version = z.number().int().positive().safeParse(expectedVersion);
  if (!version.success) fail("NOT_PUBLISHABLE");
  const post = await prisma.scheduledPost.findUnique({ where: { id: scheduledPostId } });
  if (!post) throw new DomainError("Planlanmış gönderi bulunamadı.", "NOT_FOUND");
  await requireMembership(userId, post.businessId);

  let intent = await prisma.publishIntent.findUnique({ where: { scheduledPostId_generation: { scheduledPostId: post.id, generation: FIRST_GENERATION } } });
  if (intent?.state === "IN_FLIGHT") return resultOf(await recoverExpiredLease(intent.id, now));
  if (intent && !DISPATCHABLE_INTENT_STATES.has(intent.state)) return resultOf(intent);

  if (post.scheduledAt > now) fail("NOT_DUE");
  if (intent) {
    // Mevcut intent asla güncel (değişebilir) içerikten yeniden kurulmaz; yalnızca saklı snapshot kullanılır.
    if (intent.sourceVersion !== version.data) fail("NOT_PUBLISHABLE");
  } else {
    try {
      intent = await requestPublishIntent(userId, post.id, version.data);
    } catch (error) {
      if (error instanceof DomainError && error.message === "Medya bu işletmeye ait değil.") fail("MEDIA_INVALID");
      if (error instanceof DomainError && error.code === "FORBIDDEN") throw error;
      if (error instanceof DomainError && error.message === "Sosyal hesap bağlı değil.") fail("ACCOUNT_NOT_CONNECTED");
      fail("NOT_PUBLISHABLE");
    }
  }
  return dispatchPublishIntent(intent, { actorUserId: userId, mode: "USER" }, deps);
}

/**
 * P6-04: oturumsuz worker girişi (güvenilir sunucu süreci; tarayıcıdan erişilemez). Mevcut intent'i yalnızca
 * saklı snapshot'tan, kullanıcı yoluyla aynı çekirdek, CAS talebi ve kanıt yazımıyla gönderir. Süresi dolmuş
 * IN_FLIGHT kanıta göre kurtarılır; UNKNOWN/PUBLISHED/FAILED/CANCELLED/INVALIDATED asla gönderilmez.
 */
export async function dispatchPublishIntentForWorker(intentId: string, overrides: Partial<PublishNowDeps> = {}): Promise<PublishNowResult> {
  const deps = resolveDeps(overrides);
  const intent = await prisma.publishIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new DomainError("Yayın niyeti bulunamadı.", "NOT_FOUND");
  if (intent.state === "IN_FLIGHT") return resultOf(await recoverExpiredLease(intent.id, deps.now()));
  return dispatchPublishIntent(intent, { actorUserId: null, mode: "WORKER" }, deps);
}

/** Kullanıcı ve worker yollarının paylaştığı tek gönderim çekirdeği. */
async function dispatchPublishIntent(intent: IntentRow, context: { actorUserId: string | null; mode: DispatchMode }, deps: PublishNowDeps): Promise<PublishNowResult> {
  if (!DISPATCHABLE_INTENT_STATES.has(intent.state)) return resultOf(intent);
  if (intent.dueAt > deps.now()) fail("NOT_DUE");
  if (context.mode === "WORKER" && intent.state === "RETRY_WAIT" && !(await safeRetryDue(prisma, intent, deps.now()))) return resultOf(intent);

  const readiness = await checkPublishIntentDispatchable(intent.id);
  if (!readiness.dispatchable) fail("NOT_PUBLISHABLE");
  const snapshot = intent.snapshot as unknown as PublishSnapshotV1;
  if (!snapshotMatchesIntent(snapshot, intent)) fail("NOT_PUBLISHABLE");

  const adapter = deps.adapter;
  if (!adapter || adapter.adapterKey !== intent.adapterKey || adapter.adapterVersion !== intent.adapterVersion || !adapter.platforms.includes(snapshot.target.platform)) fail("NOT_CONFIGURED");
  if (snapshot.target.platform === "INSTAGRAM" && snapshot.media && !deps.mediaDeliveryConfigured) fail("NOT_CONFIGURED");
  if (!(await mediaLineageIntact(snapshot))) fail("MEDIA_INVALID");

  // Gerçek Meta bağlantısı: SocialAccount.status yeterli değildir.
  const connection = await deps.resolveConnection(intent.businessId, intent.socialAccountId);
  if (
    !connection ||
    connection.businessId !== intent.businessId ||
    connection.socialAccountId !== intent.socialAccountId ||
    connection.platform !== snapshot.target.platform ||
    !connection.externalAccountId ||
    connection.externalAccountId !== snapshot.target.externalAccountId
  ) {
    fail("ACCOUNT_NOT_CONNECTED");
  }
  const check = await deps.verifyCredential(connection, context.actorUserId);
  if (!check.ok) {
    if (check.reason === "REAUTH_REQUIRED") fail("ACCOUNT_NOT_CONNECTED");
    if (check.reason === "PUBLISH_PERMISSION_MISSING") fail("PUBLISH_PERMISSION_MISSING");
    if (check.reason === "PAGE_TASK_MISSING") fail("PAGE_TASK_MISSING");
    if (check.reason === "NOT_CONFIGURED") fail("NOT_CONFIGURED");
    fail("PROVIDER_UNAVAILABLE", "PROVIDER_FAILED");
  }

  const claim = await claimIntent(intent.id, adapter, deps.now(), deps.leaseMs, context.mode);
  if (!claim) return resultOf(await prisma.publishIntent.findUniqueOrThrow({ where: { id: intent.id } }));
  const attemptId = claim.attemptId;

  if (!(await confirmClaim(intent.id, attemptId, deps.now()))) {
    await abandonBeforePublish(attemptId, deps.now(), "BEFORE_PREPARE");
    return resultOf(await prisma.publishIntent.findUniqueOrThrow({ where: { id: intent.id } }));
  }

  let prepared;
  try {
    prepared = await adapter.prepareMedia({ snapshot, target: connection, idempotencyKey: intent.idempotencyKey, intentId: intent.id, attemptId });
  } catch {
    // prepareMedia yayın çağrısı yapmaz (IG konteyneri gönderi değildir); beklenmeyen hata yeniden denenebilir.
    prepared = { kind: "REJECTED" as const, retryable: true, errorCode: "PREPARE_FAILED", diagnostics: { code: "INTERNAL_ERROR" } };
  }
  if (prepared.kind !== "READY") {
    const outcome: PublishOutcome = prepared.kind === "REJECTED" ? prepared : { kind: "UNKNOWN", reason: prepared.reason, diagnostics: prepared.diagnostics };
    return resultOf(await finalizeAndReact(intent.id, attemptId, outcome, connection, deps), true);
  }

  const containerId = snapshot.target.platform === "INSTAGRAM" ? prepared.media[0]?.providerMediaReference : undefined;
  if (!(await confirmClaim(intent.id, attemptId, deps.now(), containerId))) {
    if (containerId) await prisma.publishAttempt.updateMany({ where: { id: attemptId, status: "PENDING" }, data: { providerContainerId: containerId } });
    await abandonBeforePublish(attemptId, deps.now(), "BEFORE_PUBLISH");
    return resultOf(await prisma.publishIntent.findUniqueOrThrow({ where: { id: intent.id } }));
  }

  let outcome: PublishOutcome;
  try {
    outcome = await adapter.submit({
      intentId: intent.id,
      snapshot,
      snapshotHash: intent.snapshotHash,
      idempotencyKey: intent.idempotencyKey,
      target: connection,
      preparedMedia: prepared.media,
      attemptId,
      beforePublishCall: () => beginPublishCall(intent.id, attemptId, deps.now()),
    });
  } catch {
    // Yayın çağrısı gönderilmiş olabilir: belirsiz.
    outcome = { kind: "UNKNOWN", reason: "PROVIDER_AMBIGUOUS", providerReference: containerId, diagnostics: { code: "INTERNAL_ERROR" } };
  }
  return resultOf(await finalizeAndReact(intent.id, attemptId, outcome, connection, deps), true);
}

async function finalizeAndReact(intentId: string, attemptId: string, outcome: PublishOutcome, connection: AccountConnection, deps: PublishNowDeps) {
  const now = deps.now();
  const final = await finalizeAttempt(intentId, attemptId, outcome, now);
  if (outcome.kind === "REJECTED" && outcome.errorCode === "AUTH_INVALID") {
    await deps.markCredentialRejected(connection, "TOKEN_REVOKED", now).catch(() => undefined);
  }
  return final;
}
