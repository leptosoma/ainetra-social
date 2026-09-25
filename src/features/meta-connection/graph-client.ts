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
    public readonly details: { httpStatus?: number; code?: number; subcode?: number; type?: string } = {},
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

export function createMetaGraphClient(config: MetaConfig, fetchImpl: typeof fetch = fetch): MetaGraphClient {
  const appSecretProof = (token: string) => createHmac("sha256", config.appSecret).update(token).digest("hex");

  async function request(path: string, init: { method: "GET" | "POST"; query?: Record<string, string>; form?: Record<string, string>; bearer?: string }) {
    const url = new URL(`${config.graphBaseUrl}/${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
    let body: URLSearchParams | undefined;
    if (init.form) {
      body = new URLSearchParams(init.form);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    let response: Response;
    try {
      response = await fetchImpl(url, { method: init.method, headers, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      throw new MetaGraphError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "TRANSPORT");
    }
    const json = await readLimitedJson(response);
    const providerError = record(record(json).error);
    if (!response.ok || Object.keys(providerError).length > 0) {
      throw new MetaGraphError("PROVIDER", {
        httpStatus: response.status,
        code: typeof providerError.code === "number" ? providerError.code : undefined,
        subcode: typeof providerError.error_subcode === "number" ? providerError.error_subcode : undefined,
        type: typeof providerError.type === "string" ? providerError.type.slice(0, 64) : undefined,
      });
    }
    return record(json);
  }

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
