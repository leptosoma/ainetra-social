import "server-only";

import sharp, { type Metadata } from "sharp";
import type { StorageProvider } from "@/lib/storage";
import type { MetaPublishingGraphClient } from "@/features/meta-connection/graph-client";
import type {
  AccountCapabilities,
  AccountConnection,
  CancelResult,
  PrepareMediaRequest,
  PrepareMediaResult,
  PublishOutcome,
  PublishingAdapter,
  ReconcileResult,
  SubmitRequest,
} from "./adapter";
import { PUBLISHING_ROUTES } from "./adapter";
import { classifyMetaFailure } from "./meta-result";
import type { MediaDeliveryBinding } from "./media-delivery";
import type { PublishSnapshotV1 } from "./snapshot";

// P6-03: yerel Meta PublishingAdapter. Yalnızca şu biçimler desteklenir:
// - Instagram: tek JPEG görselli gönderi (POST) + onaylı altyazı/CTA
// - Facebook Page: yalnızca metin gönderisi ve tek JPEG/PNG fotoğraflı gönderi (POST)
// Adaptör durum yazmaz; yalnızca dondurulmuş snapshot'tan yük üretir ve normalize edilmiş sonuç döndürür.
// Sağlayıcıya özgü hedef kimliği tarayıcıdan değil, sunucuda çözülen bağlantıdan (target) gelir.
// P6-04: her gerçek yayın çağrısından (IG /media_publish, FB /feed, FB /photos) hemen önce beforePublishCall
// koruması çalışır; IG konteyner oluşturma/durum denetimi yayın değildir ve korumadan önce kalır.

export const META_ADAPTER_KEY = PUBLISHING_ROUTES.INSTAGRAM.adapterKey;
export const META_ADAPTER_VERSION = PUBLISHING_ROUTES.INSTAGRAM.adapterVersion;

export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_HASHTAG_MAX = 30;
export const FACEBOOK_MESSAGE_MAX = 63206;
export const INSTAGRAM_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const FACEBOOK_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const INSTAGRAM_MIN_ASPECT = 4 / 5;
const INSTAGRAM_MAX_ASPECT = 1.91;

export type MetaAdapterRejection =
  | "UNSUPPORTED_FORMAT"
  | "TARGET_MISMATCH"
  | "MEDIA_REQUIRED"
  | "MEDIA_MISSING"
  | "MEDIA_UNSUPPORTED"
  | "MEDIA_TOO_LARGE"
  | "MEDIA_ASPECT_RATIO"
  | "MEDIA_COLOR_SPACE"
  | "TEXT_EMPTY"
  | "TEXT_TOO_LONG"
  | "TOO_MANY_HASHTAGS"
  | "CONTAINER_ERROR"
  | "CONTAINER_EXPIRED"
  | "CONTAINER_NOT_READY"
  | "MEDIA_DELIVERY_UNAVAILABLE"
  | "CREDENTIAL_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PUBLISH_CALL_FENCED";

export type MetaAdapterDeps = {
  graph: MetaPublishingGraphClient;
  /** Opak tutamaçtan sunucu tarafında token çözümü; token adaptör dışına çıkmaz. */
  resolveToken: (target: AccountConnection) => Promise<string>;
  storage: StorageProvider;
  /** Instagram için imzalı, kısa ömürlü görsel URL'si; yapılandırılmamışsa null. */
  signMediaUrl: (binding: MediaDeliveryBinding) => string | null;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  containerPoll?: { attempts: number; intervalMs: number };
};

/**
 * Altyazı ve ayrı CTA, önizlemedeki sırayla deterministik birleştirilir: altyazı, boş satır, CTA.
 * Metin asla kırpılmaz veya üretilmez; sınır aşımı ret sebebidir.
 */
export function composeProviderText(snapshot: PublishSnapshotV1): string {
  const caption = snapshot.content.caption.trim();
  const cta = snapshot.content.cta?.trim() ?? "";
  return [caption, cta].filter(Boolean).join("\n\n");
}

function reject(errorCode: MetaAdapterRejection, retryable = false): Extract<PrepareMediaResult, { kind: "REJECTED" }> {
  return { kind: "REJECTED", retryable, errorCode, diagnostics: { code: errorCode } };
}

/** P6-04: çağrı-başladı işareti yazılamadıysa yayın çağrısı yapılmaz; hiçbir şey gönderilmemiştir. */
async function publishCallAllowed(request: SubmitRequest): Promise<boolean> {
  try {
    return (await request.beforePublishCall()) === true;
  } catch {
    return false;
  }
}

function validateText(platform: "INSTAGRAM" | "FACEBOOK", text: string, hasMedia: boolean): MetaAdapterRejection | null {
  const length = [...text].length;
  if (platform === "INSTAGRAM") {
    if (length > INSTAGRAM_CAPTION_MAX) return "TEXT_TOO_LONG";
    if ((text.match(/#[^\s#]+/g) ?? []).length > INSTAGRAM_HASHTAG_MAX) return "TOO_MANY_HASHTAGS";
    return null;
  }
  if (length > FACEBOOK_MESSAGE_MAX) return "TEXT_TOO_LONG";
  if (!hasMedia && length === 0) return "TEXT_EMPTY";
  return null;
}

type LoadedImage = { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" };

/** Dondurulmuş medyanın baytlarını okur ve platform kurallarına göre doğrular; orijinali değiştirmez. */
async function loadSnapshotImage(storage: StorageProvider, snapshot: PublishSnapshotV1, platform: "INSTAGRAM" | "FACEBOOK"): Promise<LoadedImage | MetaAdapterRejection> {
  const media = snapshot.media;
  if (!media) return "MEDIA_REQUIRED";
  if (media.type !== "IMAGE") return "MEDIA_UNSUPPORTED";
  const allowed = platform === "INSTAGRAM" ? ["image/jpeg"] : ["image/jpeg", "image/png"];
  if (!allowed.includes(media.mimeType)) return "MEDIA_UNSUPPORTED";
  const maxBytes = platform === "INSTAGRAM" ? INSTAGRAM_IMAGE_MAX_BYTES : FACEBOOK_PHOTO_MAX_BYTES;
  if (media.size > maxBytes) return "MEDIA_TOO_LARGE";
  const object = await storage.get(media.storageKey);
  if (!object) return "MEDIA_MISSING";
  if (object.bytes.byteLength !== media.size) return "MEDIA_MISSING";
  if (object.bytes.byteLength > maxBytes) return "MEDIA_TOO_LARGE";
  let metadata: Metadata;
  try {
    metadata = await sharp(object.bytes, { failOn: "error" }).metadata();
  } catch {
    return "MEDIA_UNSUPPORTED";
  }
  const expectedFormat = media.mimeType === "image/png" ? "png" : "jpeg";
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) return "MEDIA_UNSUPPORTED";
  if (platform === "INSTAGRAM") {
    const aspect = metadata.width / metadata.height;
    if (aspect < INSTAGRAM_MIN_ASPECT - 0.005 || aspect > INSTAGRAM_MAX_ASPECT + 0.005) return "MEDIA_ASPECT_RATIO";
    if (metadata.space !== "srgb") return "MEDIA_COLOR_SPACE";
  }
  return { bytes: object.bytes, mimeType: media.mimeType as LoadedImage["mimeType"] };
}

export function createMetaPublishingAdapter(deps: MetaAdapterDeps): PublishingAdapter {
  const poll = deps.containerPoll ?? { attempts: 5, intervalMs: 2000 };

  async function token(target: AccountConnection): Promise<string | null> {
    try {
      return await deps.resolveToken(target);
    } catch {
      return null;
    }
  }

  function precheck(snapshot: PublishSnapshotV1, target: AccountConnection): MetaAdapterRejection | null {
    if (snapshot.content.contentType !== "POST") return "UNSUPPORTED_FORMAT";
    if (target.platform !== snapshot.target.platform || target.platform !== snapshot.content.platform) return "TARGET_MISMATCH";
    if (target.businessId !== snapshot.businessId || target.socialAccountId !== snapshot.target.socialAccountId) return "TARGET_MISMATCH";
    if (!snapshot.target.externalAccountId || target.externalAccountId !== snapshot.target.externalAccountId) return "TARGET_MISMATCH";
    return null;
  }

  async function submitInstagram(request: SubmitRequest, accessToken: string): Promise<PublishOutcome> {
    const containerId = request.preparedMedia[0]?.providerMediaReference;
    if (!containerId) return reject("CONTAINER_ERROR");
    // Konteyner hazır olana kadar sınırlı durum denetimi. FINISHED yayın DEĞİLDİR.
    for (let check = 0; ; check++) {
      let status;
      try {
        status = await deps.graph.getContainerStatus(containerId, accessToken);
      } catch (error) {
        return classifyMetaFailure(error, "PRE_PUBLISH");
      }
      if (status === "FINISHED") break;
      if (status === "ERROR") return reject("CONTAINER_ERROR");
      if (status === "EXPIRED") return reject("CONTAINER_EXPIRED");
      // Bu denemede yeni oluşturulan konteyner zaten yayınlanmış görünüyorsa bu bizim yayın çağrımız değildir;
      // yorumlanmaz, mutabakata (P6-05) bırakılır.
      if (status === "PUBLISHED") return { kind: "UNKNOWN", reason: "PROVIDER_AMBIGUOUS", providerReference: containerId, diagnostics: { code: "CONTAINER_ALREADY_PUBLISHED" } };
      if (check + 1 >= poll.attempts) return reject("CONTAINER_NOT_READY", true);
      await deps.sleep(poll.intervalMs);
    }
    if (!(await publishCallAllowed(request))) return reject("PUBLISH_CALL_FENCED", true);
    try {
      const { mediaId } = await deps.graph.publishContainer(request.target.externalAccountId!, containerId, accessToken);
      return { kind: "PUBLISHED", providerReference: mediaId, remotePostId: mediaId, publishedAt: deps.now() };
    } catch (error) {
      return classifyMetaFailure(error, "PUBLISH", containerId);
    }
  }

  async function submitFacebook(request: SubmitRequest, accessToken: string): Promise<PublishOutcome> {
    const pageId = request.target.externalAccountId!;
    const text = composeProviderText(request.snapshot);
    if (!request.snapshot.media) {
      if (!(await publishCallAllowed(request))) return reject("PUBLISH_CALL_FENCED", true);
      try {
        const { postId } = await deps.graph.createFeedPost(pageId, text, accessToken);
        return { kind: "PUBLISHED", providerReference: postId, remotePostId: postId, publishedAt: deps.now() };
      } catch (error) {
        return classifyMetaFailure(error, "PUBLISH");
      }
    }
    const image = await loadSnapshotImage(deps.storage, request.snapshot, "FACEBOOK");
    if (typeof image === "string") return reject(image);
    if (!(await publishCallAllowed(request))) return reject("PUBLISH_CALL_FENCED", true);
    try {
      const { postId, photoId } = await deps.graph.createPagePhoto(pageId, { bytes: image.bytes, mimeType: image.mimeType, caption: text }, accessToken);
      const reference = postId ?? photoId!;
      return { kind: "PUBLISHED", providerReference: reference, remotePostId: reference, publishedAt: deps.now() };
    } catch (error) {
      return classifyMetaFailure(error, "PUBLISH");
    }
  }

  return {
    adapterKey: META_ADAPTER_KEY,
    adapterVersion: META_ADAPTER_VERSION,
    platforms: ["INSTAGRAM", "FACEBOOK"],

    async getCapabilities(connection): Promise<AccountCapabilities> {
      return {
        contentTypes: ["POST"],
        mediaTypes: ["IMAGE"],
        requiresMedia: connection.platform === "INSTAGRAM",
        supportsCancellation: false,
        // Bu yayın uç noktaları belgelenmiş bir idempotency anahtarı veya anahtarla arama sunmaz.
        supportsIdempotencyLookup: false,
        supportsProviderReferenceLookup: false,
      };
    },

    async prepareMedia(request: PrepareMediaRequest): Promise<PrepareMediaResult> {
      const { snapshot, target } = request;
      const mismatch = precheck(snapshot, target);
      if (mismatch) return reject(mismatch);
      const platform = target.platform;
      const text = composeProviderText(snapshot);
      if (platform === "INSTAGRAM" && !snapshot.media) return reject("MEDIA_REQUIRED");
      const textProblem = validateText(platform, text, Boolean(snapshot.media));
      if (textProblem) return reject(textProblem);

      if (platform === "FACEBOOK") {
        if (!snapshot.media) return { kind: "READY", media: [] };
        const image = await loadSnapshotImage(deps.storage, snapshot, "FACEBOOK");
        if (typeof image === "string") return reject(image);
        return { kind: "READY", media: [{ mediaAssetId: snapshot.media.mediaAssetId, providerMediaReference: `snapshot:${snapshot.media.mediaAssetId}` }] };
      }

      const image = await loadSnapshotImage(deps.storage, snapshot, "INSTAGRAM");
      if (typeof image === "string") return reject(image);
      const media = snapshot.media!;
      const imageUrl = deps.signMediaUrl({ attemptId: request.attemptId, intentId: request.intentId, businessId: snapshot.businessId, mediaAssetId: media.mediaAssetId, storageKey: media.storageKey });
      if (!imageUrl) return reject("MEDIA_DELIVERY_UNAVAILABLE", true);
      const accessToken = await token(target);
      if (!accessToken) return reject("CREDENTIAL_UNAVAILABLE", true);
      try {
        const limit = await deps.graph.getContentPublishingLimit(target.externalAccountId!, accessToken);
        if (limit && limit.usage >= limit.total) return reject("RATE_LIMITED", true);
        const { containerId } = await deps.graph.createImageContainer(target.externalAccountId!, { imageUrl, caption: text }, accessToken);
        return { kind: "READY", media: [{ mediaAssetId: media.mediaAssetId, providerMediaReference: containerId }] };
      } catch (error) {
        // Konteyner gönderi değildir: bu aşamadaki her hata ya kesin rettir ya da güvenle yeniden denenebilir.
        const outcome = classifyMetaFailure(error, "PRE_PUBLISH");
        return outcome.kind === "REJECTED" ? outcome : { kind: "REJECTED", retryable: true, errorCode: "PROVIDER_UNAVAILABLE", diagnostics: outcome.diagnostics };
      }
    },

    async submit(request: SubmitRequest): Promise<PublishOutcome> {
      const mismatch = precheck(request.snapshot, request.target);
      if (mismatch) return reject(mismatch);
      const accessToken = await token(request.target);
      if (!accessToken) return reject("CREDENTIAL_UNAVAILABLE", true);
      return request.target.platform === "INSTAGRAM" ? submitInstagram(request, accessToken) : submitFacebook(request, accessToken);
    },

    async getStatus(): Promise<ReconcileResult> {
      // P6-05 mutabakatı üstlenir; P6-03 sağlayıcıda arama yapmaz ve "bulunamadı" kanıtı üretmez.
      return { kind: "NOT_FOUND", authoritative: false, diagnostics: { code: "RECONCILIATION_NOT_IMPLEMENTED" } };
    },

    async cancel(): Promise<CancelResult> {
      return { kind: "NOT_CANCELLABLE", errorCode: "NOT_SUPPORTED" };
    },
  };
}
