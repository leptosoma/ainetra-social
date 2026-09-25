import { createHash } from "node:crypto";

/**
 * P6-01: Onaylı güncel sürümün yayınla ilgili alanlarının değişmez anlık görüntüsü.
 *
 * Sürüm 1 alanları bilinçli olarak dar tutulur: token/secret, tarayıcıdan gelen iş bilgisi veya
 * sağlayıcıya özgü kimlik (ör. Postiz) içermez. Şekil değişirse PUBLISH_SNAPSHOT_VERSION artırılır ve
 * eski satırlar kendi sürümleriyle okunmaya devam eder; mevcut snapshot'lar asla yeniden yazılmaz.
 */
export const PUBLISH_SNAPSHOT_VERSION = 1;

export type PublishSnapshotPlatform = "INSTAGRAM" | "FACEBOOK";

export type PublishSnapshotMediaV1 = {
  mediaAssetId: string;
  type: "IMAGE" | "VIDEO";
  mimeType: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  size: number;
  origin: string;
  derivedFromId: string | null;
};

export type PublishSnapshotV1 = {
  snapshotVersion: 1;
  businessId: string;
  scheduledPostId: string;
  scheduledAt: string;
  target: {
    socialAccountId: string;
    platform: PublishSnapshotPlatform;
    externalAccountId: string | null;
  };
  content: {
    contentItemId: string;
    variantId: string;
    version: number;
    approvalId: string;
    contentType: "POST" | "REEL" | "STORY" | "CAROUSEL";
    platform: PublishSnapshotPlatform;
    caption: string;
    cta: string | null;
    language: string;
    aspectRatio: string | null;
    formatMetadata: unknown;
  };
  media: PublishSnapshotMediaV1 | null;
};

export type PublishSnapshotSource = {
  businessId: string;
  post: { id: string; scheduledAt: Date };
  account: { id: string; platform: PublishSnapshotPlatform; externalAccountId: string | null };
  variant: {
    id: string;
    version: number;
    caption: string;
    cta: string | null;
    language: string;
    aspectRatio: string | null;
    formatMetadata: unknown;
    contentItem: { id: string; contentType: PublishSnapshotV1["content"]["contentType"] };
  };
  approval: { id: string };
  media: {
    id: string;
    type: "IMAGE" | "VIDEO";
    mimeType: string;
    storageKey: string;
    width: number | null;
    height: number | null;
    size: number;
    origin: string;
    derivedFromId: string | null;
  } | null;
};

export function buildPublishSnapshot(source: PublishSnapshotSource): PublishSnapshotV1 {
  return {
    snapshotVersion: PUBLISH_SNAPSHOT_VERSION,
    businessId: source.businessId,
    scheduledPostId: source.post.id,
    scheduledAt: source.post.scheduledAt.toISOString(),
    target: {
      socialAccountId: source.account.id,
      platform: source.account.platform,
      externalAccountId: source.account.externalAccountId,
    },
    content: {
      contentItemId: source.variant.contentItem.id,
      variantId: source.variant.id,
      version: source.variant.version,
      approvalId: source.approval.id,
      contentType: source.variant.contentItem.contentType,
      platform: source.account.platform,
      caption: source.variant.caption,
      cta: source.variant.cta,
      language: source.variant.language,
      aspectRatio: source.variant.aspectRatio,
      formatMetadata: source.variant.formatMetadata ?? {},
    },
    media: source.media
      ? {
          mediaAssetId: source.media.id,
          type: source.media.type,
          mimeType: source.media.mimeType,
          storageKey: source.media.storageKey,
          width: source.media.width,
          height: source.media.height,
          size: source.media.size,
          origin: source.media.origin,
          derivedFromId: source.media.derivedFromId,
        }
      : null,
  };
}

/** Anahtarları sıralı, boşluksuz JSON; aynı içerik her zaman aynı metni üretir. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export function hashPublishSnapshot(snapshot: PublishSnapshotV1): string {
  return `sha256:${createHash("sha256").update(canonicalJson(snapshot)).digest("hex")}`;
}

/** Gelecekteki gönderim, dış işten önce saklanan snapshot'ın özetini yeniden doğrulamalıdır. */
export function verifyPublishSnapshotHash(snapshot: unknown, expectedHash: string): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  return hashPublishSnapshot(snapshot as PublishSnapshotV1) === expectedHash;
}

/** Sağlayıcıya iletilecek, (post, nesil) başına sabit ve opak idempotency anahtarı. */
export function derivePublishIdempotencyKey(scheduledPostId: string, generation: number): string {
  const digest = createHash("sha256").update(`ainetra-publish:v1:${scheduledPostId}:${generation}`).digest("hex");
  return `ainetra-pub-${digest.slice(0, 40)}`;
}
