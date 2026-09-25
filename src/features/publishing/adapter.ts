import type { PublishSnapshotPlatform, PublishSnapshotV1 } from "./snapshot";

/**
 * P6-01: Ainetra'ya ait, sağlayıcıdan bağımsız yayınlama sözleşmesi (yalnızca tipler).
 *
 * Bu görevde hiçbir gerçek ya da sahte (no-op) Meta/Postiz uygulaması yoktur. P6-02..P6-05
 * uygulamaları bu arayüzü gerçekler. Kurallar:
 * - Ainetra PostgreSQL tek doğruluk kaynağıdır; adaptör yalnızca sonuç bildirir, durum yazmaz.
 * - Token/secret değeri hiçbir istek, sonuç, snapshot, log veya istemci prop'unda taşınmaz;
 *   adaptöre yalnızca opak bir CredentialHandle verilir.
 * - Zaman aşımı veya belirsiz yanıt UNKNOWN'dur; asla otomatik "yayınlandı" ya da "başarısız" değildir.
 */

export type PublishingPlatform = PublishSnapshotPlatform;

export type PublishingAdapterRoute = {
  adapterKey: string;
  adapterVersion: number;
};

/**
 * Yeni intent'lerin kaydedildiği hedef rota. Kayıtlı rota, satır boşaltılana kadar değişmez; bir
 * uygulamanın varlığı anlamına gelmez (P6-01'de hiçbir adaptör uygulanmamıştır). TikTok Phase 6 dışıdır.
 */
export const PUBLISHING_ROUTES: Readonly<Record<PublishingPlatform, PublishingAdapterRoute>> = {
  INSTAGRAM: { adapterKey: "meta-native", adapterVersion: 1 },
  FACEBOOK: { adapterKey: "meta-native", adapterVersion: 1 },
};

export function isSupportedPublishingPlatform(platform: string): platform is PublishingPlatform {
  return Object.prototype.hasOwnProperty.call(PUBLISHING_ROUTES, platform);
}

/** Şifreli kimlik bilgisine opak referans; değerin kendisi asla bu tipte bulunmaz. */
export type CredentialHandle = {
  readonly kind: "credential-handle";
  readonly handleId: string;
};

export type AccountCapabilities = {
  contentTypes: ReadonlyArray<PublishSnapshotV1["content"]["contentType"]>;
  mediaTypes: ReadonlyArray<"IMAGE" | "VIDEO">;
  requiresMedia: boolean;
  supportsCancellation: boolean;
  /** Sağlayıcı idempotency anahtarıyla arama yapabiliyorsa true; mutabakatın yetkinliğini belirler. */
  supportsIdempotencyLookup: boolean;
  supportsProviderReferenceLookup: boolean;
};

export type AccountConnection = {
  businessId: string;
  socialAccountId: string;
  platform: PublishingPlatform;
  externalAccountId: string;
  credential: CredentialHandle;
};

/** Yalnızca kapalı, redakte edilmiş alanlar; serbest biçimli ham sağlayıcı yükü tutulmaz. */
export type RedactedDiagnostics = {
  code?: string;
  message?: string;
  httpStatus?: number;
  providerRequestId?: string;
};

export type PrepareMediaRequest = {
  snapshot: PublishSnapshotV1;
  target: AccountConnection;
  idempotencyKey: string;
};

export type PreparedMedia = {
  mediaAssetId: string;
  providerMediaReference: string;
  expiresAt?: Date;
};

export type PrepareMediaResult =
  | { kind: "READY"; media: PreparedMedia[]; diagnostics?: RedactedDiagnostics }
  | { kind: "REJECTED"; retryable: boolean; errorCode: string; diagnostics?: RedactedDiagnostics }
  | { kind: "UNKNOWN"; reason: UnknownOutcomeReason; diagnostics?: RedactedDiagnostics };

export type SubmitRequest = {
  intentId: string;
  snapshot: PublishSnapshotV1;
  snapshotHash: string;
  idempotencyKey: string;
  target: AccountConnection;
  preparedMedia: PreparedMedia[];
};

export type UnknownOutcomeReason = "TIMEOUT" | "TRANSPORT_ERROR" | "PROVIDER_AMBIGUOUS" | "LEASE_EXPIRED";

/** Normalize edilmiş sağlayıcı sonucu. */
export type PublishOutcome =
  | {
      kind: "PUBLISHED";
      providerReference: string;
      remotePostId: string;
      publishedAt: Date;
      url?: string;
      diagnostics?: RedactedDiagnostics;
    }
  | { kind: "REJECTED"; retryable: boolean; errorCode: string; diagnostics?: RedactedDiagnostics }
  | { kind: "UNKNOWN"; reason: UnknownOutcomeReason; providerReference?: string; diagnostics?: RedactedDiagnostics };

/** Mutabakat: bilinen sağlayıcı referansıyla ve/veya idempotency anahtarıyla arama. */
export type ReconcileRequest = {
  intentId: string;
  idempotencyKey: string;
  providerReference?: string;
  target: AccountConnection;
};

/**
 * NOT_FOUND yalnızca `authoritative: true` ise "yayınlanmadı" kanıtıdır (sağlayıcı idempotency
 * anahtarıyla yetkin arama destekliyorsa). Aksi halde belirsizlik sürer.
 */
export type ReconcileResult =
  | PublishOutcome
  | { kind: "NOT_FOUND"; authoritative: boolean; diagnostics?: RedactedDiagnostics };

export type CancelRequest = {
  intentId: string;
  idempotencyKey: string;
  providerReference?: string;
  target: AccountConnection;
};

export type CancelResult =
  | { kind: "CANCELLED"; diagnostics?: RedactedDiagnostics }
  | { kind: "NOT_CANCELLABLE"; errorCode: string; diagnostics?: RedactedDiagnostics }
  | { kind: "UNKNOWN"; reason: UnknownOutcomeReason; diagnostics?: RedactedDiagnostics };

export interface PublishingAdapter {
  readonly adapterKey: string;
  readonly adapterVersion: number;
  readonly platforms: ReadonlyArray<PublishingPlatform>;
  getCapabilities(connection: AccountConnection): Promise<AccountCapabilities>;
  prepareMedia(request: PrepareMediaRequest): Promise<PrepareMediaResult>;
  submit(request: SubmitRequest): Promise<PublishOutcome>;
  getStatus(request: ReconcileRequest): Promise<ReconcileResult>;
  cancel(request: CancelRequest): Promise<CancelResult>;
}
