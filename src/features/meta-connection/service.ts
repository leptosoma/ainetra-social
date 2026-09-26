import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma, type SocialPlatform } from "../../../generated/prisma/client";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import type { AccountConnection, CredentialHandle } from "@/features/publishing/adapter";
import {
  META_ELIGIBLE_PAGE_TASKS,
  META_OAUTH_ATTEMPT_TTL_MS,
  META_PUBLISH_PAGE_TASKS,
  META_PUBLISH_SCOPES,
  META_REQUIRED_SCOPES,
  META_SELECTION_TTL_MS,
  loadMetaConfig,
  type MetaConfig,
} from "./config";
import { credentialAad, decryptCredential, encryptCredential, loadCredentialKeyring, type CredentialKeyring } from "./crypto";
import { MetaGraphError, createMetaGraphClient, type MetaGraphClient, type MetaTokenDebug } from "./graph-client";
import { META_FAILURE_MESSAGES, type MetaAccountConnectionState, type MetaFailureCode, type MetaIneligibilityReason } from "./labels";

// P6-02: Meta hesap bağlantısı (Facebook Login + Instagram API with Facebook Login). Bu modül yayın yapmaz,
// publish intent oluşturmaz ve PublishingAdapter.submit çağırmaz. Token'lar yalnızca sunucuda, şifreli olarak
// saklanır; tarayıcıya yalnızca temizlenmiş etiketler ve tek kullanımlık rastgele tutamaçlar gider.

export type MetaSessionContext = { userId: string; sessionId: string };

export type MetaDeps = {
  config: MetaConfig | null;
  keyring: CredentialKeyring | null;
  graph: MetaGraphClient | null;
  now: () => Date;
};

function resolveDeps(overrides: Partial<MetaDeps> = {}): MetaDeps {
  const config = overrides.config !== undefined ? overrides.config : loadMetaConfig();
  return {
    config,
    keyring: overrides.keyring !== undefined ? overrides.keyring : loadCredentialKeyring(),
    graph: overrides.graph !== undefined ? overrides.graph : config ? createMetaGraphClient(config) : null,
    now: overrides.now ?? (() => new Date()),
  };
}

const START_LIMIT_PER_HOUR = 10;
const maxConflictRetries = 3;

class MetaFlowError extends Error {
  constructor(public readonly failureCode: MetaFailureCode, public readonly reason?: string) {
    super(META_FAILURE_MESSAGES[failureCode]);
    this.name = "MetaFlowError";
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomHandle() {
  return randomBytes(32).toString("base64url");
}

/** Kapalı, redakte edilmiş denetim nedeni; ham sağlayıcı metni asla yazılmaz. */
function sanitizedReason(error: unknown): string {
  if (error instanceof MetaFlowError) return error.reason ?? error.failureCode;
  if (error instanceof MetaGraphError) return `META_${error.kind}${error.details.code !== undefined ? `_${error.details.code}` : ""}`;
  if (error instanceof DomainError) return error.code;
  return "INTERNAL_ERROR";
}

function failureFor(error: unknown, fallback: MetaFailureCode): MetaFailureCode {
  if (error instanceof MetaFlowError) return error.failureCode;
  if (error instanceof MetaGraphError) {
    if (error.kind === "TIMEOUT" || error.kind === "TRANSPORT") return "PROVIDER_UNAVAILABLE";
    if (error.isInvalidToken) return "TOKEN_INVALID";
  }
  return fallback;
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

async function requireOwner(userId: string, businessId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const membership = await client.membership.findUnique({ where: { userId_businessId: { userId, businessId } } });
  if (!membership) throw new DomainError("Bu işletme için yetkiniz yok.", "FORBIDDEN");
  if (membership.role !== "OWNER") throw new DomainError(META_FAILURE_MESSAGES.FORBIDDEN, "FORBIDDEN");
  return membership;
}

function missingScopes(granted: readonly string[]) {
  return META_REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
}

function hasEligibleTasks(tasks: readonly string[]) {
  return tasks.some((task) => (META_ELIGIBLE_PAGE_TASKS as readonly string[]).includes(task));
}

async function audit(
  client: Prisma.TransactionClient | typeof prisma,
  data: { businessId: string; action: Prisma.MetaConnectionAuditCreateManyInput["action"]; result: string; reason?: string | null; socialAccountId?: string | null; attemptId?: string | null; actorUserId?: string | null },
) {
  await client.metaConnectionAudit.create({ data: { ...data, reason: data.reason?.slice(0, 200) ?? null } });
}

const PURGED_PENDING = {
  pendingCiphertext: null,
  pendingNonce: null,
  pendingAuthTag: null,
  pendingKeyId: null,
  selectionHandleHash: null,
} satisfies Prisma.MetaOAuthAttemptUpdateManyMutationInput;

/** Başarısız deneme: bekleyen şifreli sırlar ve seçim tutamacı silinir; yeniden deneme yeni deneme başlatır. */
async function failAttempt(attempt: { id: string; businessId: string; userId: string }, failureCode: MetaFailureCode, reason: string, action: "CALLBACK_FAILED" | "SELECTION_FAILED", now: Date) {
  await prisma.$transaction([
    prisma.metaOAuthAttempt.update({
      where: { id: attempt.id },
      data: { ...PURGED_PENDING, candidates: prismaJsonNull(), status: "FAILED", failedAt: now, failureCode },
    }),
    prisma.metaConnectionAudit.create({ data: { businessId: attempt.businessId, attemptId: attempt.id, actorUserId: attempt.userId, action, result: failureCode, reason: reason.slice(0, 200) } }),
  ]);
}

function prismaJsonNull() {
  return Prisma.DbNull;
}

/** Süresi dolmuş bekleyen denemelerin sırlarını temizler (seçim yapılmadan bırakılan akışlar). */
export async function purgeExpiredMetaAttempts(now = new Date()) {
  const expired = await prisma.metaOAuthAttempt.updateMany({
    where: {
      OR: [
        { status: "PENDING", expiresAt: { lte: now } },
        { status: "AWAITING_SELECTION", selectionExpiresAt: { lte: now } },
      ],
    },
    data: { ...PURGED_PENDING, candidates: prismaJsonNull(), status: "FAILED", failedAt: now, failureCode: "STATE_EXPIRED" },
  });
  return expired.count;
}

// ---------------------------------------------------------------------------------------------------------
// Başlatma

export async function startMetaConnection(ctx: MetaSessionContext, businessId: string, options: { reconnectSocialAccountId?: string | null; requestPublishing?: boolean } = {}, overrides: Partial<MetaDeps> = {}) {
  const deps = resolveDeps(overrides);
  await requireOwner(ctx.userId, businessId);
  if (!deps.config || !deps.graph || !deps.keyring) throw new DomainError(META_FAILURE_MESSAGES.NOT_CONFIGURED, "VALIDATION_ERROR");
  const session = await prisma.session.findUnique({ where: { id: ctx.sessionId } });
  if (!session || session.userId !== ctx.userId || session.expiresAt <= deps.now()) throw new DomainError("Oturum geçersiz.", "UNAUTHORIZED");

  let reconnectSocialAccountId: string | null = null;
  let publishScopes: readonly string[] = [];
  if (options.requestPublishing && !options.reconnectSocialAccountId) throw new DomainError("Yayın izni yalnızca bağlı bir hesap için istenebilir.", "VALIDATION_ERROR");
  if (options.reconnectSocialAccountId) {
    const target = await prisma.socialAccount.findUnique({ where: { id: options.reconnectSocialAccountId }, include: { metaConnection: true } });
    if (!target || target.businessId !== businessId) throw new DomainError("Sosyal hesap bulunamadı.", "NOT_FOUND");
    if (!target.metaConnection) throw new DomainError("Bu hesap daha önce Meta üzerinden bağlanmamış.", "VALIDATION_ERROR");
    reconnectSocialAccountId = target.id;
    // P6-03: yayın izni yalnızca sahibin açık isteğiyle ve yalnızca hedef platformun izniyle eklenir.
    if (options.requestPublishing) {
      if (target.platform !== "INSTAGRAM" && target.platform !== "FACEBOOK") throw new DomainError("Bu platform için yayınlama desteklenmiyor.", "VALIDATION_ERROR");
      publishScopes = META_PUBLISH_SCOPES[target.platform];
    }
  }

  const now = deps.now();
  await purgeExpiredMetaAttempts(now);
  const recent = await prisma.metaOAuthAttempt.count({ where: { businessId, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } } });
  if (recent >= START_LIMIT_PER_HOUR) throw new DomainError(META_FAILURE_MESSAGES.RATE_LIMITED, "VALIDATION_ERROR");

  const state = randomHandle();
  const attempt = await prisma.metaOAuthAttempt.create({
    data: {
      businessId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      stateHash: sha256(state),
      reconnectSocialAccountId,
      expiresAt: new Date(now.getTime() + META_OAUTH_ATTEMPT_TTL_MS),
    },
  });
  await audit(prisma, { businessId, attemptId: attempt.id, actorUserId: ctx.userId, action: "CONNECT_STARTED", result: publishScopes.length ? "PUBLISH_AUTHORIZATION" : reconnectSocialAccountId ? "RECONNECT" : "CONNECT", socialAccountId: reconnectSocialAccountId });
  return { attemptId: attempt.id, authorizeUrl: deps.graph.buildAuthorizeUrl(state, [...META_REQUIRED_SCOPES, ...publishScopes], { rerequest: Boolean(reconnectSocialAccountId) }) };
}

// ---------------------------------------------------------------------------------------------------------
// Callback ve keşif

type StoredCandidate = {
  key: string;
  pageId: string;
  pageName: string;
  tasks: string[];
  facebook: { eligible: boolean; reason: MetaIneligibilityReason | null };
  instagram: { id: string; username: string | null; eligible: boolean; reason: MetaIneligibilityReason | null } | null;
};

type PendingSecrets = { pageTokens: Record<string, string> };

export type MetaCallbackResult = { kind: "SELECT"; selectionHandle: string; expiresAt: Date } | { kind: "ERROR"; code: MetaFailureCode };

export async function handleMetaCallback(
  ctx: MetaSessionContext | null,
  params: { state?: string | null; code?: string | null; error?: string | null },
  overrides: Partial<MetaDeps> = {},
): Promise<MetaCallbackResult> {
  const deps = resolveDeps(overrides);
  const now = deps.now();
  if (!params.state || params.state.length > 200) return { kind: "ERROR", code: "INVALID_STATE" };
  const attempt = await prisma.metaOAuthAttempt.findUnique({ where: { stateHash: sha256(params.state) } });
  if (!attempt) return { kind: "ERROR", code: "INVALID_STATE" };

  // Kod değişiminden önce: aynı kullanıcı + aynı canlı oturum, tek kullanımlık ve süresi dolmamış state.
  if (!ctx || ctx.userId !== attempt.userId || ctx.sessionId !== attempt.sessionId) {
    await audit(prisma, { businessId: attempt.businessId, attemptId: attempt.id, actorUserId: ctx?.userId ?? null, action: "CALLBACK_FAILED", result: "SESSION_MISMATCH" });
    return { kind: "ERROR", code: "SESSION_MISMATCH" };
  }
  if (attempt.status !== "PENDING" || attempt.consumedAt) return { kind: "ERROR", code: "INVALID_STATE" };
  if (attempt.expiresAt <= now) {
    await failAttempt(attempt, "STATE_EXPIRED", "STATE_EXPIRED", "CALLBACK_FAILED", now);
    return { kind: "ERROR", code: "STATE_EXPIRED" };
  }
  const consumed = await prisma.metaOAuthAttempt.updateMany({
    where: { id: attempt.id, status: "PENDING", consumedAt: null, expiresAt: { gt: now } },
    data: { status: "PROCESSING", consumedAt: now },
  });
  if (consumed.count !== 1) return { kind: "ERROR", code: "INVALID_STATE" };

  try {
    await requireOwner(attempt.userId, attempt.businessId).catch(() => {
      throw new MetaFlowError("FORBIDDEN");
    });
    if (params.error || !params.code) throw new MetaFlowError("PROVIDER_DENIED");
    if (params.code.length > 2048) throw new MetaFlowError("TOKEN_EXCHANGE_FAILED", "CODE_TOO_LONG");
    if (!deps.config || !deps.graph || !deps.keyring) throw new MetaFlowError("NOT_CONFIGURED");
    const { config, graph, keyring } = deps;

    let userToken: string;
    try {
      const shortLived = await graph.exchangeCode(params.code);
      userToken = (await graph.exchangeLongLivedUserToken(shortLived.accessToken)).accessToken;
    } catch (error) {
      if (error instanceof MetaGraphError && (error.kind === "TIMEOUT" || error.kind === "TRANSPORT")) throw error;
      throw new MetaFlowError("TOKEN_EXCHANGE_FAILED", sanitizedReason(error));
    }
    const debug = await graph.debugToken(userToken);
    if (!debug.isValid || debug.appId !== config.appId || debug.type !== "USER") throw new MetaFlowError("TOKEN_INVALID", "USER_TOKEN_REJECTED");
    const missing = missingScopes(debug.scopes);
    if (missing.length) throw new MetaFlowError("MISSING_PERMISSIONS", `MISSING:${missing.join(",")}`);

    const pages = await graph.listPages(userToken);
    if (pages.length === 0) throw new MetaFlowError("NO_PAGES");

    const candidates: StoredCandidate[] = [];
    const pageTokens: Record<string, string> = {};
    for (const [index, page] of pages.entries()) {
      const tasksOk = hasEligibleTasks(page.tasks);
      const assetReason: MetaIneligibilityReason | null = !page.accessToken ? "NO_PAGE_CREDENTIAL" : !tasksOk ? "MISSING_PAGE_TASKS" : null;
      if (page.accessToken && tasksOk) pageTokens[page.id] = page.accessToken;
      let instagram: StoredCandidate["instagram"] = null;
      if (page.instagramBusinessAccountId) {
        instagram = { id: page.instagramBusinessAccountId, username: null, eligible: false, reason: assetReason ?? "INSTAGRAM_UNAVAILABLE" };
        if (!assetReason && page.accessToken) {
          try {
            const account = await graph.getInstagramAccount(page.instagramBusinessAccountId, page.accessToken);
            if (account.id === page.instagramBusinessAccountId) instagram = { ...instagram, username: account.username, eligible: true, reason: null };
          } catch (error) {
            // Belirsiz ağ hatası eksik bir liste üretmez; tüm keşif başarısız sayılır.
            if (!(error instanceof MetaGraphError) || error.kind !== "PROVIDER") throw error;
          }
        }
      }
      candidates.push({ key: `a${index}`, pageId: page.id, pageName: page.name, tasks: page.tasks, facebook: { eligible: !assetReason, reason: assetReason }, instagram });
    }
    if (!candidates.some((candidate) => candidate.facebook.eligible || candidate.instagram?.eligible)) throw new MetaFlowError("NO_ELIGIBLE_ASSETS");

    if (attempt.reconnectSocialAccountId) {
      const target = await prisma.metaConnection.findUnique({ where: { socialAccountId: attempt.reconnectSocialAccountId } });
      const available = target && candidates.some((candidate) =>
        target.platform === "FACEBOOK"
          ? candidate.pageId === target.providerAccountId && candidate.facebook.eligible
          : candidate.instagram?.id === target.providerAccountId && candidate.instagram.eligible,
      );
      if (!available) throw new MetaFlowError("RECONNECT_ASSET_UNAVAILABLE");
    }

    const secrets: PendingSecrets = { pageTokens };
    const encrypted = encryptCredential(keyring, JSON.stringify(secrets), credentialAad({ purpose: "pending", businessId: attempt.businessId, subjectId: attempt.id }));
    const selectionHandle = randomHandle();
    const selectionExpiresAt = new Date(now.getTime() + META_SELECTION_TTL_MS);
    const updated = await prisma.metaOAuthAttempt.updateMany({
      where: { id: attempt.id, status: "PROCESSING" },
      data: {
        status: "AWAITING_SELECTION",
        candidates: candidates as unknown as Prisma.InputJsonValue,
        grantedScopes: debug.scopes.slice(0, 50),
        pendingCiphertext: encrypted.ciphertext,
        pendingNonce: encrypted.nonce,
        pendingAuthTag: encrypted.authTag,
        pendingKeyId: encrypted.keyId,
        selectionHandleHash: sha256(selectionHandle),
        selectionExpiresAt,
      },
    });
    if (updated.count !== 1) throw new MetaFlowError("INVALID_STATE", "ATTEMPT_CHANGED");
    await audit(prisma, { businessId: attempt.businessId, attemptId: attempt.id, actorUserId: attempt.userId, action: "ASSETS_DISCOVERED", result: "OK", reason: `PAGES:${pages.length}` });
    return { kind: "SELECT", selectionHandle, expiresAt: selectionExpiresAt };
  } catch (error) {
    const code = failureFor(error, "TOKEN_EXCHANGE_FAILED");
    await failAttempt(attempt, code, sanitizedReason(error), "CALLBACK_FAILED", now);
    return { kind: "ERROR", code };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Seçim

export type MetaSelectionOption = {
  key: string;
  pageName: string;
  facebook: { eligible: boolean; reason: MetaIneligibilityReason | null };
  instagram: { username: string | null; eligible: boolean; reason: MetaIneligibilityReason | null } | null;
  reconnectPlatform: "FACEBOOK" | "INSTAGRAM" | null;
};

async function findSelectableAttempt(ctx: MetaSessionContext, selectionHandle: string, now: Date) {
  if (!selectionHandle || selectionHandle.length > 200) return null;
  const attempt = await prisma.metaOAuthAttempt.findUnique({ where: { selectionHandleHash: sha256(selectionHandle) }, include: { reconnectSocialAccount: { include: { metaConnection: true } } } });
  if (!attempt || attempt.userId !== ctx.userId || attempt.sessionId !== ctx.sessionId || attempt.status !== "AWAITING_SELECTION") return null;
  if (!attempt.selectionExpiresAt || attempt.selectionExpiresAt <= now) {
    await failAttempt(attempt, "SELECTION_EXPIRED", "SELECTION_EXPIRED", "SELECTION_FAILED", now);
    return null;
  }
  return attempt;
}

function storedCandidates(value: Prisma.JsonValue | null): StoredCandidate[] {
  return Array.isArray(value) ? (value as unknown as StoredCandidate[]) : [];
}

function isReconnectCandidate(candidate: StoredCandidate, target: { platform: SocialPlatform; providerAccountId: string } | null | undefined, platform: SocialPlatform) {
  if (!target || target.platform !== platform) return false;
  return platform === "FACEBOOK" ? candidate.pageId === target.providerAccountId : candidate.instagram?.id === target.providerAccountId;
}

/** Seçim ekranı için yalnızca temizlenmiş etiketler; token, sağlayıcı kimliği veya görev listesi dönmez. */
export async function getMetaSelection(ctx: MetaSessionContext, selectionHandle: string, overrides: Partial<Pick<MetaDeps, "now">> = {}) {
  const now = (overrides.now ?? (() => new Date()))();
  const attempt = await findSelectableAttempt(ctx, selectionHandle, now);
  if (!attempt) return null;
  await requireOwner(ctx.userId, attempt.businessId);
  const target = attempt.reconnectSocialAccount?.metaConnection;
  const options: MetaSelectionOption[] = storedCandidates(attempt.candidates).map((candidate) => ({
    key: candidate.key,
    pageName: candidate.pageName,
    facebook: candidate.facebook,
    instagram: candidate.instagram ? { username: candidate.instagram.username, eligible: candidate.instagram.eligible, reason: candidate.instagram.reason } : null,
    reconnectPlatform: isReconnectCandidate(candidate, target, "FACEBOOK") ? "FACEBOOK" : isReconnectCandidate(candidate, target, "INSTAGRAM") ? "INSTAGRAM" : null,
  }));
  return { businessId: attempt.businessId, reconnect: Boolean(target), expiresAt: attempt.selectionExpiresAt, options };
}

const choiceSchema = z.array(z.string().regex(/^a\d{1,4}:(FACEBOOK|INSTAGRAM)$/)).min(1).max(100);

type ValidatedAsset = {
  platform: "FACEBOOK" | "INSTAGRAM";
  providerAccountId: string;
  pageId: string;
  pageName: string;
  instagramAccountId: string | null;
  instagramUsername: string | null;
  tasks: string[];
  pageToken: string;
  tokenDebug: MetaTokenDebug;
};

export type MetaSelectionResult = { connected: Array<{ socialAccountId: string; platform: "FACEBOOK" | "INSTAGRAM"; displayName: string; reconnected: boolean }> };

/**
 * Seçilen varlıkları tek kullanımlık seçim tutamacıyla doğrular ve hepsini ya da hiçbirini bağlar.
 * Sağlayıcı doğrulaması başarısızsa, tarayıcıdan gelen seçim keşfedilen kümede değilse ya da varlık başka
 * bir işletmede canlı bağlıysa hiçbir hesap CONNECTED olmaz.
 */
export async function completeMetaSelection(ctx: MetaSessionContext, selectionHandle: string, rawChoices: unknown, overrides: Partial<MetaDeps> = {}): Promise<MetaSelectionResult> {
  const deps = resolveDeps(overrides);
  const now = deps.now();
  const parsed = choiceSchema.safeParse(rawChoices);
  if (!parsed.success) throw new DomainError("Bağlamak için en az bir hesap seçin.", "VALIDATION_ERROR");
  const choices = [...new Set(parsed.data)];

  const attempt = await findSelectableAttempt(ctx, selectionHandle, now);
  if (!attempt) throw new DomainError(META_FAILURE_MESSAGES.SELECTION_EXPIRED, "CONFLICT");
  const fail = async (code: MetaFailureCode, error?: unknown): Promise<never> => {
    await failAttempt(attempt, code, error ? sanitizedReason(error) : code, "SELECTION_FAILED", now);
    throw new DomainError(META_FAILURE_MESSAGES[code], code === "ASSET_OWNED_BY_OTHER_BUSINESS" ? "CONFLICT" : code === "FORBIDDEN" ? "FORBIDDEN" : "PROVIDER_FAILED");
  };
  try {
    await requireOwner(ctx.userId, attempt.businessId);
  } catch (error) {
    return fail("FORBIDDEN", error);
  }

  const candidates = storedCandidates(attempt.candidates);
  const selected: Array<{ candidate: StoredCandidate; platform: "FACEBOOK" | "INSTAGRAM" }> = [];
  for (const choice of choices) {
    const [key, platform] = choice.split(":") as [string, "FACEBOOK" | "INSTAGRAM"];
    const candidate = candidates.find((item) => item.key === key);
    const eligible = platform === "FACEBOOK" ? candidate?.facebook.eligible : candidate?.instagram?.eligible;
    if (!candidate || !eligible) return fail("SELECTION_INVALID");
    selected.push({ candidate, platform });
  }
  const target = attempt.reconnectSocialAccount?.metaConnection;
  if (target && !selected.some(({ candidate, platform }) => isReconnectCandidate(candidate, target, platform))) return fail("SELECTION_INVALID", new MetaFlowError("SELECTION_INVALID", "RECONNECT_TARGET_NOT_SELECTED"));

  // Tutamacı atomik olarak tüket: eşzamanlı iki seçim aynı denemeyi işleyemez.
  const consumed = await prisma.metaOAuthAttempt.updateMany({
    where: { id: attempt.id, status: "AWAITING_SELECTION", selectionHandleHash: sha256(selectionHandle), selectionExpiresAt: { gt: now } },
    data: { status: "SELECTING" },
  });
  if (consumed.count !== 1) throw new DomainError(META_FAILURE_MESSAGES.SELECTION_EXPIRED, "CONFLICT");

  if (!deps.config || !deps.graph || !deps.keyring) return fail("NOT_CONFIGURED");
  const { config, graph, keyring } = deps;
  let secrets: PendingSecrets;
  try {
    if (!attempt.pendingCiphertext || !attempt.pendingNonce || !attempt.pendingAuthTag || !attempt.pendingKeyId) throw new MetaFlowError("SELECTION_EXPIRED");
    secrets = JSON.parse(decryptCredential(keyring, { ciphertext: attempt.pendingCiphertext, nonce: attempt.pendingNonce, authTag: attempt.pendingAuthTag, keyId: attempt.pendingKeyId }, credentialAad({ purpose: "pending", businessId: attempt.businessId, subjectId: attempt.id }))) as PendingSecrets;
  } catch (error) {
    return fail("SELECTION_EXPIRED", error);
  }

  // Seçim anında sağlayıcıyla yeniden doğrulama: Page token geçerli, bu uygulamaya ait, bu Page'e ait ve
  // gerekli izinlere sahip olmalı; Page ve bağlı IG kimliği keşifle eşleşmeli.
  const assets: ValidatedAsset[] = [];
  const pageChecks = new Map<string, { debug: MetaTokenDebug; instagramId: string | null }>();
  try {
    for (const { candidate, platform } of selected) {
      const pageToken = secrets.pageTokens?.[candidate.pageId];
      if (!pageToken) throw new MetaFlowError("ASSET_VALIDATION_FAILED", "NO_PAGE_CREDENTIAL");
      let check = pageChecks.get(candidate.pageId);
      if (!check) {
        const debug = await graph.debugToken(pageToken);
        if (!debug.isValid || debug.appId !== config.appId || debug.type !== "PAGE" || debug.profileId !== candidate.pageId) throw new MetaFlowError("ASSET_VALIDATION_FAILED", "PAGE_TOKEN_REJECTED");
        const missing = missingScopes(debug.scopes);
        if (missing.length) throw new MetaFlowError("MISSING_PERMISSIONS", `MISSING:${missing.join(",")}`);
        const page = await graph.getPage(candidate.pageId, pageToken);
        if (page.id !== candidate.pageId) throw new MetaFlowError("ASSET_VALIDATION_FAILED", "PAGE_MISMATCH");
        check = { debug, instagramId: page.instagramBusinessAccountId };
        pageChecks.set(candidate.pageId, check);
      }
      let instagramUsername: string | null = null;
      if (platform === "INSTAGRAM") {
        const instagramId = candidate.instagram?.id;
        if (!instagramId || check.instagramId !== instagramId) throw new MetaFlowError("ASSET_VALIDATION_FAILED", "INSTAGRAM_LINK_CHANGED");
        const account = await graph.getInstagramAccount(instagramId, pageToken);
        if (account.id !== instagramId) throw new MetaFlowError("ASSET_VALIDATION_FAILED", "INSTAGRAM_MISMATCH");
        instagramUsername = account.username;
      }
      assets.push({
        platform,
        providerAccountId: platform === "FACEBOOK" ? candidate.pageId : candidate.instagram!.id,
        pageId: candidate.pageId,
        pageName: candidate.pageName,
        instagramAccountId: candidate.instagram?.eligible ? candidate.instagram.id : null,
        instagramUsername: instagramUsername ?? candidate.instagram?.username ?? null,
        tasks: candidate.tasks,
        pageToken,
        tokenDebug: check.debug,
      });
    }
  } catch (error) {
    const code = failureFor(error, "ASSET_VALIDATION_FAILED");
    return fail(code === "TOKEN_INVALID" ? "ASSET_VALIDATION_FAILED" : code, error);
  }

  try {
    return await withConflictRetry(() => persistSelection(attempt, assets, keyring, now));
  } catch (error) {
    if (error instanceof MetaFlowError) return fail(error.failureCode, error);
    return fail("ASSET_VALIDATION_FAILED", error);
  }
}

async function persistSelection(
  attempt: { id: string; businessId: string; userId: string; grantedScopes: string[]; reconnectSocialAccountId: string | null },
  assets: ValidatedAsset[],
  keyring: CredentialKeyring,
  now: Date,
): Promise<MetaSelectionResult> {
  return prisma.$transaction(async (tx) => {
    await requireOwner(attempt.userId, attempt.businessId, tx);
    const fresh = await tx.metaOAuthAttempt.findUnique({ where: { id: attempt.id } });
    if (!fresh || fresh.status !== "SELECTING") throw new MetaFlowError("SELECTION_EXPIRED", "ATTEMPT_CHANGED");

    const connected: MetaSelectionResult["connected"] = [];
    for (const asset of assets) {
      // Canlı bir eşleme başka işletmedeyse tarayıcı girdisiyle yeniden atanmaz.
      const foreign = await tx.metaConnection.findFirst({ where: { platform: asset.platform, providerAccountId: asset.providerAccountId, credentialRef: { not: null }, businessId: { not: attempt.businessId } } });
      if (foreign) throw new MetaFlowError("ASSET_OWNED_BY_OTHER_BUSINESS");

      const displayName = asset.platform === "INSTAGRAM" && asset.instagramUsername ? `@${asset.instagramUsername}` : asset.pageName;
      let account = await tx.socialAccount.findFirst({ where: { businessId: attempt.businessId, platform: asset.platform, externalAccountId: asset.providerAccountId } });
      account = account
        ? await tx.socialAccount.update({ where: { id: account.id }, data: { displayName, status: "CONNECTED" } })
        : await tx.socialAccount.create({ data: { businessId: attempt.businessId, platform: asset.platform, externalAccountId: asset.providerAccountId, displayName, status: "CONNECTED" } });

      const existing = await tx.metaConnection.findUnique({ where: { socialAccountId: account.id } });
      const encrypted = encryptCredential(keyring, asset.pageToken, credentialAad({ purpose: "connection", businessId: attempt.businessId, subjectId: account.id, platform: asset.platform, providerAccountId: asset.providerAccountId }));
      const data = {
        businessId: attempt.businessId,
        platform: asset.platform,
        providerAccountId: asset.providerAccountId,
        metaPageId: asset.pageId,
        instagramAccountId: asset.instagramAccountId,
        pageName: asset.pageName,
        instagramUsername: asset.instagramUsername,
        grantedScopes: asset.tokenDebug.scopes.slice(0, 50),
        pageTasks: asset.tasks.slice(0, 20),
        tokenType: "PAGE",
        credentialRef: `mcred_${randomBytes(18).toString("base64url")}`,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        keyId: encrypted.keyId,
        tokenExpiresAt: asset.tokenDebug.expiresAt,
        dataAccessExpiresAt: asset.tokenDebug.dataAccessExpiresAt,
        connectedAt: now,
        lastValidatedAt: now,
        reauthRequiredAt: null,
        reauthReason: null,
        disconnectedAt: null,
        providerRevocation: null,
        connectedByUserId: attempt.userId,
      };
      if (existing) await tx.metaConnection.update({ where: { id: existing.id }, data });
      else await tx.metaConnection.create({ data: { ...data, socialAccountId: account.id } });
      const reconnected = Boolean(existing);
      await audit(tx, { businessId: attempt.businessId, socialAccountId: account.id, attemptId: attempt.id, actorUserId: attempt.userId, action: reconnected ? "RECONNECTED" : "CONNECTED", result: "OK", reason: `${asset.platform}` });
      connected.push({ socialAccountId: account.id, platform: asset.platform, displayName, reconnected });
    }

    await tx.metaOAuthAttempt.update({ where: { id: attempt.id }, data: { ...PURGED_PENDING, candidates: prismaJsonNull(), status: "COMPLETED", completedAt: now } });
    return { connected };
  }, { isolationLevel: "Serializable" });
}

/** Kullanıcı seçimi iptal ederse bekleyen şifreli sırlar hemen silinir. */
export async function cancelMetaSelection(ctx: MetaSessionContext, selectionHandle: string, overrides: Partial<Pick<MetaDeps, "now">> = {}) {
  const now = (overrides.now ?? (() => new Date()))();
  const attempt = await findSelectableAttempt(ctx, selectionHandle, now);
  if (attempt) await failAttempt(attempt, "PROVIDER_DENIED", "USER_CANCELLED", "SELECTION_FAILED", now);
}

/** Eylem hatalarını ayarlar ekranı için kapalı bir koda çevirir; serbest metin URL'ye yazılmaz. */
export function metaFailureCodeForError(error: unknown): MetaFailureCode {
  if (error instanceof DomainError) {
    const byMessage = (Object.entries(META_FAILURE_MESSAGES) as Array<[MetaFailureCode, string]>).find(([, message]) => message === error.message);
    if (byMessage) return byMessage[0];
    if (error.code === "FORBIDDEN") return "FORBIDDEN";
    if (error.code === "PROVIDER_FAILED") return "PROVIDER_UNAVAILABLE";
  }
  return "ACTION_FAILED";
}

// ---------------------------------------------------------------------------------------------------------
// Bağlantı kesme, doğrulama ve yeniden yetkilendirme

const CLEARED_CREDENTIAL = { credentialRef: null, ciphertext: null, nonce: null, authTag: null, keyId: null } as const;

async function loadOwnedConnection(userId: string, socialAccountId: string) {
  const account = await prisma.socialAccount.findUnique({ where: { id: socialAccountId }, include: { metaConnection: true } });
  if (!account) throw new DomainError("Sosyal hesap bulunamadı.", "NOT_FOUND");
  await requireOwner(userId, account.businessId);
  if (!account.metaConnection) throw new DomainError("Bu hesap Meta üzerinden bağlanmamış.", "VALIDATION_ERROR");
  return { account, connection: account.metaConnection };
}

/**
 * Açık, yetkili bağlantı kesme: yerel kullanılabilir kimlik bilgisi silinir ve hesap gönderilemez olur.
 * Meta tarafında Page token'ı tek başına iptal edecek bir uç nokta kullanılmaz; uygulama düzeyinde izin
 * iptali aynı Meta kullanıcısının diğer bağlantılarını da etkileyeceğinden istenmez. Bu nedenle sağlayıcı
 * iptali "NOT_REQUESTED" olarak kaydedilir ve onaylanmış gibi gösterilmez. Planlı gönderi/niyet geçmişi korunur.
 */
export async function disconnectMetaAccount(userId: string, socialAccountId: string, overrides: Partial<Pick<MetaDeps, "now">> = {}) {
  const now = (overrides.now ?? (() => new Date()))();
  const { account } = await loadOwnedConnection(userId, socialAccountId);
  return prisma.$transaction(async (tx) => {
    await requireOwner(userId, account.businessId, tx);
    const connection = await tx.metaConnection.update({ where: { socialAccountId: account.id }, data: { ...CLEARED_CREDENTIAL, disconnectedAt: now, providerRevocation: "NOT_REQUESTED" } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { status: "DISCONNECTED" } });
    await audit(tx, { businessId: account.businessId, socialAccountId: account.id, actorUserId: userId, action: "DISCONNECTED", result: "LOCAL_CREDENTIAL_REMOVED", reason: "PROVIDER_REVOCATION_NOT_REQUESTED" });
    return connection;
  }, { isolationLevel: "Serializable" });
}

async function markReauthRequired(socialAccountId: string, businessId: string, reason: string, actorUserId: string | null, now: Date) {
  await prisma.$transaction([
    prisma.metaConnection.update({ where: { socialAccountId }, data: { ...CLEARED_CREDENTIAL, reauthRequiredAt: now, reauthReason: reason.slice(0, 100) } }),
    prisma.socialAccount.update({ where: { id: socialAccountId }, data: { status: "DISCONNECTED" } }),
    prisma.metaConnectionAudit.create({ data: { businessId, socialAccountId, actorUserId, action: "REAUTH_REQUIRED", result: "CREDENTIAL_UNUSABLE", reason: reason.slice(0, 200) } }),
  ]);
}

function decryptConnectionToken(keyring: CredentialKeyring, connection: { businessId: string; socialAccountId: string; platform: SocialPlatform; providerAccountId: string; ciphertext: Uint8Array | null; nonce: Uint8Array | null; authTag: Uint8Array | null; keyId: string | null }) {
  if (!connection.ciphertext || !connection.nonce || !connection.authTag || !connection.keyId) throw new DomainError("Kullanılabilir kimlik bilgisi yok.", "VALIDATION_ERROR");
  return decryptCredential(
    keyring,
    { ciphertext: connection.ciphertext, nonce: connection.nonce, authTag: connection.authTag, keyId: connection.keyId },
    credentialAad({ purpose: "connection", businessId: connection.businessId, subjectId: connection.socialAccountId, platform: connection.platform, providerAccountId: connection.providerAccountId }),
  );
}

/**
 * Saklanan kimlik bilgisini Meta ile yeniden doğrular. İptal/süre dolumu/eksik izin açıkça "yeniden yetki
 * gerekli" durumuna geçer ve kimlik bilgisi silinir. Ağ belirsizliği durumu değiştirmez ama doğrulama
 * zamanını da ilerletmez (bağlantı zamanı kalıcı kanıt değildir; P6-03 gönderimde yeniden doğrular).
 */
export async function validateMetaConnection(userId: string, socialAccountId: string, overrides: Partial<MetaDeps> = {}) {
  const deps = resolveDeps(overrides);
  const now = deps.now();
  const { account, connection } = await loadOwnedConnection(userId, socialAccountId);
  if (!connection.credentialRef) return { state: connectionState(account.status, connection) };
  if (!deps.config || !deps.graph || !deps.keyring) throw new DomainError(META_FAILURE_MESSAGES.NOT_CONFIGURED, "VALIDATION_ERROR");
  if (connection.tokenExpiresAt && connection.tokenExpiresAt <= now) {
    await markReauthRequired(account.id, account.businessId, "TOKEN_EXPIRED", userId, now);
    return { state: "REAUTH_REQUIRED" as const };
  }
  let token: string;
  try {
    token = decryptConnectionToken(deps.keyring, connection);
  } catch {
    await markReauthRequired(account.id, account.businessId, "CREDENTIAL_UNREADABLE", userId, now);
    return { state: "REAUTH_REQUIRED" as const };
  }
  let debug: MetaTokenDebug;
  try {
    debug = await deps.graph.debugToken(token);
  } catch (error) {
    if (error instanceof MetaGraphError && error.isInvalidToken) {
      await markReauthRequired(account.id, account.businessId, "TOKEN_REVOKED", userId, now);
      return { state: "REAUTH_REQUIRED" as const };
    }
    throw new DomainError(META_FAILURE_MESSAGES.PROVIDER_UNAVAILABLE, "PROVIDER_FAILED");
  }
  const reason = !debug.isValid ? "TOKEN_INVALID" : debug.appId !== deps.config.appId || debug.profileId !== connection.metaPageId ? "TOKEN_MISMATCH" : missingScopes(debug.scopes).length ? "MISSING_PERMISSIONS" : null;
  if (reason) {
    await markReauthRequired(account.id, account.businessId, reason, userId, now);
    return { state: "REAUTH_REQUIRED" as const };
  }
  await prisma.$transaction([
    prisma.metaConnection.update({ where: { id: connection.id }, data: { lastValidatedAt: now, tokenExpiresAt: debug.expiresAt, dataAccessExpiresAt: debug.dataAccessExpiresAt, grantedScopes: debug.scopes.slice(0, 50) } }),
    prisma.metaConnectionAudit.create({ data: { businessId: account.businessId, socialAccountId: account.id, actorUserId: userId, action: "VALIDATED", result: "OK" } }),
  ]);
  return { state: "CONNECTED" as const };
}

// ---------------------------------------------------------------------------------------------------------
// Durum ve sunucu içi kimlik bilgisi çözümü

type ConnectionLike = { credentialRef: string | null; reauthRequiredAt: Date | null; disconnectedAt: Date | null; tokenExpiresAt: Date | null };

/** Geçmiş SocialAccount.status tek başına bağlı sayılmaz; doğrulanmış, saklı kimlik bilgisi gerekir. */
export function connectionState(accountStatus: string, connection: ConnectionLike | null, now = new Date()): MetaAccountConnectionState {
  if (!connection) return "NOT_LINKED";
  if (connection.reauthRequiredAt || (connection.credentialRef && connection.tokenExpiresAt && connection.tokenExpiresAt <= now)) return "REAUTH_REQUIRED";
  if (accountStatus === "CONNECTED" && connection.credentialRef && !connection.disconnectedAt) return "CONNECTED";
  return "DISCONNECTED";
}

export type MetaAccountView = {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  state: MetaAccountConnectionState;
  pageName: string | null;
  instagramUsername: string | null;
  lastValidatedAt: Date | null;
  reconnectable: boolean;
  /** P6-03: saklı kapsamlarda platformun yayın izni var mı (gönderimde yine de yeniden doğrulanır). */
  publishPermission: boolean;
};

export function hasPublishPermission(platform: SocialPlatform, grantedScopes: readonly string[]) {
  if (platform !== "INSTAGRAM" && platform !== "FACEBOOK") return false;
  return META_PUBLISH_SCOPES[platform].every((scope) => grantedScopes.includes(scope));
}

/** Ayarlar ekranı görünümü: token, şifreli metin, sağlayıcı kimliği veya kapsam listesi dönmez. */
export async function getMetaConnectionOverview(userId: string, businessId: string, overrides: Partial<Pick<MetaDeps, "config" | "keyring">> = {}) {
  const membership = await prisma.membership.findUnique({ where: { userId_businessId: { userId, businessId } } });
  if (!membership) throw new DomainError("Bu işletme için yetkiniz yok.", "FORBIDDEN");
  let configured = false;
  try {
    const config = overrides.config !== undefined ? overrides.config : loadMetaConfig();
    const keyring = overrides.keyring !== undefined ? overrides.keyring : loadCredentialKeyring();
    configured = Boolean(config && keyring);
  } catch {
    configured = false;
  }
  const accounts = await prisma.socialAccount.findMany({
    where: { businessId },
    include: { metaConnection: { select: { credentialRef: true, reauthRequiredAt: true, disconnectedAt: true, tokenExpiresAt: true, pageName: true, instagramUsername: true, lastValidatedAt: true, grantedScopes: true } } },
    orderBy: { createdAt: "asc" },
  });
  const lastAttempt = await prisma.metaOAuthAttempt.findFirst({ where: { businessId, userId }, orderBy: { createdAt: "desc" }, select: { status: true, failureCode: true } });
  const now = new Date();
  const views: MetaAccountView[] = accounts.map((account) => {
    const state = connectionState(account.status, account.metaConnection, now);
    return {
      id: account.id,
      platform: account.platform,
      displayName: account.displayName,
      state,
      pageName: account.metaConnection?.pageName ?? null,
      instagramUsername: account.metaConnection?.instagramUsername ?? null,
      lastValidatedAt: account.metaConnection?.lastValidatedAt ?? null,
      reconnectable: state !== "NOT_LINKED",
      publishPermission: state === "CONNECTED" && hasPublishPermission(account.platform, account.metaConnection?.grantedScopes ?? []),
    };
  });
  return { configured, canManage: membership.role === "OWNER", accounts: views, lastFailure: lastAttempt?.status === "FAILED" ? lastAttempt.failureCode : null };
}

/**
 * P6-03 sınırı: publishing alanı yalnızca opak CredentialHandle alır. Bağlantı CONNECTED ve kimlik bilgisi
 * saklı değilse null döner.
 */
export async function getMetaAccountConnection(businessId: string, socialAccountId: string): Promise<AccountConnection | null> {
  const account = await prisma.socialAccount.findUnique({ where: { id: socialAccountId }, include: { metaConnection: true } });
  if (!account || account.businessId !== businessId || !account.metaConnection) return null;
  if (account.platform !== "INSTAGRAM" && account.platform !== "FACEBOOK") return null;
  const connection = account.metaConnection;
  if (connectionState(account.status, connection) !== "CONNECTED" || !connection.credentialRef) return null;
  const credential: CredentialHandle = { kind: "credential-handle", handleId: connection.credentialRef };
  return { businessId, socialAccountId: account.id, platform: account.platform, externalAccountId: connection.providerAccountId, credential };
}

/**
 * Yalnızca sunucu tarafı Meta istemcisi için token çözümü. Tutamaç, işletme ve hesap birlikte eşleşmeli;
 * AAD kiracıya bağlı olduğundan başka bir işletmenin şifreli metni çözülemez.
 */
export async function resolveMetaAccessToken(connection: AccountConnection, overrides: Partial<Pick<MetaDeps, "keyring">> = {}): Promise<string> {
  const keyring = overrides.keyring !== undefined ? overrides.keyring : loadCredentialKeyring();
  if (!keyring) throw new DomainError("Kimlik bilgisi şifreleme anahtarı yapılandırılmamış.", "VALIDATION_ERROR");
  const stored = await prisma.metaConnection.findUnique({ where: { credentialRef: connection.credential.handleId } });
  if (!stored || stored.businessId !== connection.businessId || stored.socialAccountId !== connection.socialAccountId) throw new DomainError("Kimlik bilgisi bulunamadı.", "NOT_FOUND");
  return decryptConnectionToken(keyring, stored);
}

export type MetaPublishingCredentialCheck =
  | { ok: true }
  | { ok: false; reason: "REAUTH_REQUIRED" | "PUBLISH_PERMISSION_MISSING" | "PAGE_TASK_MISSING" | "NOT_CONFIGURED" | "PROVIDER_UNAVAILABLE" };

/**
 * P6-03: gönderimden hemen önce, yalnızca sunucuda çağrılır. SocialAccount.status'a güvenilmez: saklı Page
 * token'ı çözülür ve Meta debug_token ile uygulama, tür, Page kimliği, temel ve platforma özgü yayın izni
 * yeniden doğrulanır. Geçersiz/iptal/süresi dolmuş/eşleşmeyen token P6-02 gibi "yeniden yetki gerekli"ye
 * geçer; eksik yayın izni bağlantıyı silmez, yalnızca gönderimi durdurur. Ağ belirsizliği hiçbir şeyi değiştirmez.
 */
export async function verifyMetaPublishingCredential(connection: AccountConnection, actorUserId: string | null, overrides: Partial<MetaDeps> = {}): Promise<MetaPublishingCredentialCheck> {
  const deps = resolveDeps(overrides);
  const now = deps.now();
  if (!deps.config || !deps.graph || !deps.keyring) return { ok: false, reason: "NOT_CONFIGURED" };
  const stored = await prisma.metaConnection.findUnique({ where: { credentialRef: connection.credential.handleId }, include: { socialAccount: true } });
  if (
    !stored ||
    stored.businessId !== connection.businessId ||
    stored.socialAccountId !== connection.socialAccountId ||
    stored.platform !== connection.platform ||
    stored.providerAccountId !== connection.externalAccountId ||
    connectionState(stored.socialAccount.status, stored, now) !== "CONNECTED"
  ) {
    return { ok: false, reason: "REAUTH_REQUIRED" };
  }
  if (stored.platform === "INSTAGRAM" && stored.instagramAccountId !== stored.providerAccountId) return { ok: false, reason: "REAUTH_REQUIRED" };
  let token: string;
  try {
    token = decryptConnectionToken(deps.keyring, stored);
  } catch {
    await markReauthRequired(stored.socialAccountId, stored.businessId, "CREDENTIAL_UNREADABLE", actorUserId, now);
    return { ok: false, reason: "REAUTH_REQUIRED" };
  }
  let debug: MetaTokenDebug;
  try {
    debug = await deps.graph.debugToken(token);
  } catch (error) {
    if (error instanceof MetaGraphError && error.isInvalidToken) {
      await markReauthRequired(stored.socialAccountId, stored.businessId, "TOKEN_REVOKED", actorUserId, now);
      return { ok: false, reason: "REAUTH_REQUIRED" };
    }
    return { ok: false, reason: "PROVIDER_UNAVAILABLE" };
  }
  const expired = debug.expiresAt !== null && debug.expiresAt <= now;
  const reason = !debug.isValid || expired ? "TOKEN_INVALID" : debug.appId !== deps.config.appId || debug.type !== "PAGE" || debug.profileId !== stored.metaPageId ? "TOKEN_MISMATCH" : missingScopes(debug.scopes).length ? "MISSING_PERMISSIONS" : null;
  if (reason) {
    await markReauthRequired(stored.socialAccountId, stored.businessId, reason, actorUserId, now);
    return { ok: false, reason: "REAUTH_REQUIRED" };
  }
  await prisma.metaConnection.update({ where: { id: stored.id }, data: { lastValidatedAt: now, tokenExpiresAt: debug.expiresAt, dataAccessExpiresAt: debug.dataAccessExpiresAt, grantedScopes: debug.scopes.slice(0, 50) } });
  if (!hasPublishPermission(stored.platform, debug.scopes)) return { ok: false, reason: "PUBLISH_PERMISSION_MISSING" };
  if (!stored.pageTasks.some((task) => (META_PUBLISH_PAGE_TASKS as readonly string[]).includes(task))) return { ok: false, reason: "PAGE_TASK_MISSING" };
  return { ok: true };
}

/**
 * P6-03: yayın sırasında Meta token'ı açıkça reddederse (190) P6-02 ile aynı "yeniden yetki gerekli" yolu.
 * Tutamaç eşleşmezse hiçbir şey yapılmaz.
 */
export async function markMetaCredentialRejected(connection: AccountConnection, reason: string, now = new Date()) {
  const stored = await prisma.metaConnection.findUnique({ where: { credentialRef: connection.credential.handleId } });
  if (!stored || stored.businessId !== connection.businessId || stored.socialAccountId !== connection.socialAccountId) return;
  await markReauthRequired(stored.socialAccountId, stored.businessId, reason, null, now);
}
