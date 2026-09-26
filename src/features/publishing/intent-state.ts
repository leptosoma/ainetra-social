import { DomainError } from "@/lib/domain-error";
import type { PublishOutcome, ReconcileResult, UnknownOutcomeReason } from "./adapter";

/**
 * P6-01: PublishIntent durum makinesi — tek kaynak. Hedef durum çağıranın seçimi değildir; kanıttan
 * (evidence) türetilir. Böylece sessizlik/zaman aşımı yapısal olarak PUBLISHED ya da kesin FAILED
 * üretemez ve UNKNOWN yalnızca mutabakat kanıtıyla çözülebilir.
 */
export const PUBLISH_INTENT_STATES = [
  "PENDING",
  "IN_FLIGHT",
  "UNKNOWN",
  "RETRY_WAIT",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
  "INVALIDATED",
] as const;

export type PublishIntentState = (typeof PUBLISH_INTENT_STATES)[number];

export const TERMINAL_INTENT_STATES: ReadonlySet<PublishIntentState> = new Set(["PUBLISHED", "FAILED", "CANCELLED", "INVALIDATED"]);

/** Gönderime aday olabilecek (henüz gönderilmemiş) durumlar. */
export const DISPATCHABLE_INTENT_STATES: ReadonlySet<PublishIntentState> = new Set(["PENDING", "RETRY_WAIT"]);

export type PublishIntentEvidence =
  | { kind: "LEASE_ACQUIRED"; leaseExpiresAt: Date }
  | { kind: "PROVIDER_CONFIRMED"; providerReference: string; publishedAt: Date }
  | { kind: "PROVIDER_REJECTED"; retryable: boolean; errorCode: string }
  | { kind: "OUTCOME_UNKNOWN"; reason: UnknownOutcomeReason }
  | { kind: "RECONCILED_PUBLISHED"; providerReference: string; publishedAt: Date }
  | { kind: "RECONCILED_REJECTED"; retryable: boolean; errorCode: string }
  | { kind: "RECONCILED_NOT_FOUND" }
  | { kind: "RETRY_BUDGET_EXHAUSTED" }
  | { kind: "LEASE_EXPIRED_BEFORE_PUBLISH_CALL" }
  | { kind: "USER_CANCELLED" }
  | { kind: "SOURCE_INVALIDATED" };

type Rule = { from: ReadonlyArray<PublishIntentState>; to: PublishIntentState };

function ruleFor(evidence: PublishIntentEvidence): Rule {
  switch (evidence.kind) {
    case "LEASE_ACQUIRED":
      return { from: ["PENDING", "RETRY_WAIT"], to: "IN_FLIGHT" };
    case "PROVIDER_CONFIRMED":
      return { from: ["IN_FLIGHT"], to: "PUBLISHED" };
    case "PROVIDER_REJECTED":
      return { from: ["IN_FLIGHT"], to: evidence.retryable ? "RETRY_WAIT" : "FAILED" };
    case "OUTCOME_UNKNOWN":
      return { from: ["IN_FLIGHT"], to: "UNKNOWN" };
    case "RECONCILED_PUBLISHED":
      return { from: ["UNKNOWN"], to: "PUBLISHED" };
    case "RECONCILED_REJECTED":
      return { from: ["UNKNOWN"], to: evidence.retryable ? "RETRY_WAIT" : "FAILED" };
    case "RECONCILED_NOT_FOUND":
      return { from: ["UNKNOWN"], to: "RETRY_WAIT" };
    case "RETRY_BUDGET_EXHAUSTED":
      return { from: ["RETRY_WAIT"], to: "FAILED" };
    case "LEASE_EXPIRED_BEFORE_PUBLISH_CALL":
      // P6-04: yalnızca korumalı denemenin yayın çağrısı işareti yoksa (çağrı başlayamazdı) güvenli ret sayılır.
      return { from: ["IN_FLIGHT"], to: "RETRY_WAIT" };
    case "USER_CANCELLED":
      return { from: ["PENDING", "RETRY_WAIT"], to: "CANCELLED" };
    case "SOURCE_INVALIDATED":
      return { from: ["PENDING", "RETRY_WAIT"], to: "INVALIDATED" };
  }
}

export type IntentTransitionSubject = {
  state: PublishIntentState;
  invalidatedAt: Date | null;
};

export type PlannedIntentTransition = {
  from: PublishIntentState;
  to: PublishIntentState;
  evidence: PublishIntentEvidence;
};

/**
 * Geçişi doğrular ve hedef durumu döndürür; imkânsız, yinelenen veya eski (stale) geçişte CONFLICT.
 * Kaynağı geçersizleşmiş bir intent yeniden gönderime (IN_FLIGHT/RETRY_WAIT) giremez.
 */
export function planIntentTransition(subject: IntentTransitionSubject, evidence: PublishIntentEvidence): PlannedIntentTransition {
  if ((evidence.kind === "PROVIDER_CONFIRMED" || evidence.kind === "RECONCILED_PUBLISHED") && !evidence.providerReference.trim()) {
    throw new DomainError("Yayın, sağlayıcı referansı olmadan doğrulanmış sayılamaz.", "VALIDATION_ERROR");
  }
  const rule = ruleFor(evidence);
  if (!rule.from.includes(subject.state)) {
    throw new DomainError(`Yayın niyeti ${subject.state} durumundan ${evidence.kind} ile ilerleyemez.`, "CONFLICT");
  }
  if (subject.invalidatedAt && (rule.to === "IN_FLIGHT" || rule.to === "RETRY_WAIT")) {
    throw new DomainError("Kaynağı geçersizleşmiş yayın niyeti yeniden gönderilemez.", "CONFLICT");
  }
  return { from: subject.state, to: rule.to, evidence };
}

/**
 * Süresi dolmuş bir IN_FLIGHT kiralaması UNKNOWN'dur: gönderim sağlayıcıya ulaşmış olabilir, bu yüzden
 * asla otomatik olarak yeniden denemeye güvenli sayılmaz. Diğer durumlarda zaman geçmesi kanıt değildir.
 */
export function evidenceForElapsedTime(
  subject: { state: PublishIntentState; leaseExpiresAt: Date | null },
  now: Date,
): PublishIntentEvidence | null {
  if (subject.state === "IN_FLIGHT" && subject.leaseExpiresAt && subject.leaseExpiresAt.getTime() <= now.getTime()) {
    return { kind: "OUTCOME_UNKNOWN", reason: "LEASE_EXPIRED" };
  }
  return null;
}

/**
 * P6-04: korumalı deneme protokolünün sürüm işareti. Talep (claim) sırasında denemenin teşhis alanına yazılır;
 * bu protokolde yayın çağrısı ancak aynı canlı kiralamaya karşı `publishCallStartedAt` kalıcı yazıldıktan sonra
 * yapılabilir. İşaretsiz (P6-03 veya daha eski) denemeler kanıtlanamaz sayılır.
 */
export const PUBLISH_CALL_GUARD_MARKER = "P6-04";

export type ExpiredLeaseAttemptEvidence = {
  status: PublishAttemptStatus;
  errorCode: string | null;
  diagnostics: unknown;
  publishCallStartedAt: Date | null;
} | null;

function isGuardedAttempt(diagnostics: unknown): boolean {
  return Boolean(diagnostics && typeof diagnostics === "object" && (diagnostics as { publishGuard?: unknown }).publishGuard === PUBLISH_CALL_GUARD_MARKER);
}

/**
 * P6-04: süresi dolmuş IN_FLIGHT için kanıta dayalı karar. Kiralama süresinin dolması tek başına "yayınlanmadı"
 * kanıtı DEĞİLDİR. Yalnızca korumalı protokolle oluşturulmuş, yayın çağrısı işareti boş ve henüz sonuçlanmamış
 * (veya yayın çağrısından önce bırakılmış) deneme güvenli ön-yayın kanıtıdır; diğer her durum UNKNOWN'dur.
 */
export function evidenceForExpiredLease(
  subject: { state: PublishIntentState; leaseExpiresAt: Date | null },
  attempt: ExpiredLeaseAttemptEvidence,
  now: Date,
): PublishIntentEvidence | null {
  const elapsed = evidenceForElapsedTime(subject, now);
  if (!elapsed) return null;
  if (!attempt || attempt.publishCallStartedAt || !isGuardedAttempt(attempt.diagnostics)) return elapsed;
  const unsent = attempt.status === "PENDING" || (attempt.status === "FAILED" && attempt.errorCode === "CLAIM_LOST_BEFORE_PUBLISH");
  return unsent ? { kind: "LEASE_EXPIRED_BEFORE_PUBLISH_CALL" } : elapsed;
}

/** P6-04: toplam sağlayıcı denemesi bütçesi (ilk deneme + en fazla iki yeniden deneme). */
export const MAX_PUBLISH_ATTEMPTS = 3;

/** P6-04: deterministik bekleme; kaydedilen sonuçtan ölçülür. 1. güvenli retten sonra 60 sn, 2.'den sonra 5 dk. */
export const RETRY_BACKOFF_MS: ReadonlyArray<number> = [60_000, 5 * 60_000];

export type RetryPlan = { kind: "RETRY"; nextAttemptAt: Date } | { kind: "EXHAUSTED" };

/** `attemptNumber` yeni sonuçlanan denemenin numarasıdır (1'den başlar). */
export function planRetry(attemptNumber: number, recordedAt: Date): RetryPlan {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber >= MAX_PUBLISH_ATTEMPTS) return { kind: "EXHAUSTED" };
  const delay = RETRY_BACKOFF_MS[attemptNumber - 1];
  return { kind: "RETRY", nextAttemptAt: new Date(recordedAt.getTime() + delay) };
}

/** submit() sonucunu kanıta çevirir. */
export function evidenceFromSubmitOutcome(outcome: PublishOutcome): PublishIntentEvidence {
  switch (outcome.kind) {
    case "PUBLISHED":
      return { kind: "PROVIDER_CONFIRMED", providerReference: outcome.providerReference, publishedAt: outcome.publishedAt };
    case "REJECTED":
      return { kind: "PROVIDER_REJECTED", retryable: outcome.retryable, errorCode: outcome.errorCode };
    case "UNKNOWN":
      return { kind: "OUTCOME_UNKNOWN", reason: outcome.reason };
  }
}

/**
 * getStatus()/mutabakat sonucunu kanıta çevirir. Yetkin olmayan NOT_FOUND ve UNKNOWN null döner:
 * belirsizlik sürer, intent UNKNOWN'da kalır.
 */
export function evidenceFromReconcileResult(result: ReconcileResult): PublishIntentEvidence | null {
  switch (result.kind) {
    case "PUBLISHED":
      return { kind: "RECONCILED_PUBLISHED", providerReference: result.providerReference, publishedAt: result.publishedAt };
    case "REJECTED":
      return { kind: "RECONCILED_REJECTED", retryable: result.retryable, errorCode: result.errorCode };
    case "NOT_FOUND":
      return result.authoritative ? { kind: "RECONCILED_NOT_FOUND" } : null;
    case "UNKNOWN":
      return null;
  }
}

export type PublishAttemptStatus = "PENDING" | "SUCCESS" | "FAILED" | "UNKNOWN";

/** Bir deneme sonucu yalnızca bir kez kaydedilir; sonuçlanmış denemeye ikinci sonuç yazılamaz. */
export function attemptStatusForOutcome(current: PublishAttemptStatus, outcome: PublishOutcome): PublishAttemptStatus {
  if (current !== "PENDING") {
    throw new DomainError("Bu yayın denemesinin sonucu zaten kaydedildi.", "CONFLICT");
  }
  if (outcome.kind === "PUBLISHED") return "SUCCESS";
  if (outcome.kind === "REJECTED") return "FAILED";
  return "UNKNOWN";
}
