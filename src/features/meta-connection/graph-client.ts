import "server-only";

import { createHmac } from "node:crypto";
import type { MetaConfig } from "./config";

// P6-02: küçük, sunucuya özel Meta OAuth/Graph istemcisi. Token'lar yalnızca POST gövdesinde veya
// Authorization başlığında taşınır (debug_token'ın input_token parametresi hariç); URL, yanıt gövdesi,
// hata metni veya log hiçbir zaman dışarı verilmez. Zaman aşımı ve yanıt boyutu sınırlıdır.

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PAGE_LIST_LIMIT = 50;
const MAX_PAGE_LIST_REQUESTS = 20;
const META_ID = /^\d{1,32}$/;

export type MetaErrorKind = "PROVIDER" | "TIMEOUT" | "TRANSPORT" | "INVALID_RESPONSE";

/** Yalnızca kapalı, redakte edilmiş alanlar. İstek URL'si, token veya ham gövde asla taşınmaz. */
export class MetaGraphError extends Error {
  constructor(
    public readonly kind: MetaErrorKind,
    public readonly details: { httpStatus?: number; code?: number; subcode?: number; type?: string; isTransient?: boolean; traceId?: string } = {},
  ) {
    super(`Meta request failed (${kind}${details.code !== undefined ? ` ${details.code}` : ""})`);
    this.name = "MetaGraphError";
  }

  /** Meta OAuthException 190: token geçersiz, süresi dolmuş veya iptal edilmiş. */
  get isInvalidToken() {
    return this.kind === "PROVIDER" && this.details.code === 190;
  }
}

export type MetaUserToken = { accessToken: string; tokenType: string | null; expiresInSeconds: number | null };

export type MetaTokenDebug = {
  appId: string | null;
  type: string | null;
  isValid: boolean;
  /** null: sağlayıcı sona erme bildirmedi ya da 0 (süresiz) bildirdi; kalıcılık varsayılmaz. */
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  userId: string | null;
  profileId: string | null;
};

export type MetaPage = {
  id: string;
  name: string;
  accessToken: string | null;
  tasks: string[];
  instagramBusinessAccountId: string | null;
};

export type MetaPageDetails = { id: string; name: string; instagramBusinessAccountId: string | null };
export type MetaInstagramAccount = { id: string; username: string | null };

export interface MetaGraphClient {
  buildAuthorizeUrl(state: string, scopes: readonly string[], options?: { rerequest?: boolean }): string;
  exchangeCode(code: string): Promise<MetaUserToken>;
  exchangeLongLivedUserToken(userToken: string): Promise<MetaUserToken>;
  debugToken(token: string): Promise<MetaTokenDebug>;
  listPages(userToken: string): Promise<MetaPage[]>;
  getPage(pageId: string, pageToken: string): Promise<MetaPageDetails>;
  getInstagramAccount(instagramAccountId: string, pageToken: string): Promise<MetaInstagramAccount>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function metaId(value: unknown): string | null {
  const id = optionalString(value);
  return id && META_ID.test(id) ? id : null;
}

function epochSeconds(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function assertMetaId(value: string): string {
  if (!META_ID.test(value)) throw new MetaGraphError("INVALID_RESPONSE");
  return value;
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) throw new MetaGraphError("INVALID_RESPONSE", { httpStatus: response.status });
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new MetaGraphError("INVALID_RESPONSE", { httpStatus: response.status });
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MetaGraphError("INVALID_RESPONSE", { httpStatus: response.status });
  }
}

type MetaRequestInit = {
  method: "GET" | "POST";
  query?: Record<string, string>;
  form?: Record<string, string>;
  multipart?: FormData;
  bearer?: string;
  timeoutMs?: number;
};

const TRACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Ortak, sınırlandırılmış Graph isteği. Hata yalnızca kapalı alanlarla (kod, alt kod, tür, izleme kimliği) döner. */
function createMetaRequester(config: MetaConfig, fetchImpl: typeof fetch) {
  return async function request(path: string, init: MetaRequestInit) {
    const url = new URL(`${config.graphBaseUrl}/${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
    let body: URLSearchParams | FormData | undefined;
    if (init.form) {
      body = new URLSearchParams(init.form);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (init.multipart) {
      body = init.multipart;
    }
    let response: Response;
    try {
      response = await fetchImpl(url, { method: init.method, headers, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS) });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      throw new MetaGraphError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "TRANSPORT");
    }
    const headerTrace = response.headers.get("x-fb-trace-id");
    const traceId = headerTrace && TRACE_ID.test(headerTrace) ? headerTrace : undefined;
    let json: unknown;
    try {
      json = await readLimitedJson(response);
    } catch (error) {
      // Gövde okunurken kopan bağlantı/zaman aşımı da belirsizdir; ham hata dışarı verilmez.
      if (error instanceof MetaGraphError) throw error;
      const name = (error as { name?: string } | null)?.name;
      throw new MetaGraphError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "TRANSPORT", { httpStatus: response.status, traceId });
    }
    const providerError = record(record(json).error);
    if (!response.ok || Object.keys(providerError).length > 0) {
      const bodyTrace = typeof providerError.fbtrace_id === "string" && TRACE_ID.test(providerError.fbtrace_id) ? providerError.fbtrace_id : undefined;
      throw new MetaGraphError("PROVIDER", {
        httpStatus: response.status,
        code: typeof providerError.code === "number" ? providerError.code : undefined,
        subcode: typeof providerError.error_subcode === "number" ? providerError.error_subcode : undefined,
        type: typeof providerError.type === "string" ? providerError.type.slice(0, 64) : undefined,
        isTransient: typeof providerError.is_transient === "boolean" ? providerError.is_transient : undefined,
        traceId: bodyTrace ?? traceId,
      });
    }
    return record(json);
  };
}

export function createMetaGraphClient(config: MetaConfig, fetchImpl: typeof fetch = fetch): MetaGraphClient {
  const appSecretProof = (token: string) => createHmac("sha256", config.appSecret).update(token).digest("hex");
  const request = createMetaRequester(config, fetchImpl);

  function parseUserToken(json: Record<string, unknown>): MetaUserToken {
    const accessToken = optionalString(json.access_token);
    if (!accessToken) throw new MetaGraphError("INVALID_RESPONSE");
    const expiresIn = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : null;
    return { accessToken, tokenType: optionalString(json.token_type), expiresInSeconds: expiresIn };
  }

  return {
    buildAuthorizeUrl(state, scopes, options = {}) {
      const url = new URL(config.dialogBaseUrl);
      url.searchParams.set("client_id", config.appId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scopes.join(","));
      // Yeniden bağlamada daha önce reddedilen izinlerin yeniden sorulması için.
      if (options.rerequest) url.searchParams.set("auth_type", "rerequest");
      return url.toString();
    },

    async exchangeCode(code) {
      return parseUserToken(await request("oauth/access_token", {
        method: "POST",
        form: { client_id: config.appId, client_secret: config.appSecret, redirect_uri: config.redirectUri, code },
      }));
    },

    async exchangeLongLivedUserToken(userToken) {
      return parseUserToken(await request("oauth/access_token", {
        method: "POST",
        form: { grant_type: "fb_exchange_token", client_id: config.appId, client_secret: config.appSecret, fb_exchange_token: userToken },
      }));
    },

    async debugToken(token) {
      const json = await request("debug_token", { method: "GET", query: { input_token: token }, bearer: `${config.appId}|${config.appSecret}` });
      const data = record(json.data);
      return {
        appId: optionalString(data.app_id),
        type: optionalString(data.type),
        isValid: data.is_valid === true,
        expiresAt: epochSeconds(data.expires_at),
        dataAccessExpiresAt: epochSeconds(data.data_access_expires_at),
        scopes: stringArray(data.scopes),
        userId: metaId(data.user_id),
        profileId: metaId(data.profile_id),
      };
    },

    async listPages(userToken) {
      const pages: MetaPage[] = [];
      let after: string | null = null;
      for (let requestCount = 0; requestCount < MAX_PAGE_LIST_REQUESTS; requestCount++) {
        const query: Record<string, string> = {
          fields: "id,name,access_token,tasks,instagram_business_account",
          limit: String(PAGE_LIST_LIMIT),
          appsecret_proof: appSecretProof(userToken),
        };
        if (after) query.after = after;
        const json = await request("me/accounts", { method: "GET", query, bearer: userToken });
        for (const raw of Array.isArray(json.data) ? json.data : []) {
          const page = record(raw);
          const id = metaId(page.id);
          if (!id) continue;
          pages.push({
            id,
            name: (optionalString(page.name) ?? id).slice(0, 200),
            accessToken: optionalString(page.access_token),
            tasks: stringArray(page.tasks),
            instagramBusinessAccountId: metaId(record(page.instagram_business_account).id),
          });
        }
        const paging = record(json.paging);
        const nextAfter = optionalString(record(paging.cursors).after);
        if (!optionalString(paging.next) || !nextAfter || nextAfter === after) return pages;
        after = nextAfter;
      }
      // Sınır aşıldıysa eksik liste "tam" sayılmaz.
      throw new MetaGraphError("INVALID_RESPONSE");
    },

    async getPage(pageId, pageToken) {
      const json = await request(assertMetaId(pageId), {
        method: "GET",
        query: { fields: "id,name,instagram_business_account", appsecret_proof: appSecretProof(pageToken) },
        bearer: pageToken,
      });
      const id = metaId(json.id);
      if (!id) throw new MetaGraphError("INVALID_RESPONSE");
      return { id, name: (optionalString(json.name) ?? id).slice(0, 200), instagramBusinessAccountId: metaId(record(json.instagram_business_account).id) };
    },

    async getInstagramAccount(instagramAccountId, pageToken) {
      const json = await request(assertMetaId(instagramAccountId), {
        method: "GET",
        query: { fields: "id,username", appsecret_proof: appSecretProof(pageToken) },
        bearer: pageToken,
      });
      const id = metaId(json.id);
      if (!id) throw new MetaGraphError("INVALID_RESPONSE");
      return { id, username: optionalString(json.username)?.slice(0, 100) ?? null };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// P6-03: yayınlama çağrıları (yalnızca Instagram tek JPEG ve Facebook Page metin/tek fotoğraf).
// Bu istemci sonuç yorumlamaz; kimlik biçimi yanlış/eksikse INVALID_RESPONSE fırlatır ve çağıran taraf
// yayın çağrısından sonra bunu belirsiz (UNKNOWN) sayar. Token yalnızca Authorization başlığındadır.

const PUBLISH_TIMEOUT_MS = 20_000;
const PHOTO_UPLOAD_TIMEOUT_MS = 45_000;
const FACEBOOK_POST_ID = /^\d{1,32}_\d{1,32}$/;

export type MetaContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED" | "UNRECOGNIZED";

export interface MetaPublishingGraphClient {
  getContentPublishingLimit(instagramAccountId: string, pageToken: string): Promise<{ usage: number; total: number } | null>;
  createImageContainer(instagramAccountId: string, input: { imageUrl: string; caption: string }, pageToken: string): Promise<{ containerId: string }>;
  getContainerStatus(containerId: string, pageToken: string): Promise<MetaContainerStatus>;
  publishContainer(instagramAccountId: string, containerId: string, pageToken: string): Promise<{ mediaId: string }>;
  createFeedPost(pageId: string, message: string, pageToken: string): Promise<{ postId: string }>;
  createPagePhoto(pageId: string, input: { bytes: Uint8Array; mimeType: string; caption: string }, pageToken: string): Promise<{ photoId: string | null; postId: string | null }>;
}

export function createMetaPublishingClient(config: MetaConfig, fetchImpl: typeof fetch = fetch): MetaPublishingGraphClient {
  const appSecretProof = (token: string) => createHmac("sha256", config.appSecret).update(token).digest("hex");
  const request = createMetaRequester(config, fetchImpl);

  return {
    async getContentPublishingLimit(instagramAccountId, pageToken) {
      const json = await request(`${assertMetaId(instagramAccountId)}/content_publishing_limit`, {
        method: "GET",
        query: { fields: "quota_usage,config", appsecret_proof: appSecretProof(pageToken) },
        bearer: pageToken,
      });
      const first = record(Array.isArray(json.data) ? json.data[0] : null);
      const usage = first.quota_usage;
      const total = record(first.config).quota_total;
      if (typeof usage !== "number" || typeof total !== "number") return null;
      return { usage, total };
    },

    async createImageContainer(instagramAccountId, input, pageToken) {
      const json = await request(`${assertMetaId(instagramAccountId)}/media`, {
        method: "POST",
        form: { image_url: input.imageUrl, caption: input.caption, appsecret_proof: appSecretProof(pageToken) },
        bearer: pageToken,
        timeoutMs: PUBLISH_TIMEOUT_MS,
      });
      const containerId = metaId(json.id);
      if (!containerId) throw new MetaGraphError("INVALID_RESPONSE");
      return { containerId };
    },

    async getContainerStatus(containerId, pageToken) {
      const json = await request(assertMetaId(containerId), {
        method: "GET",
        query: { fields: "status_code", appsecret_proof: appSecretProof(pageToken) },
        bearer: pageToken,
      });
      const status = optionalString(json.status_code);
      return status && ["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"].includes(status) ? (status as MetaContainerStatus) : "UNRECOGNIZED";
    },

    async publishContainer(instagramAccountId, containerId, pageToken) {
      const json = await request(`${assertMetaId(instagramAccountId)}/media_publish`, {
        method: "POST",
        form: { creation_id: assertMetaId(containerId), appsecret_proof: appSecretProof(pageToken) },
        bearer: pageToken,
        timeoutMs: PUBLISH_TIMEOUT_MS,
      });
      const mediaId = metaId(json.id);
      if (!mediaId) throw new MetaGraphError("INVALID_RESPONSE");
      return { mediaId };
    },

    async createFeedPost(pageId, message, pageToken) {
      const json = await request(`${assertMetaId(pageId)}/feed`, {
        method: "POST",
        form: { message, published: "true", appsecret_proof: appSecretProof(pageToken) },
        bearer: pageToken,
        timeoutMs: PUBLISH_TIMEOUT_MS,
      });
      const postId = optionalString(json.id);
      if (!postId || !FACEBOOK_POST_ID.test(postId)) throw new MetaGraphError("INVALID_RESPONSE");
      return { postId };
    },

    async createPagePhoto(pageId, input, pageToken) {
      const form = new FormData();
      form.set("source", new Blob([Buffer.from(input.bytes)], { type: input.mimeType }), input.mimeType === "image/png" ? "photo.png" : "photo.jpg");
      form.set("caption", input.caption);
      form.set("published", "true");
      form.set("appsecret_proof", appSecretProof(pageToken));
      const json = await request(`${assertMetaId(pageId)}/photos`, { method: "POST", multipart: form, bearer: pageToken, timeoutMs: PHOTO_UPLOAD_TIMEOUT_MS });
      const postIdRaw = optionalString(json.post_id);
      const postId = postIdRaw && FACEBOOK_POST_ID.test(postIdRaw) ? postIdRaw : null;
      const photoId = metaId(json.id);
      if (!postId && !photoId) throw new MetaGraphError("INVALID_RESPONSE");
      return { photoId, postId };
    },
  };
}
