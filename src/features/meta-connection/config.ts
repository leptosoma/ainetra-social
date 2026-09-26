import "server-only";

import { DomainError } from "@/lib/domain-error";

// P6-02: Facebook Login + Instagram API with Facebook Login yapılandırması. Değerler yalnızca ortam
// değişkenlerinden gelir; gerçek uygulama kimlik bilgileri depoya yazılmaz.

/** Meta Graph API sürümü açıkça sabitlenir; sürümsüz varsayılan hiçbir zaman kullanılmaz. */
export const META_GRAPH_API_VERSION_DEFAULT = "v26.0";

/**
 * P6-02 bağlantı çağrıları için doğrulanmış asgari izin kümesi (görev paketi, 2026-09-25).
 * ads_read/ads_management, yayınlama (instagram_content_publish, pages_manage_posts), analiz ve mesaj
 * izinleri bilinçli olarak istenmez.
 */
export const META_REQUIRED_SCOPES = ["pages_show_list", "instagram_basic", "pages_read_engagement"] as const;

/**
 * Instagram API with Facebook Login, uygulama kullanıcısının bağlı Page üzerinde bu görevlerden birini
 * yapabilmesini ister. P6-02 aynı kümeyi Facebook Page seçimi için de asgari uygunluk olarak kullanır;
 * yayınlama için gereken görevler P6-03 uç nokta incelemesinde doğrulanır.
 */
/**
 * P6-03 yayın izinleri (görev paketi, 2026-09-26). Bağlantı kapsamlarından çıkarılmaz; her platform için
 * açık bir yeniden yetkilendirme ile istenir ve gönderimden hemen önce debug_token ile yeniden doğrulanır.
 * Instagram (Facebook Login): instagram_content_publish (+ temel instagram_basic, pages_read_engagement).
 * Facebook Page metin/fotoğraf: pages_manage_posts (+ temel pages_read_engagement, pages_show_list).
 */
export const META_PUBLISH_SCOPES = {
  INSTAGRAM: ["instagram_content_publish"],
  FACEBOOK: ["pages_manage_posts"],
} as const satisfies Record<"INSTAGRAM" | "FACEBOOK", readonly string[]>;

/** Page üzerinde içerik oluşturma görevi (CREATE_CONTENT; MANAGE bunu kapsar) yayın için gereklidir. */
export const META_PUBLISH_PAGE_TASKS = ["MANAGE", "CREATE_CONTENT"] as const;

export const META_ELIGIBLE_PAGE_TASKS = ["MANAGE", "CREATE_CONTENT", "MODERATE", "ADVERTISE"] as const;

export const META_OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
export const META_SELECTION_TTL_MS = 10 * 60 * 1000;
export const META_POST_FLOW_PATH = "/settings";
export const META_SELECTION_PATH = "/settings/meta";

export type MetaConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
  graphBaseUrl: string;
  dialogBaseUrl: string;
};

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Sabit yönlendirme URI'si: HTTPS zorunlu, yalnızca yerel geliştirme için localhost HTTP istisnası. */
export function validateRedirectUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("META_REDIRECT_URI must be an absolute URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("META_REDIRECT_URI must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error("META_REDIRECT_URI must not contain query, fragment or credentials");
  }
  return url.toString();
}

/** Yapılandırma eksikse null; kısmi/yanlış yapılandırma sessizce kabul edilmez. */
export function loadMetaConfig(env: Readonly<Record<string, string | undefined>> = process.env): MetaConfig | null {
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  const redirectUri = env.META_REDIRECT_URI?.trim();
  if (!appId && !appSecret && !redirectUri) return null;
  if (!appId || !appSecret || !redirectUri) {
    throw new Error("META_APP_ID, META_APP_SECRET and META_REDIRECT_URI must be configured together");
  }
  if (!/^\d+$/.test(appId)) throw new Error("META_APP_ID must be numeric");
  const graphVersion = env.META_GRAPH_API_VERSION?.trim() || META_GRAPH_API_VERSION_DEFAULT;
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error("META_GRAPH_API_VERSION must look like v26.0");
  return {
    appId,
    appSecret,
    redirectUri: validateRedirectUri(redirectUri),
    graphVersion,
    graphBaseUrl: `https://graph.facebook.com/${graphVersion}`,
    dialogBaseUrl: `https://www.facebook.com/${graphVersion}/dialog/oauth`,
  };
}

export function requireMetaConfig(config: MetaConfig | null | undefined): MetaConfig {
  if (!config) throw new DomainError("Meta bağlantısı bu ortamda yapılandırılmamış.", "VALIDATION_ERROR");
  return config;
}
