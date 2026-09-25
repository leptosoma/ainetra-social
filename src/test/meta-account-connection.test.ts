import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { createContent } from "@/features/content/service";
import { approveContentVariant } from "@/features/approval/service";
import { scheduleContentVariant } from "@/features/publishing/service";
import { requestPublishIntent } from "@/features/publishing/intent";
import { META_REQUIRED_SCOPES, loadMetaConfig, type MetaConfig } from "@/features/meta-connection/config";
import { credentialAad, decryptCredential, encryptCredential, loadCredentialKeyring } from "@/features/meta-connection/crypto";
import { MetaGraphError, createMetaGraphClient, type MetaGraphClient, type MetaPage, type MetaTokenDebug } from "@/features/meta-connection/graph-client";
import {
  cancelMetaSelection,
  completeMetaSelection,
  disconnectMetaAccount,
  getMetaAccountConnection,
  getMetaConnectionOverview,
  getMetaSelection,
  handleMetaCallback,
  resolveMetaAccessToken,
  startMetaConnection,
  validateMetaConnection,
  type MetaDeps,
} from "@/features/meta-connection/service";

const APP_ID = "1234567890";
const USER_TOKEN = "USER-SECRET-TOKEN-abc";
const LONG_USER_TOKEN = "LONG-USER-SECRET-TOKEN-def";
const CODE = "AUTH-CODE-SECRET-xyz";
const pageToken = (pageId: string) => `PAGE-SECRET-TOKEN-${pageId}`;
const SECRETS = [USER_TOKEN, LONG_USER_TOKEN, CODE, "PAGE-SECRET-TOKEN", "test-app-secret"];

const config = loadMetaConfig({
  META_APP_ID: APP_ID,
  META_APP_SECRET: "test-app-secret",
  META_REDIRECT_URI: "http://localhost:3001/integrations/meta/callback",
  META_GRAPH_API_VERSION: "v26.0",
}) as MetaConfig;
const keyring = loadCredentialKeyring({ META_CREDENTIAL_KEY: randomBytes(32).toString("base64"), META_CREDENTIAL_KEY_ID: "k1" })!;

const PAGE_WITH_IG: MetaPage = { id: "1001", name: "Mimoza Bodrum", accessToken: pageToken("1001"), tasks: ["MANAGE", "CREATE_CONTENT"], instagramBusinessAccountId: "17841400000000001" };
const PAGE_NO_IG: MetaPage = { id: "1002", name: "Mimoza Events", accessToken: pageToken("1002"), tasks: ["CREATE_CONTENT"], instagramBusinessAccountId: null };
const PAGE_BAD_IG: MetaPage = { id: "1003", name: "Mimoza Old", accessToken: pageToken("1003"), tasks: ["MANAGE"], instagramBusinessAccountId: "17841400000000003" };
const PAGE_NO_TASKS: MetaPage = { id: "1004", name: "Viewer Page", accessToken: pageToken("1004"), tasks: ["ANALYZE"], instagramBusinessAccountId: null };

type FakeOptions = {
  pages?: MetaPage[];
  userScopes?: string[];
  pageScopes?: string[];
  userDebug?: Partial<MetaTokenDebug>;
  pageDebug?: (pageId: string) => Partial<MetaTokenDebug>;
  exchangeError?: Error;
  instagramError?: (id: string) => Error | null;
  pageLinkedInstagram?: (pageId: string) => string | null | undefined;
};

function fakeGraph(options: FakeOptions = {}) {
  const calls = { exchangeCode: 0, longLived: 0, debugToken: 0, listPages: 0, getPage: 0, getInstagram: 0 };
  const pages = options.pages ?? [PAGE_WITH_IG, PAGE_NO_IG];
  const graph: MetaGraphClient = {
    buildAuthorizeUrl: createMetaGraphClient(config, vi.fn()).buildAuthorizeUrl,
    async exchangeCode(code) {
      calls.exchangeCode++;
      if (options.exchangeError) throw options.exchangeError;
      expect(code).toBe(CODE);
      return { accessToken: USER_TOKEN, tokenType: "bearer", expiresInSeconds: 3600 };
    },
    async exchangeLongLivedUserToken(token) {
      calls.longLived++;
      expect(token).toBe(USER_TOKEN);
      return { accessToken: LONG_USER_TOKEN, tokenType: "bearer", expiresInSeconds: 5_000_000 };
    },
    async debugToken(token) {
      calls.debugToken++;
      if (token === LONG_USER_TOKEN) {
        return { appId: APP_ID, type: "USER", isValid: true, expiresAt: new Date(Date.now() + 50 * 86400_000), dataAccessExpiresAt: new Date(Date.now() + 80 * 86400_000), scopes: options.userScopes ?? [...META_REQUIRED_SCOPES], userId: "555", profileId: null, ...options.userDebug };
      }
      const pageId = token.replace("PAGE-SECRET-TOKEN-", "");
      return { appId: APP_ID, type: "PAGE", isValid: true, expiresAt: null, dataAccessExpiresAt: new Date(Date.now() + 80 * 86400_000), scopes: options.pageScopes ?? [...META_REQUIRED_SCOPES], userId: "555", profileId: pageId, ...options.pageDebug?.(pageId) };
    },
    async listPages(token) {
      calls.listPages++;
      expect(token).toBe(LONG_USER_TOKEN);
      return pages;
    },
    async getPage(pageId, token) {
      calls.getPage++;
      expect(token).toBe(pageToken(pageId));
      const page = pages.find((item) => item.id === pageId)!;
      const linked = options.pageLinkedInstagram?.(pageId);
      return { id: page.id, name: page.name, instagramBusinessAccountId: linked === undefined ? page.instagramBusinessAccountId : linked };
    },
    async getInstagramAccount(id, token) {
      calls.getInstagram++;
      expect(token.startsWith("PAGE-SECRET-TOKEN-")).toBe(true);
      const error = options.instagramError?.(id) ?? (id === PAGE_BAD_IG.instagramBusinessAccountId ? new MetaGraphError("PROVIDER", { httpStatus: 400, code: 100 }) : null);
      if (error) throw error;
      return { id, username: id === PAGE_WITH_IG.instagramBusinessAccountId ? "mimozabodrum" : "other" };
    },
  };
  return { graph, calls };
}

function deps(graph: MetaGraphClient, extra: Partial<MetaDeps> = {}): Partial<MetaDeps> {
  return { config, keyring, graph, ...extra };
}

async function tenant(role: "OWNER" | "MEMBER" = "OWNER") {
  const user = await prisma.user.create({ data: { name: "Owner", email: `u-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({ data: { name: "Mimoza", sector: "RESTAURANT", memberships: { create: { userId: user.id, role } } } });
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomBytes(16).toString("hex"), expiresAt: new Date(Date.now() + 86400_000) } });
  return { user, business, session, ctx: { userId: user.id, sessionId: session.id } };
}

function stateFrom(url: string) {
  return new URL(url).searchParams.get("state")!;
}

async function reachSelection(t: Awaited<ReturnType<typeof tenant>>, graph: MetaGraphClient, reconnectSocialAccountId?: string) {
  const { authorizeUrl } = await startMetaConnection(t.ctx, t.business.id, { reconnectSocialAccountId }, deps(graph));
  const result = await handleMetaCallback(t.ctx, { state: stateFrom(authorizeUrl), code: CODE }, deps(graph));
  if (result.kind !== "SELECT") throw new Error(`expected selection, got ${result.code}`);
  return result.selectionHandle;
}

async function connect(t: Awaited<ReturnType<typeof tenant>>, choices: string[], graph = fakeGraph().graph, reconnectSocialAccountId?: string) {
  const handle = await reachSelection(t, graph, reconnectSocialAccountId);
  return completeMetaSelection(t.ctx, handle, choices, deps(graph));
}

async function dumpMetaRows() {
  const rows = await prisma.$queryRawUnsafe<Array<{ row: string }>>(`
    SELECT row_to_json(t)::text AS row FROM "MetaOAuthAttempt" t
    UNION ALL SELECT row_to_json(t)::text FROM "MetaConnection" t
    UNION ALL SELECT row_to_json(t)::text FROM "MetaConnectionAudit" t
    UNION ALL SELECT row_to_json(t)::text FROM "SocialAccount" t`);
  return rows.map((item) => item.row).join("\n");
}

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

afterEach(() => vi.restoreAllMocks());

describe("P6-02 Meta connection start", () => {
  it("rejects non-members and MEMBER role, and refuses when Meta or encryption is not configured", async () => {
    const owner = await tenant();
    const member = await tenant("MEMBER");
    const outsider = await tenant();
    const { graph } = fakeGraph();
    await expect(startMetaConnection(outsider.ctx, owner.business.id, {}, deps(graph))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startMetaConnection(member.ctx, member.business.id, {}, deps(graph))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startMetaConnection(owner.ctx, owner.business.id, {}, deps(graph, { config: null, graph: null }))).rejects.toBeInstanceOf(DomainError);
    await expect(startMetaConnection(owner.ctx, owner.business.id, {}, deps(graph, { keyring: null }))).rejects.toBeInstanceOf(DomainError);
    await expect(startMetaConnection({ userId: owner.user.id, sessionId: outsider.session.id }, owner.business.id, {}, deps(graph))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await prisma.metaOAuthAttempt.count()).toBe(0);
  });

  it("persists only the state hash bound to user/session/business and requests exactly the baseline scopes on v26.0", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    const { authorizeUrl, attemptId } = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(url.searchParams.get("scope")).toBe("pages_show_list,instagram_basic,pages_read_engagement");
    expect(url.searchParams.get("scope")).not.toMatch(/ads_|publish|manage_posts|insights|comments|messag/);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3001/integrations/meta/callback");
    expect(url.searchParams.get("client_id")).toBe(APP_ID);
    const state = url.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(43);
    const attempt = await prisma.metaOAuthAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt).toMatchObject({ businessId: t.business.id, userId: t.user.id, sessionId: t.session.id, status: "PENDING", consumedAt: null });
    expect(attempt.stateHash).not.toBe(state);
    expect(await dumpMetaRows()).not.toContain(state);
    expect(attempt.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect(await prisma.metaConnectionAudit.count({ where: { action: "CONNECT_STARTED", businessId: t.business.id } })).toBe(1);
  });

  it("rate limits connection starts per business", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    for (let index = 0; index < 10; index++) await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    await expect(startMetaConnection(t.ctx, t.business.id, {}, deps(graph))).rejects.toThrow(/en fazla 10/);
  });

  it("rejects insecure or malformed redirect configuration and unpinned versions", () => {
    const base = { META_APP_ID: APP_ID, META_APP_SECRET: "s" };
    expect(() => loadMetaConfig({ ...base, META_REDIRECT_URI: "http://evil.example/cb" })).toThrow(/HTTPS/);
    expect(() => loadMetaConfig({ ...base, META_REDIRECT_URI: "https://app.example/cb?next=x" })).toThrow(/query/);
    expect(() => loadMetaConfig({ ...base, META_REDIRECT_URI: "https://app.example/cb", META_GRAPH_API_VERSION: "latest" })).toThrow(/v26/);
    expect(() => loadMetaConfig({ META_APP_ID: APP_ID })).toThrow(/together/);
    expect(loadMetaConfig({})).toBeNull();
    expect(loadMetaConfig({ ...base, META_REDIRECT_URI: "https://app.example/cb" })?.graphBaseUrl).toBe("https://graph.facebook.com/v26.0");
  });
});

describe("P6-02 OAuth callback state", () => {
  it("rejects missing, tampered and replayed state before any code exchange", async () => {
    const t = await tenant();
    const { graph, calls } = fakeGraph();
    const { authorizeUrl } = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    const state = stateFrom(authorizeUrl);
    expect(await handleMetaCallback(t.ctx, { code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code: "INVALID_STATE" });
    expect(await handleMetaCallback(t.ctx, { state: `${state}x`, code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code: "INVALID_STATE" });
    expect(calls.exchangeCode).toBe(0);
    expect((await handleMetaCallback(t.ctx, { state, code: CODE }, deps(graph))).kind).toBe("SELECT");
    expect(await handleMetaCallback(t.ctx, { state, code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code: "INVALID_STATE" });
    expect(calls.exchangeCode).toBe(1);
  });

  it("binds the callback to the initiating user and live session", async () => {
    const t = await tenant();
    const other = await tenant();
    const { graph, calls } = fakeGraph();
    const { authorizeUrl, attemptId } = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    const state = stateFrom(authorizeUrl);
    expect(await handleMetaCallback(other.ctx, { state, code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code: "SESSION_MISMATCH" });
    expect(await handleMetaCallback(null, { state, code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code: "SESSION_MISMATCH" });
    const secondSession = await prisma.session.create({ data: { userId: t.user.id, tokenHash: randomBytes(16).toString("hex"), expiresAt: new Date(Date.now() + 86400_000) } });
    expect(await handleMetaCallback({ userId: t.user.id, sessionId: secondSession.id }, { state, code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code: "SESSION_MISMATCH" });
    expect(calls.exchangeCode).toBe(0);
    expect((await prisma.metaOAuthAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("PENDING");
    // Oturum kapanınca deneme (ve bekleyen sırlar) kaskadla silinir.
    await prisma.session.delete({ where: { id: t.session.id } });
    expect(await prisma.metaOAuthAttempt.count({ where: { id: attemptId } })).toBe(0);
  });

  it("fails expired state without exchanging and rejects revoked ownership after consuming", async () => {
    const t = await tenant();
    const { graph, calls } = fakeGraph();
    const { authorizeUrl, attemptId } = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    const later = () => new Date(Date.now() + 11 * 60_000);
    expect(await handleMetaCallback(t.ctx, { state: stateFrom(authorizeUrl), code: CODE }, deps(graph, { now: later }))).toEqual({ kind: "ERROR", code: "STATE_EXPIRED" });
    expect((await prisma.metaOAuthAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("FAILED");

    const second = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    await prisma.membership.updateMany({ where: { userId: t.user.id }, data: { role: "MEMBER" } });
    expect(await handleMetaCallback(t.ctx, { state: stateFrom(second.authorizeUrl), code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code: "FORBIDDEN" });
    expect(calls.exchangeCode).toBe(0);
  });

  it("lets exactly one of two concurrent callbacks proceed", async () => {
    const t = await tenant();
    const { graph, calls } = fakeGraph();
    const { authorizeUrl } = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    const state = stateFrom(authorizeUrl);
    const results = await Promise.all([handleMetaCallback(t.ctx, { state, code: CODE }, deps(graph)), handleMetaCallback(t.ctx, { state, code: CODE }, deps(graph))]);
    expect(results.filter((result) => result.kind === "SELECT")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "ERROR")).toEqual([{ kind: "ERROR", code: "INVALID_STATE" }]);
    expect(calls.exchangeCode).toBe(1);
  });

  it("records provider denial as a recoverable failure with no secrets; retry starts a new attempt", async () => {
    const t = await tenant();
    const { graph, calls } = fakeGraph();
    const { authorizeUrl, attemptId } = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    expect(await handleMetaCallback(t.ctx, { state: stateFrom(authorizeUrl), error: "access_denied" }, deps(graph))).toEqual({ kind: "ERROR", code: "PROVIDER_DENIED" });
    const attempt = await prisma.metaOAuthAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt).toMatchObject({ status: "FAILED", failureCode: "PROVIDER_DENIED", pendingCiphertext: null, selectionHandleHash: null });
    expect(calls.exchangeCode).toBe(0);
    expect((await reachSelection(t, graph)).length).toBeGreaterThan(20);
    expect((await getMetaConnectionOverview(t.user.id, t.business.id, { config, keyring })).lastFailure).toBeNull();
  });

  it("rejects partial permissions, foreign-app tokens and failed exchanges without storing anything usable", async () => {
    for (const [options, code] of [
      [{ userScopes: ["pages_show_list", "instagram_basic"] }, "MISSING_PERMISSIONS"],
      [{ userDebug: { appId: "999" } }, "TOKEN_INVALID"],
      [{ userDebug: { isValid: false } }, "TOKEN_INVALID"],
      [{ exchangeError: new MetaGraphError("PROVIDER", { httpStatus: 400, code: 100 }) }, "TOKEN_EXCHANGE_FAILED"],
      [{ exchangeError: new MetaGraphError("TIMEOUT") }, "PROVIDER_UNAVAILABLE"],
      [{ pages: [] }, "NO_PAGES"],
      [{ pages: [PAGE_NO_TASKS] }, "NO_ELIGIBLE_ASSETS"],
    ] as Array<[FakeOptions, string]>) {
      const t = await tenant();
      const { graph } = fakeGraph(options);
      const { authorizeUrl, attemptId } = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
      expect(await handleMetaCallback(t.ctx, { state: stateFrom(authorizeUrl), code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code });
      expect(await prisma.metaOAuthAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ status: "FAILED", failureCode: code, pendingCiphertext: null });
    }
    expect(await prisma.metaConnection.count()).toBe(0);
    expect(await prisma.socialAccount.count()).toBe(0);
    expectNoSecrets(await dumpMetaRows());
  });

  it("fails the whole discovery when an Instagram lookup times out instead of returning a partial list", async () => {
    const t = await tenant();
    const { graph } = fakeGraph({ instagramError: () => new MetaGraphError("TIMEOUT") });
    const { authorizeUrl } = await startMetaConnection(t.ctx, t.business.id, {}, deps(graph));
    expect(await handleMetaCallback(t.ctx, { state: stateFrom(authorizeUrl), code: CODE }, deps(graph))).toEqual({ kind: "ERROR", code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("P6-02 discovery and selection", () => {
  it("shows sanitized options: Page with IG, Page without IG, ineligible IG and missing tasks", async () => {
    const t = await tenant();
    const { graph } = fakeGraph({ pages: [PAGE_WITH_IG, PAGE_NO_IG, PAGE_BAD_IG, PAGE_NO_TASKS] });
    const handle = await reachSelection(t, graph);
    const selection = await getMetaSelection(t.ctx, handle);
    expect(selection?.options).toEqual([
      { key: "a0", pageName: "Mimoza Bodrum", facebook: { eligible: true, reason: null }, instagram: { username: "mimozabodrum", eligible: true, reason: null }, reconnectPlatform: null },
      { key: "a1", pageName: "Mimoza Events", facebook: { eligible: true, reason: null }, instagram: null, reconnectPlatform: null },
      { key: "a2", pageName: "Mimoza Old", facebook: { eligible: true, reason: null }, instagram: { username: null, eligible: false, reason: "INSTAGRAM_UNAVAILABLE" }, reconnectPlatform: null },
      { key: "a3", pageName: "Viewer Page", facebook: { eligible: false, reason: "MISSING_PAGE_TASKS" }, instagram: null, reconnectPlatform: null },
    ]);
    const serialized = JSON.stringify(selection);
    expectNoSecrets(serialized);
    expect(serialized).not.toMatch(/1001|17841400000000001|MANAGE/);
    expect(await getMetaSelection((await tenant()).ctx, handle)).toBeNull();
    const attempt = await prisma.metaOAuthAttempt.findFirstOrThrow({ where: { businessId: t.business.id } });
    expect(attempt.selectionHandleHash).not.toBe(handle);
    expectNoSecrets(await dumpMetaRows());
  });

  it("connects two distinct selected assets atomically with encrypted credentials and audit", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    const result = await connect(t, ["a0:FACEBOOK", "a0:INSTAGRAM", "a1:FACEBOOK"], graph);
    expect(result.connected.map((item) => [item.platform, item.displayName, item.reconnected])).toEqual([
      ["FACEBOOK", "Mimoza Bodrum", false],
      ["INSTAGRAM", "@mimozabodrum", false],
      ["FACEBOOK", "Mimoza Events", false],
    ]);
    const accounts = await prisma.socialAccount.findMany({ where: { businessId: t.business.id }, include: { metaConnection: true }, orderBy: { createdAt: "asc" } });
    expect(accounts).toHaveLength(3);
    const instagram = accounts.find((account) => account.platform === "INSTAGRAM")!;
    expect(instagram).toMatchObject({ status: "CONNECTED", externalAccountId: "17841400000000001" });
    expect(instagram.metaConnection).toMatchObject({ metaPageId: "1001", instagramAccountId: "17841400000000001", tokenType: "PAGE", keyId: "k1", grantedScopes: [...META_REQUIRED_SCOPES] });
    expect(instagram.metaConnection!.credentialRef).toMatch(/^mcred_/);
    const attempt = await prisma.metaOAuthAttempt.findFirstOrThrow({ where: { businessId: t.business.id } });
    expect(attempt).toMatchObject({ status: "COMPLETED", pendingCiphertext: null, selectionHandleHash: null, candidates: null });
    expect(await prisma.metaConnectionAudit.count({ where: { businessId: t.business.id, action: "CONNECTED" } })).toBe(3);
    expectNoSecrets(await dumpMetaRows());

    const connection = await getMetaAccountConnection(t.business.id, instagram.id);
    expect(connection).toMatchObject({ platform: "INSTAGRAM", externalAccountId: "17841400000000001", credential: { kind: "credential-handle" } });
    expect(JSON.stringify(connection)).not.toContain("PAGE-SECRET");
    expect(await resolveMetaAccessToken(connection!, { keyring })).toBe(pageToken("1001"));
    const overview = await getMetaConnectionOverview(t.user.id, t.business.id, { config, keyring });
    expect(overview.accounts.map((account) => account.state)).toEqual(["CONNECTED", "CONNECTED", "CONNECTED"]);
    expectNoSecrets(JSON.stringify(overview));
    expect(JSON.stringify(overview)).not.toMatch(/mcred_|17841400000000001|ciphertext/);
  });

  it("rejects forged, ineligible, replayed and cross-tenant selections without connecting anything", async () => {
    const t = await tenant();
    const { graph } = fakeGraph({ pages: [PAGE_WITH_IG, PAGE_BAD_IG] });
    const forged = await reachSelection(t, graph);
    await expect(completeMetaSelection(t.ctx, forged, ["a9:FACEBOOK"], deps(graph))).rejects.toThrow(/Seçim geçersiz/);
    await expect(completeMetaSelection(t.ctx, forged, ["a0:FACEBOOK"], deps(graph))).rejects.toMatchObject({ code: "CONFLICT" });

    const ineligible = await reachSelection(t, graph);
    await expect(completeMetaSelection(t.ctx, ineligible, ["a0:FACEBOOK", "a1:INSTAGRAM"], deps(graph))).rejects.toThrow(/Seçim geçersiz/);
    await expect(completeMetaSelection(t.ctx, "not-a-handle", ["a0:FACEBOOK"], deps(graph))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(completeMetaSelection(t.ctx, "x", ["1001:FACEBOOK"], deps(graph))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const other = await tenant();
    const handle = await reachSelection(t, graph);
    await expect(completeMetaSelection(other.ctx, handle, ["a0:FACEBOOK"], deps(graph))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.socialAccount.count()).toBe(0);
    await completeMetaSelection(t.ctx, handle, ["a0:FACEBOOK"], deps(graph));
    await expect(completeMetaSelection(t.ctx, handle, ["a0:FACEBOOK"], deps(graph))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.socialAccount.count()).toBe(1);
  });

  it("never marks CONNECTED when selection-time credential validation fails", async () => {
    for (const options of [
      { pageDebug: () => ({ isValid: false }) },
      { pageDebug: () => ({ profileId: "9999" }) },
      { pageDebug: () => ({ appId: "42" }) },
      { pageScopes: ["pages_show_list"] },
      { pageLinkedInstagram: () => null },
    ] as FakeOptions[]) {
      const t = await tenant();
      const { graph } = fakeGraph(options);
      const handle = await reachSelection(t, graph);
      await expect(completeMetaSelection(t.ctx, handle, ["a1:FACEBOOK", "a0:INSTAGRAM"], deps(graph))).rejects.toBeInstanceOf(DomainError);
      expect(await prisma.socialAccount.count({ where: { businessId: t.business.id } })).toBe(0);
      expect(await prisma.metaOAuthAttempt.findFirstOrThrow({ where: { businessId: t.business.id } })).toMatchObject({ status: "FAILED", pendingCiphertext: null });
    }
    expect(await prisma.metaConnection.count()).toBe(0);
  });

  it("expires pending selections and purges their secrets; cancel purges immediately", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    const handle = await reachSelection(t, graph);
    expect(await getMetaSelection(t.ctx, handle, { now: () => new Date(Date.now() + 11 * 60_000) })).toBeNull();
    expect(await prisma.metaOAuthAttempt.findFirstOrThrow({ where: { businessId: t.business.id } })).toMatchObject({ status: "FAILED", failureCode: "SELECTION_EXPIRED", pendingCiphertext: null });

    const cancelled = await reachSelection(t, graph);
    await cancelMetaSelection(t.ctx, cancelled);
    expect(await prisma.metaOAuthAttempt.count({ where: { businessId: t.business.id, pendingCiphertext: { not: null } } })).toBe(0);
  });

  it("refuses to reassign an asset that is live in another business", async () => {
    const first = await tenant();
    const second = await tenant();
    const { graph } = fakeGraph();
    await connect(first, ["a0:INSTAGRAM"], graph);
    const handle = await reachSelection(second, graph);
    await expect(completeMetaSelection(second.ctx, handle, ["a1:FACEBOOK", "a0:INSTAGRAM"], deps(graph))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.socialAccount.count({ where: { businessId: second.business.id } })).toBe(0);
    expect(await prisma.metaConnectionAudit.count({ where: { businessId: second.business.id, action: "SELECTION_FAILED", result: "ASSET_OWNED_BY_OTHER_BUSINESS" } })).toBe(1);
    // Birinci işletmede bağlantı kesildikten sonra ikinci işletme açıkça bağlayabilir.
    const account = await prisma.socialAccount.findFirstOrThrow({ where: { businessId: first.business.id } });
    await disconnectMetaAccount(first.user.id, account.id);
    await connect(second, ["a0:INSTAGRAM"], graph);
    expect(await prisma.socialAccount.count({ where: { businessId: second.business.id, status: "CONNECTED" } })).toBe(1);
  });
});

describe("P6-02 reconnect, duplicates and history", () => {
  it("keeps one SocialAccount across reauthorization and concurrent selections, rotating the credential", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    await connect(t, ["a0:INSTAGRAM"], graph);
    const account = await prisma.socialAccount.findFirstOrThrow({ where: { businessId: t.business.id }, include: { metaConnection: true } });
    const firstRef = account.metaConnection!.credentialRef;

    const again = await connect(t, ["a0:INSTAGRAM"], graph);
    expect(again.connected[0]).toMatchObject({ socialAccountId: account.id, reconnected: true });

    const [handleA, handleB] = [await reachSelection(t, graph), await reachSelection(t, graph)];
    const results = await Promise.allSettled([
      completeMetaSelection(t.ctx, handleA, ["a0:INSTAGRAM", "a1:FACEBOOK"], deps(graph)),
      completeMetaSelection(t.ctx, handleB, ["a0:INSTAGRAM", "a1:FACEBOOK"], deps(graph)),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const rows = await prisma.socialAccount.findMany({ where: { businessId: t.business.id }, include: { metaConnection: true } });
    expect(rows).toHaveLength(2);
    expect(await prisma.metaConnection.count({ where: { businessId: t.business.id } })).toBe(2);
    const instagram = rows.find((row) => row.platform === "INSTAGRAM")!;
    expect(instagram.id).toBe(account.id);
    expect(instagram.metaConnection!.credentialRef).not.toBe(firstRef);
    expect(await prisma.metaConnectionAudit.count({ where: { socialAccountId: account.id, action: "RECONNECTED" } })).toBeGreaterThanOrEqual(2);
  });

  it("reconnects a reauth-required account in place and preserves scheduled posts and publish intents", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    await connect(t, ["a0:INSTAGRAM"], graph);
    const account = await prisma.socialAccount.findFirstOrThrow({ where: { businessId: t.business.id } });
    const content = await createContent(t.user.id, t.business.id, { title: "Friday", topic: "Reservation", contentType: "POST", platform: "INSTAGRAM", caption: "Hi", language: "tr" });
    await approveContentVariant(t.user.id, content.variants[0].id);
    const post = await scheduleContentVariant(t.user.id, content.variants[0].id, { socialAccountId: account.id, scheduledAt: new Date(Date.now() + 86400_000), expectedVersion: 1 });
    const intent = await requestPublishIntent(t.user.id, post.id, 1);

    const { graph: revoked } = fakeGraph({ pageDebug: () => ({ isValid: false }) });
    expect(await validateMetaConnection(t.user.id, account.id, deps(revoked))).toEqual({ state: "REAUTH_REQUIRED" });
    expect((await getMetaConnectionOverview(t.user.id, t.business.id, { config, keyring })).accounts[0]).toMatchObject({ state: "REAUTH_REQUIRED", reconnectable: true });
    expect(await getMetaAccountConnection(t.business.id, account.id)).toBeNull();

    const result = await connect(t, ["a0:INSTAGRAM"], graph, account.id);
    expect(result.connected).toEqual([expect.objectContaining({ socialAccountId: account.id, reconnected: true })]);
    const fresh = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id }, include: { metaConnection: true } });
    expect(fresh.status).toBe("CONNECTED");
    expect(fresh.metaConnection).toMatchObject({ reauthRequiredAt: null, disconnectedAt: null });
    expect(await prisma.scheduledPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ socialAccountId: account.id, status: "SCHEDULED" });
    const intentAfter = await prisma.publishIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(intentAfter).toMatchObject({ state: intent.state, snapshotHash: intent.snapshotHash, socialAccountId: account.id });
    expect(await prisma.publishAttempt.count()).toBe(0);
  });

  it("requires the reconnect target to be selected and available", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    await connect(t, ["a0:INSTAGRAM"], graph);
    const account = await prisma.socialAccount.findFirstOrThrow({ where: { businessId: t.business.id } });
    const handle = await reachSelection(t, graph, account.id);
    expect((await getMetaSelection(t.ctx, handle))?.options[0].reconnectPlatform).toBe("INSTAGRAM");
    await expect(completeMetaSelection(t.ctx, handle, ["a1:FACEBOOK"], deps(graph))).rejects.toThrow(/Seçim geçersiz/);

    const { graph: withoutAsset } = fakeGraph({ pages: [PAGE_NO_IG] });
    const { authorizeUrl } = await startMetaConnection(t.ctx, t.business.id, { reconnectSocialAccountId: account.id }, deps(withoutAsset));
    expect(await handleMetaCallback(t.ctx, { state: stateFrom(authorizeUrl), code: CODE }, deps(withoutAsset))).toEqual({ kind: "ERROR", code: "RECONNECT_ASSET_UNAVAILABLE" });
    const other = await tenant();
    await expect(startMetaConnection(other.ctx, other.business.id, { reconnectSocialAccountId: account.id }, deps(graph))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("P6-02 disconnect, validation and legacy rows", () => {
  it("disconnects only with OWNER authority, removes the credential and keeps history", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    await connect(t, ["a0:FACEBOOK"], graph);
    const account = await prisma.socialAccount.findFirstOrThrow({ where: { businessId: t.business.id } });
    const outsider = await tenant();
    const member = await prisma.user.create({ data: { name: "Staff", email: `s-${crypto.randomUUID()}@test.dev`, passwordHash: "hash", memberships: { create: { businessId: t.business.id, role: "MEMBER" } } } });
    await expect(disconnectMetaAccount(outsider.user.id, account.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(disconnectMetaAccount(member.id, account.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(validateMetaConnection(outsider.user.id, account.id, deps(graph))).rejects.toMatchObject({ code: "FORBIDDEN" });

    await disconnectMetaAccount(t.user.id, account.id);
    const fresh = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id }, include: { metaConnection: true } });
    expect(fresh.status).toBe("DISCONNECTED");
    expect(fresh.metaConnection).toMatchObject({ credentialRef: null, ciphertext: null, nonce: null, authTag: null, keyId: null, providerRevocation: "NOT_REQUESTED" });
    expect(fresh.metaConnection!.disconnectedAt).toBeInstanceOf(Date);
    expect(await getMetaAccountConnection(t.business.id, account.id)).toBeNull();
    expect(await prisma.metaConnectionAudit.findFirst({ where: { socialAccountId: account.id, action: "DISCONNECTED" } })).toMatchObject({ actorUserId: t.user.id, result: "LOCAL_CREDENTIAL_REMOVED", reason: "PROVIDER_REVOCATION_NOT_REQUESTED" });
    expect((await getMetaConnectionOverview(t.user.id, t.business.id, { config, keyring })).accounts[0].state).toBe("DISCONNECTED");
  });

  it("marks revoked or expired credentials as reauth-required but leaves state untouched on transport errors", async () => {
    const t = await tenant();
    const { graph } = fakeGraph();
    await connect(t, ["a0:FACEBOOK", "a1:FACEBOOK"], graph);
    const [first, second] = await prisma.socialAccount.findMany({ where: { businessId: t.business.id }, orderBy: { createdAt: "asc" } });

    expect(await validateMetaConnection(t.user.id, first.id, deps(graph))).toEqual({ state: "CONNECTED" });
    const flaky: MetaGraphClient = { ...graph, debugToken: async () => { throw new MetaGraphError("TIMEOUT"); } };
    await expect(validateMetaConnection(t.user.id, first.id, deps(flaky))).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("CONNECTED");

    const revoked: MetaGraphClient = { ...graph, debugToken: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 190 }); } };
    expect(await validateMetaConnection(t.user.id, first.id, deps(revoked))).toEqual({ state: "REAUTH_REQUIRED" });
    expect(await prisma.metaConnection.findUniqueOrThrow({ where: { socialAccountId: first.id } })).toMatchObject({ credentialRef: null, reauthReason: "TOKEN_REVOKED" });
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("DISCONNECTED");

    await prisma.metaConnection.update({ where: { socialAccountId: second.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    expect((await getMetaConnectionOverview(t.user.id, t.business.id, { config, keyring })).accounts[1].state).toBe("REAUTH_REQUIRED");
    expect(await getMetaAccountConnection(t.business.id, second.id)).toBeNull();
    expect(await validateMetaConnection(t.user.id, second.id, deps(graph))).toEqual({ state: "REAUTH_REQUIRED" });
    expect(await prisma.metaConnectionAudit.count({ where: { businessId: t.business.id, action: "REAUTH_REQUIRED" } })).toBe(2);
  });

  it("never treats a legacy CONNECTED row without a Meta credential as connected", async () => {
    const t = await tenant();
    const legacy = await prisma.socialAccount.create({ data: { businessId: t.business.id, platform: "INSTAGRAM", displayName: "@demo (Demo)", externalAccountId: "demo-instagram-001", status: "CONNECTED" } });
    const nullId = await prisma.socialAccount.create({ data: { businessId: t.business.id, platform: "INSTAGRAM", displayName: "Legacy", status: "CONNECTED" } });
    await prisma.socialAccount.create({ data: { businessId: t.business.id, platform: "INSTAGRAM", displayName: "Legacy 2", status: "DISCONNECTED" } });
    const overview = await getMetaConnectionOverview(t.user.id, t.business.id, { config, keyring });
    expect(overview.accounts.map((account) => [account.state, account.reconnectable])).toEqual([["NOT_LINKED", false], ["NOT_LINKED", false], ["NOT_LINKED", false]]);
    expect(await getMetaAccountConnection(t.business.id, legacy.id)).toBeNull();
    expect(await getMetaAccountConnection(t.business.id, nullId.id)).toBeNull();
    await expect(prisma.socialAccount.create({ data: { businessId: t.business.id, platform: "INSTAGRAM", displayName: "Dup", externalAccountId: "demo-instagram-001" } })).rejects.toMatchObject({ code: "P2002" });
    expect(overview.configured).toBe(true);
    expect((await getMetaConnectionOverview(t.user.id, t.business.id, { config: null, keyring })).configured).toBe(false);
    await expect(getMetaConnectionOverview((await tenant()).user.id, t.business.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("P6-02 credential encryption", () => {
  it("round-trips with AES-GCM and fails closed for missing keys, tampering and other tenants", async () => {
    const aad = credentialAad({ purpose: "connection", businessId: "b1", subjectId: "s1", platform: "INSTAGRAM", providerAccountId: "1" });
    const encrypted = encryptCredential(keyring, "secret-value", aad);
    expect(Buffer.from(encrypted.ciphertext).toString("utf8")).not.toContain("secret-value");
    expect(decryptCredential(keyring, encrypted, aad)).toBe("secret-value");
    expect(encryptCredential(keyring, "secret-value", aad).nonce).not.toEqual(encrypted.nonce);
    const otherTenant = credentialAad({ purpose: "connection", businessId: "b2", subjectId: "s1", platform: "INSTAGRAM", providerAccountId: "1" });
    expect(() => decryptCredential(keyring, encrypted, otherTenant)).toThrow(DomainError);
    const tampered = { ...encrypted, ciphertext: new Uint8Array(encrypted.ciphertext.map((byte, index) => (index === 0 ? byte ^ 1 : byte))) };
    expect(() => decryptCredential(keyring, tampered, aad)).toThrow(DomainError);
    const otherKey = loadCredentialKeyring({ META_CREDENTIAL_KEY: randomBytes(32).toString("base64") })!;
    expect(() => decryptCredential(otherKey, encrypted, aad)).toThrow(DomainError);
    expect(loadCredentialKeyring({})).toBeNull();
    expect(() => loadCredentialKeyring({ META_CREDENTIAL_KEY: "short" })).toThrow(/32 bytes/);

    // Döndürme: eski anahtar yalnızca çözme için kalır.
    const rotated = loadCredentialKeyring({ META_CREDENTIAL_KEY: randomBytes(32).toString("base64"), META_CREDENTIAL_KEY_ID: "k2", META_CREDENTIAL_PREVIOUS_KEYS: `k1:${keyring.keys.get("k1")!.toString("base64")}` })!;
    expect(decryptCredential(rotated, encrypted, aad)).toBe("secret-value");
    expect(encryptCredential(rotated, "x", aad).keyId).toBe("k2");
  });

  it("binds stored credentials to their tenant/account when resolving the opaque handle", async () => {
    const a = await tenant();
    const b = await tenant();
    const { graph } = fakeGraph();
    await connect(a, ["a0:FACEBOOK"], graph);
    const account = await prisma.socialAccount.findFirstOrThrow({ where: { businessId: a.business.id } });
    const connection = (await getMetaAccountConnection(a.business.id, account.id))!;
    expect(await getMetaAccountConnection(b.business.id, account.id)).toBeNull();
    await expect(resolveMetaAccessToken({ ...connection, businessId: b.business.id }, { keyring })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Şifreli metin başka bir satıra kopyalansa da AAD uyuşmadığı için çözülemez.
    const bAccount = await prisma.socialAccount.create({ data: { businessId: b.business.id, platform: "FACEBOOK", displayName: "B", externalAccountId: "2002" } });
    const stolen = await prisma.metaConnection.findUniqueOrThrow({ where: { socialAccountId: account.id } });
    await prisma.metaConnection.create({ data: { businessId: b.business.id, socialAccountId: bAccount.id, platform: "FACEBOOK", providerAccountId: "2002", metaPageId: "2002", pageName: "B", connectedAt: new Date(), credentialRef: "mcred_copy", ciphertext: stolen.ciphertext, nonce: stolen.nonce, authTag: stolen.authTag, keyId: stolen.keyId } });
    await prisma.socialAccount.update({ where: { id: bAccount.id }, data: { status: "CONNECTED" } });
    const copied = (await getMetaAccountConnection(b.business.id, bAccount.id))!;
    await expect(resolveMetaAccessToken(copied, { keyring })).rejects.toBeInstanceOf(DomainError);
    await expect(resolveMetaAccessToken(connection, { keyring: null })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("P6-02 Graph client boundary", () => {
  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  it("paginates Page discovery with cursors, keeps tokens out of URLs and pins v26.0", async () => {
    const requests: Array<{ url: string; auth: string | null; method: string; body: string | null }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, auth: new Headers(init?.headers).get("authorization"), method: init?.method ?? "GET", body: init?.body ? String(init.body) : null });
      const after = new URL(url).searchParams.get("after");
      if (!after) return jsonResponse({ data: [{ id: "1001", name: "A", access_token: "PAGE-SECRET-TOKEN-1001", tasks: ["MANAGE"], instagram_business_account: { id: "178" } }], paging: { cursors: { after: "c1" }, next: "https://graph.facebook.com/v26.0/me/accounts?after=c1" } });
      return jsonResponse({ data: [{ id: "1002", name: "B", access_token: "PAGE-SECRET-TOKEN-1002", tasks: ["CREATE_CONTENT"] }, { id: "../evil", name: "X" }], paging: { cursors: { after: "c2" } } });
    });
    const client = createMetaGraphClient(config, fetchImpl as unknown as typeof fetch);
    const pages = await client.listPages(LONG_USER_TOKEN);
    expect(pages.map((page) => [page.id, page.instagramBusinessAccountId, page.tasks])).toEqual([["1001", "178", ["MANAGE"]], ["1002", null, ["CREATE_CONTENT"]]]);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url.startsWith("https://graph.facebook.com/v26.0/me/accounts?")).toBe(true);
      expect(request.url).not.toContain(LONG_USER_TOKEN);
      expect(request.url).toContain("appsecret_proof=");
      expect(request.auth).toBe(`Bearer ${LONG_USER_TOKEN}`);
    }
    expect(new URL(requests[0].url).searchParams.get("fields")).toBe("id,name,access_token,tasks,instagram_business_account");

    await client.exchangeCode(CODE).catch(() => undefined);
    const exchange = requests.at(-1)!;
    expect(exchange.method).toBe("POST");
    expect(exchange.url).toBe("https://graph.facebook.com/v26.0/oauth/access_token");
    expect(exchange.body).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fintegrations%2Fmeta%2Fcallback");
  });

  it("redacts provider errors and bounds response size and IDs", async () => {
    const errorFetch = vi.fn(async () => jsonResponse({ error: { message: `Invalid token ${LONG_USER_TOKEN}`, type: "OAuthException", code: 190, error_subcode: 460 } }, 400));
    const client = createMetaGraphClient(config, errorFetch as unknown as typeof fetch);
    const error = await client.listPages(LONG_USER_TOKEN).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MetaGraphError);
    expect((error as MetaGraphError).isInvalidToken).toBe(true);
    expect((error as MetaGraphError).details).toEqual({ httpStatus: 400, code: 190, subcode: 460, type: "OAuthException" });
    expectNoSecrets(`${(error as Error).message} ${JSON.stringify(error)} ${(error as Error).stack}`);

    const huge = vi.fn(async () => new Response("x".repeat(1024 * 1024 + 10), { status: 200 }));
    await expect(createMetaGraphClient(config, huge as unknown as typeof fetch).debugToken("t")).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
    const timeout = vi.fn(async () => { throw Object.assign(new Error(`timeout for ${LONG_USER_TOKEN}`), { name: "TimeoutError" }); });
    const timeoutError = await createMetaGraphClient(config, timeout as unknown as typeof fetch).debugToken(LONG_USER_TOKEN).catch((caught: unknown) => caught);
    expect(timeoutError).toMatchObject({ kind: "TIMEOUT" });
    expectNoSecrets((timeoutError as Error).message);
    await expect(createMetaGraphClient(config, vi.fn() as unknown as typeof fetch).getPage("1/../me", "t")).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
  });

  it("does not log provider credentials during a full connect flow", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
    const t = await tenant();
    await connect(t, ["a0:FACEBOOK", "a0:INSTAGRAM"], fakeGraph().graph);
    const { graph } = fakeGraph({ pageDebug: () => ({ isValid: false }) });
    await connect(t, ["a1:FACEBOOK"], graph).catch(() => undefined);
    for (const spy of spies) expectNoSecrets(JSON.stringify(spy.mock.calls));
  });
});
