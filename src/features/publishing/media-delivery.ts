import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { storage as defaultStorage, type StorageProvider } from "@/lib/storage";
import type { PublishSnapshotV1 } from "./snapshot";

// P6-03: Instagram'ın `image_url` ile çekmesi için Ainetra'ya ait, kısa ömürlü, imzalı ve salt okunur medya
// teslimi. Depo veya orijinal kalıcı olarak herkese açılmaz. İmza bir sırdır: URL loglanmaz, hata metnine
// yazılmaz, veritabanına kaydedilmez. Bağlam (deneme/intent/işletme/medya/depo anahtarı) imzaya dahildir ve
// her istekte veritabanından yeniden türetilir; deneme sonuçlandığında URL kendiliğinden geçersizleşir.

export const MEDIA_DELIVERY_TTL_MS = 15 * 60 * 1000;
export const MEDIA_DELIVERY_MAX_BYTES = 8 * 1024 * 1024;
export const MEDIA_DELIVERY_PATH = "/media/publish";

const TOKEN_PATTERN = /^([a-z0-9]{10,40})\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

export type MediaDeliveryConfig = { secret: string; publicBaseUrl: string };

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * MEDIA_DELIVERY_SECRET (en az 32 karakter) ve PUBLIC_APP_URL (HTTPS; yalnızca yerel geliştirme için
 * localhost HTTP). İkisi de boşsa null (Instagram gönderimi yapılandırılmamış); kısmi yapılandırma hata verir.
 */
export function loadMediaDeliveryConfig(env: Readonly<Record<string, string | undefined>> = process.env): MediaDeliveryConfig | null {
  const secret = env.MEDIA_DELIVERY_SECRET?.trim();
  const base = env.PUBLIC_APP_URL?.trim();
  if (!secret && !base) return null;
  if (!secret || !base) throw new Error("MEDIA_DELIVERY_SECRET and PUBLIC_APP_URL must be configured together");
  if (secret.length < 32) throw new Error("MEDIA_DELIVERY_SECRET must be at least 32 characters");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("PUBLIC_APP_URL must be an absolute URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("PUBLIC_APP_URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (url.search || url.hash || url.username || url.password) throw new Error("PUBLIC_APP_URL must not contain query, fragment or credentials");
  return { secret, publicBaseUrl: url.origin + url.pathname.replace(/\/+$/, "") };
}

export type MediaDeliveryBinding = {
  attemptId: string;
  intentId: string;
  businessId: string;
  mediaAssetId: string;
  storageKey: string;
};

function sign(config: MediaDeliveryConfig, binding: MediaDeliveryBinding, expiresAtSeconds: number) {
  const payload = ["ainetra-media:v1", binding.attemptId, binding.intentId, binding.businessId, binding.mediaAssetId, binding.storageKey, String(expiresAtSeconds)].join("|");
  return createHmac("sha256", config.secret).update(payload).digest("base64url");
}

/** Sağlayıcıya verilecek imzalı URL. Yalnızca bellekte kullanılır; hiçbir yerde saklanmaz. */
export function createSignedMediaUrl(config: MediaDeliveryConfig, binding: MediaDeliveryBinding, now: Date): string {
  const expiresAtSeconds = Math.floor((now.getTime() + MEDIA_DELIVERY_TTL_MS) / 1000);
  return `${config.publicBaseUrl}${MEDIA_DELIVERY_PATH}/${binding.attemptId}.${expiresAtSeconds}.${sign(config, binding, expiresAtSeconds)}`;
}

function startsWithJpegMagic(bytes: Uint8Array) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export type DeliveredMedia = { bytes: Uint8Array; mimeType: "image/jpeg" };

/**
 * Jetonu doğrular ve yalnızca dondurulmuş snapshot'taki tam JPEG'i döndürür. Her başarısızlık aynı şekilde
 * null döner (neden sızdırılmaz). Koşullar: biçim, süre (en fazla TTL kadar ileride), deneme hâlâ bekliyor ve
 * intent'in IN_FLIGHT kiralamasını tutan deneme, Instagram hedefi, imza (sabit zamanlı karşılaştırma),
 * medya satırı aynı işletmede ve aynı depo anahtarıyla duruyor, bayt sayısı ve JPEG imzası snapshot'la uyumlu.
 */
export async function resolveSignedMedia(
  token: string,
  options: { config?: MediaDeliveryConfig | null; storage?: StorageProvider; now?: Date } = {},
): Promise<DeliveredMedia | null> {
  let config: MediaDeliveryConfig | null;
  try {
    config = options.config !== undefined ? options.config : loadMediaDeliveryConfig();
  } catch {
    return null;
  }
  if (!config) return null;
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const [, attemptId, expiresRaw, signature] = match;
  const now = options.now ?? new Date();
  const expiresAtSeconds = Number(expiresRaw);
  const nowSeconds = now.getTime() / 1000;
  if (expiresAtSeconds <= nowSeconds || expiresAtSeconds > nowSeconds + MEDIA_DELIVERY_TTL_MS / 1000 + 60) return null;

  const attempt = await prisma.publishAttempt.findUnique({ where: { id: attemptId }, include: { publishIntent: true } });
  const intent = attempt?.publishIntent;
  if (!attempt || !intent || attempt.status !== "PENDING" || intent.state !== "IN_FLIGHT" || intent.currentAttemptId !== attempt.id) return null;
  if (intent.platform !== "INSTAGRAM") return null;
  const snapshot = intent.snapshot as unknown as PublishSnapshotV1;
  const media = snapshot?.media;
  if (!media || media.type !== "IMAGE" || media.mimeType !== "image/jpeg" || snapshot.businessId !== intent.businessId) return null;

  const expected = Buffer.from(sign(config, { attemptId, intentId: intent.id, businessId: intent.businessId, mediaAssetId: media.mediaAssetId, storageKey: media.storageKey }, expiresAtSeconds));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const asset = await prisma.mediaAsset.findUnique({ where: { id: media.mediaAssetId } });
  if (!asset || asset.businessId !== intent.businessId || asset.storageKey !== media.storageKey) return null;
  if (media.size > MEDIA_DELIVERY_MAX_BYTES) return null;
  let object;
  try {
    object = await (options.storage ?? defaultStorage).get(media.storageKey);
  } catch {
    return null;
  }
  if (!object || object.bytes.byteLength !== media.size || !startsWithJpegMagic(object.bytes)) return null;
  return { bytes: object.bytes, mimeType: "image/jpeg" };
}
