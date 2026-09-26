import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import type { StorageProvider } from "@/lib/storage";
import { createContent, updateContentVariant } from "@/features/content/service";
import { approveContentVariant } from "@/features/approval/service";
import { scheduleContentVariant } from "@/features/publishing/service";
import { requestPublishIntent } from "@/features/publishing/intent";
import type { AccountConnection } from "@/features/publishing/adapter";
import { META_PUBLISH_SCOPES, META_REQUIRED_SCOPES, loadMetaConfig, type MetaConfig } from "@/features/meta-connection/config";
import { credentialAad, encryptCredential, loadCredentialKeyring } from "@/features/meta-connection/crypto";
import { MetaGraphError, createMetaGraphClient, createMetaPublishingClient, type MetaGraphClient, type MetaPublishingGraphClient, type MetaTokenDebug } from "@/features/meta-connection/graph-client";
import { disconnectMetaAccount, getMetaAccountConnection, getMetaConnectionOverview, resolveMetaAccessToken, startMetaConnection, verifyMetaPublishingCredential } from "@/features/meta-connection/service";
import { createMetaPublishingAdapter, composeProviderText } from "@/features/publishing/meta-adapter";
import { classifyMetaFailure } from "@/features/publishing/meta-result";
import { createSignedMediaUrl, loadMediaDeliveryConfig, resolveSignedMedia, type MediaDeliveryConfig } from "@/features/publishing/media-delivery";
import { publishNowErrorCode, publishScheduledPostNow, type PublishNowDeps } from "@/features/publishing/submission";
import { PUBLISH_NOW_MESSAGES, PUBLISH_STATUS_LABELS, publishStatusLabelKey } from "@/features/publishing/labels";
import { GET as mediaRoute } from "@/app/media/publish/[token]/route";

const APP_ID = "1234567890";
const APP_SECRET = "test-app-secret-p603";
const PAGE_ID = "1001";
const IG_ID = "17841400000000001";
const PAGE_TOKEN = "PAGE-SECRET-TOKEN-p603";
const DELIVERY_SECRET = "delivery-secret-0123456789abcdefghijklmnop";

const config = loadMetaConfig({ META_APP_ID: APP_ID, META_APP_SECRET: APP_SECRET, META_REDIRECT_URI: "http://localhost:3001/integrations/meta/callback", META_GRAPH_API_VERSION: "v26.0" }) as MetaConfig;
const keyring = loadCredentialKeyring({ META_CREDENTIAL_KEY: randomBytes(32).toString("base64"), META_CREDENTIAL_KEY_ID: "k1" })!;
const delivery = loadMediaDeliveryConfig({ MEDIA_DELIVERY_SECRET: DELIVERY_SECRET, PUBLIC_APP_URL: "https://publish.test" }) as MediaDeliveryConfig;
const ALL_SCOPES = [...META_REQUIRED_SCOPES, ...META_PUBLISH_SCOPES.INSTAGRAM, ...META_PUBLISH_SCOPES.FACEBOOK];

// ---------------------------------------------------------------------------------------------------------
// Deterministic fakes

class MemoryStorage implements StorageProvider {
  objects = new Map<string, Uint8Array>();
  async put(input: { key: string; bytes: Uint8Array }) {
    this.objects.set(input.key, input.bytes);
  }
  async get(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { key, bytes, contentType: "application/octet-stream" } : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

async function jpeg(width = 1080, height = 1350) {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } }).jpeg().toBuffer());
}
async function png(width = 1200, height = 1200) {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer());
}

type Call = { method: string; args: unknown[] };
type GraphBehavior = Partial<{ [K in keyof MetaPublishingGraphClient]: (...args: Parameters<MetaPublishingGraphClient[K]>) => ReturnType<MetaPublishingGraphClient[K]> }>;

function fakePublishingGraph(behavior: GraphBehavior = {}) {
  const calls: Call[] = [];
  const record = (method: string, args: unknown[], token: string) => {
    expect(token).toBe(PAGE_TOKEN);
    calls.push({ method, args });
  };
  const graph: MetaPublishingGraphClient = {
    async getContentPublishingLimit(ig, token) {
      record("limit", [ig], token);
      return behavior.getContentPublishingLimit ? behavior.getContentPublishingLimit(ig, token) : { usage: 3, total: 100 };
    },
    async createImageContainer(ig, input, token) {
      record("container", [ig, input], token);
      return behavior.createImageContainer ? behavior.createImageContainer(ig, input, token) : { containerId: "90000000001" };
    },
    async getContainerStatus(id, token) {
      record("status", [id], token);
      return behavior.getContainerStatus ? behavior.getContainerStatus(id, token) : "FINISHED";
    },
    async publishContainer(ig, id, token) {
      record("media_publish", [ig, id], token);
      return behavior.publishContainer ? behavior.publishContainer(ig, id, token) : { mediaId: "17900000000000009" };
    },
    async createFeedPost(page, message, token) {
      record("feed", [page, message], token);
      return behavior.createFeedPost ? behavior.createFeedPost(page, message, token) : { postId: `${PAGE_ID}_555` };
    },
    async createPagePhoto(page, input, token) {
      record("photos", [page, input], token);
      return behavior.createPagePhoto ? behavior.createPagePhoto(page, input, token) : { photoId: "777", postId: `${PAGE_ID}_777` };
    },
  };
  return { graph, calls, methods: () => calls.map((call) => call.method) };
}

function fakeDebugGraph(debug: Partial<MetaTokenDebug> | (() => Promise<MetaTokenDebug>) = {}) {
  let count = 0;
  const graph = {
    async debugToken(token: string) {
      count++;
      expect(token).toBe(PAGE_TOKEN);
      if (typeof debug === "function") return debug();
      return { appId: APP_ID, type: "PAGE", isValid: true, expiresAt: null, dataAccessExpiresAt: new Date(Date.now() + 80 * 86400_000), scopes: ALL_SCOPES, userId: "555", profileId: PAGE_ID, ...debug };
    },
  } as unknown as MetaGraphClient;
  return { graph, count: () => count };
}

function depsFor(storage: MemoryStorage, graph: MetaPublishingGraphClient, options: { debug?: Parameters<typeof fakeDebugGraph>[0]; overrides?: Partial<PublishNowDeps> } = {}) {
  const debug = fakeDebugGraph(options.debug);
  const adapter = createMetaPublishingAdapter({
    graph,
    resolveToken: (target) => resolveMetaAccessToken(target, { keyring }),
    storage,
    signMediaUrl: (binding) => createSignedMediaUrl(delivery, binding, new Date()),
    now: () => new Date(),
    sleep: async () => undefined,
    containerPoll: { attempts: 3, intervalMs: 0 },
  });
  const deps: Partial<PublishNowDeps> = {
    adapter,
    mediaDeliveryConfigured: true,
    verifyCredential: (connection, actor) => verifyMetaPublishingCredential(connection, actor, { config, keyring, graph: debug.graph }),
    ...options.overrides,
  };
  return { deps, debug };
}

// ---------------------------------------------------------------------------------------------------------
// Fixtures

type Platform = "INSTAGRAM" | "FACEBOOK";

async function connectAccount(businessId: string, platform: Platform, options: { scopes?: string[]; tasks?: string[]; providerAccountId?: string } = {}) {
  const providerAccountId = options.providerAccountId ?? (platform === "INSTAGRAM" ? IG_ID : PAGE_ID);
  const account = await prisma.socialAccount.create({ data: { businessId, platform, displayName: platform === "INSTAGRAM" ? "@mimoza" : "Mimoza Bodrum", externalAccountId: providerAccountId, status: "CONNECTED" } });
  const encrypted = encryptCredential(keyring, PAGE_TOKEN, credentialAad({ purpose: "connection", businessId, subjectId: account.id, platform, providerAccountId }));
  await prisma.metaConnection.create({
    data: {
      businessId,
      socialAccountId: account.id,
      platform,
      providerAccountId,
      metaPageId: PAGE_ID,
      instagramAccountId: platform === "INSTAGRAM" ? providerAccountId : IG_ID,
      pageName: "Mimoza Bodrum",
      instagramUsername: "mimoza",
      grantedScopes: options.scopes ?? ALL_SCOPES,
      pageTasks: options.tasks ?? ["MANAGE", "CREATE_CONTENT"],
      tokenType: "PAGE",
      credentialRef: `mcred_${randomBytes(12).toString("base64url")}`,
      ...encrypted,
      connectedAt: new Date(),
      lastValidatedAt: new Date(),
    },
  });
  return account;
}

type FixtureOptions = {
  platform?: Platform;
  media?: "jpeg" | "png" | "tall-jpeg" | "none";
  contentType?: "POST" | "REEL";
  caption?: string;
  cta?: string | null;
  due?: boolean;
};

async function fixture(options: FixtureOptions & { providerAccountId?: string } = {}) {
  const platform = options.platform ?? "INSTAGRAM";
  const storage = new MemoryStorage();
  const owner = await prisma.user.create({ data: { name: "Owner", email: `owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const member = await prisma.user.create({ data: { name: "Member", email: `member-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `outside-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({ data: { name: "Mimoza", sector: "RESTAURANT", memberships: { create: [{ userId: owner.id, role: "OWNER" }, { userId: member.id, role: "MEMBER" }] } } });
  const otherBusiness = await prisma.business.create({ data: { name: "Other", sector: "HOTEL", memberships: { create: { userId: outsider.id, role: "OWNER" } } } });
  const account = await connectAccount(business.id, platform, { providerAccountId: options.providerAccountId });

  let mediaAssetId: string | null = null;
  const kind = options.media ?? (platform === "INSTAGRAM" ? "jpeg" : "none");
  if (kind !== "none") {
    const bytes = kind === "png" ? await png() : kind === "tall-jpeg" ? await jpeg(1080, 1920) : await jpeg();
    const mimeType = kind === "png" ? "image/png" : "image/jpeg";
    const storageKey = `${business.id}/asset-${crypto.randomUUID()}.${kind === "png" ? "png" : "jpg"}`;
    await storage.put({ key: storageKey, bytes });
    const media = await prisma.mediaAsset.create({ data: { businessId: business.id, originalFilename: "steak", mimeType, size: bytes.byteLength, width: 1080, height: 1350, storageKey } });
    mediaAssetId = media.id;
  }
  const content = await createContent(owner.id, business.id, {
    title: "Friday Steak",
    topic: "Reservation",
    contentType: options.contentType ?? "POST",
    platform,
    caption: options.caption ?? "Cuma akşamı dana antrikot.",
    cta: options.cta === undefined ? "Rezervasyon için arayın." : options.cta,
    language: "tr",
    mediaAssetId,
  });
  const variant = content.variants[0];
  await approveContentVariant(owner.id, variant.id);
  const due = options.due ?? true;
  const scheduledAt = due ? new Date(Date.now() - 60_000) : new Date(Date.now() + 24 * 3600_000);
  const post = await scheduleContentVariant(owner.id, variant.id, { socialAccountId: account.id, scheduledAt, expectedVersion: 1 }, new Date(scheduledAt.getTime() - 60_000));
  return { storage, owner, member, outsider, business, otherBusiness, account, variant, content, post, mediaAssetId };
}

/** Aynı Meta varlığı iki işletmede canlı eşlenemez (P6-02 kısmi benzersiz indeks); döngülü testlerde sıfırla. */
const reset = () => prisma.$executeRawUnsafe(`TRUNCATE TABLE "User", "Business" CASCADE`);

const intentOf = (postId: string) => prisma.publishIntent.findFirstOrThrow({ where: { scheduledPostId: postId } });
const attemptsOf = (postId: string) => prisma.publishAttempt.findMany({ where: { scheduledPostId: postId }, orderBy: { attemptNumber: "asc" } });

async function expectPublishError(promise: Promise<unknown>, code: keyof typeof PUBLISH_NOW_MESSAGES) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  expect(publishNowErrorCode(error)).toBe(code);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------

describe("P6-03 confirmed publication", () => {
  it("publishes an Instagram JPEG through /media → status → /media_publish, persisting the container before publish", async () => {
    const f = await fixture();
    let fetched: Uint8Array | null = null;
    let containerSeenBeforePublish: string | null = null;
    const { graph, calls, methods } = fakePublishingGraph({
      async createImageContainer(_ig, input) {
        // Meta, image_url'yi çerezsiz çeker: imzalı URL tam dondurulmuş JPEG'i vermeli.
        expect(input.imageUrl).toMatch(/^https:\/\/publish\.test\/media\/publish\/[a-z0-9]+\.\d{10}\.[A-Za-z0-9_-]{43}$/);
        const token = input.imageUrl.split("/").pop()!;
        fetched = (await resolveSignedMedia(token, { config: delivery, storage: f.storage }))?.bytes ?? null;
        return { containerId: "90000000001" };
      },
      async publishContainer() {
        const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { scheduledPostId: f.post.id } });
        containerSeenBeforePublish = attempt.providerContainerId;
        return { mediaId: "17900000000000009" };
      },
    });
    const { deps } = depsFor(f.storage, graph);
    const result = await publishScheduledPostNow(f.member.id, f.post.id, 1, deps);

    expect(result).toMatchObject({ state: "PUBLISHED", dispatched: true });
    expect(methods()).toEqual(["limit", "container", "status", "media_publish"]);
    expect(calls[1].args[0]).toBe(IG_ID);
    expect((calls[1].args[1] as { caption: string }).caption).toBe("Cuma akşamı dana antrikot.\n\nRezervasyon için arayın.");
    expect(calls[3].args).toEqual([IG_ID, "90000000001"]);
    expect(containerSeenBeforePublish).toBe("90000000001");
    expect(Buffer.from(fetched!).equals(Buffer.from(f.storage.objects.values().next().value!))).toBe(true);

    const intent = await intentOf(f.post.id);
    expect(intent).toMatchObject({ state: "PUBLISHED", providerReference: "17900000000000009", leaseExpiresAt: null });
    expect(intent.publishedAt).toBeInstanceOf(Date);
    const [attempt] = await attemptsOf(f.post.id);
    expect(attempt).toMatchObject({ attemptNumber: 1, status: "SUCCESS", outcome: "PUBLISHED", providerReference: "17900000000000009", providerContainerId: "90000000001", adapterKey: "meta-native", adapterVersion: 1 });
    expect(intent.currentAttemptId).toBe(attempt.id);
    expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: f.post.id } })).status).toBe("PUBLISHED");
    // Deneme sonuçlandıktan sonra imzalı URL artık çalışmaz (geri alınmış sayılır).
    expect(await resolveSignedMedia(((calls[1].args[1] as { imageUrl: string }).imageUrl).split("/").pop()!, { config: delivery, storage: f.storage })).toBeNull();
  });

  it("publishes a Facebook Page text post through /feed", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph, calls, methods } = fakePublishingGraph();
    const result = await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps);
    expect(result.state).toBe("PUBLISHED");
    expect(methods()).toEqual(["feed"]);
    expect(calls[0].args).toEqual([PAGE_ID, "Cuma akşamı dana antrikot.\n\nRezervasyon için arayın."]);
    expect(await intentOf(f.post.id)).toMatchObject({ state: "PUBLISHED", providerReference: `${PAGE_ID}_555` });
  });

  it("publishes a Facebook Page single PNG photo by uploading the private bytes to /photos", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "png" });
    const { graph, calls, methods } = fakePublishingGraph();
    const result = await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps);
    expect(result.state).toBe("PUBLISHED");
    expect(methods()).toEqual(["photos"]);
    const input = calls[0].args[1] as { bytes: Uint8Array; mimeType: string; caption: string };
    expect(input.mimeType).toBe("image/png");
    expect(Buffer.from(input.bytes).equals(Buffer.from(f.storage.objects.values().next().value!))).toBe(true);
    expect(await intentOf(f.post.id)).toMatchObject({ state: "PUBLISHED", providerReference: `${PAGE_ID}_777` });
  });

  it("uses the immutable snapshot even if the current variant row changed afterwards", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    await requestPublishIntent(f.owner.id, f.post.id, 1);
    // Sürüm artırılmadan değişen mutable alan (ör. doğrudan veri düzeltmesi) yüke girmez.
    await prisma.contentVariant.update({ where: { id: f.variant.id }, data: { caption: "MUTABLE CURRENT CAPTION", cta: null } });
    const { graph, calls } = fakePublishingGraph();
    await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps);
    expect(calls[0].args[1]).toBe("Cuma akşamı dana antrikot.\n\nRezervasyon için arayın.");
  });

  it("refuses a post whose content was edited after approval (intent invalidated) without provider calls", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    await requestPublishIntent(f.owner.id, f.post.id, 1);
    await updateContentVariant(f.owner.id, f.variant.id, { caption: "Edited", cta: null, language: "tr", mediaAssetId: null, aspectRatio: null });
    const { graph, calls } = fakePublishingGraph();
    const result = await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps);
    expect(result.state).toBe("INVALIDATED");
    expect(calls).toHaveLength(0);
  });
});

describe("P6-03 authorization, approval and target validation", () => {
  it("rejects another tenant's user and unapproved content without creating an intent or calling Meta", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph, calls } = fakePublishingGraph();
    const { deps, debug } = depsFor(f.storage, graph);
    await expect(publishScheduledPostNow(f.outsider.id, f.post.id, 1, deps)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.approval.deleteMany({ where: { contentVariantId: f.variant.id } });
    await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, deps), "NOT_PUBLISHABLE");
    await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 7, deps), "NOT_PUBLISHABLE");
    expect(await prisma.publishIntent.count()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(debug.count()).toBe(0);
  });

  it("never dispatches a future schedule", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none", due: false });
    const { graph, calls } = fakePublishingGraph();
    await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps), "NOT_DUE");
    expect(await prisma.publishIntent.count()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("rejects account/business/platform mismatches between the snapshot and the resolved connection", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph, calls } = fakePublishingGraph();
    const other = await connectAccount(f.otherBusiness.id, "FACEBOOK", { providerAccountId: "2002" });
    const foreign = (await getMetaAccountConnection(f.otherBusiness.id, other.id))!;
    const own = (await getMetaAccountConnection(f.business.id, f.account.id))!;
    const forged: AccountConnection[] = [
      foreign,
      { ...own, externalAccountId: "999999" },
      { ...own, platform: "INSTAGRAM" },
      { ...own, businessId: f.otherBusiness.id },
    ];
    for (const connection of forged) {
      await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph, { overrides: { resolveConnection: async () => connection } }).deps), "ACCOUNT_NOT_CONNECTED");
    }
    // Planlı postun hesabı intent'ten sonra değiştirilse bile hedef yeniden yönlendirilemez.
    const second = await connectAccount(f.business.id, "FACEBOOK", { providerAccountId: "3003" });
    await prisma.scheduledPost.update({ where: { id: f.post.id }, data: { socialAccountId: second.id } });
    await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps), "NOT_PUBLISHABLE");
    expect(calls).toHaveLength(0);
    expect((await intentOf(f.post.id)).state).toBe("PENDING");
  });

  it("rejects disconnected, reauth-required, legacy status-only and credential-less accounts", async () => {
    const { graph, calls } = fakePublishingGraph();

    const disconnected = await fixture({ platform: "FACEBOOK", media: "none" });
    await disconnectMetaAccount(disconnected.owner.id, disconnected.account.id);
    await expectPublishError(publishScheduledPostNow(disconnected.owner.id, disconnected.post.id, 1, depsFor(disconnected.storage, graph).deps), "ACCOUNT_NOT_CONNECTED");

    await reset();
    const reauth = await fixture({ platform: "FACEBOOK", media: "none" });
    await prisma.metaConnection.update({ where: { socialAccountId: reauth.account.id }, data: { reauthRequiredAt: new Date() } });
    await expectPublishError(publishScheduledPostNow(reauth.owner.id, reauth.post.id, 1, depsFor(reauth.storage, graph).deps), "ACCOUNT_NOT_CONNECTED");

    // SocialAccount.status=CONNECTED tek başına yeterli değil.
    await reset();
    const legacy = await fixture({ platform: "FACEBOOK", media: "none" });
    await prisma.metaConnection.delete({ where: { socialAccountId: legacy.account.id } });
    await expectPublishError(publishScheduledPostNow(legacy.owner.id, legacy.post.id, 1, depsFor(legacy.storage, graph).deps), "ACCOUNT_NOT_CONNECTED");

    await reset();
    const missing = await fixture({ platform: "FACEBOOK", media: "none" });
    await prisma.metaConnection.update({ where: { socialAccountId: missing.account.id }, data: { credentialRef: null, ciphertext: null, nonce: null, authTag: null, keyId: null } });
    await expectPublishError(publishScheduledPostNow(missing.owner.id, missing.post.id, 1, depsFor(missing.storage, graph).deps), "ACCOUNT_NOT_CONNECTED");

    expect(calls).toHaveLength(0);
    expect(await prisma.publishAttempt.count()).toBe(0);
  });

  it("revalidates the real credential before submission: invalid, expired, revoked and under-scoped tokens stop dispatch", async () => {
    const cases: Array<{ debug: Parameters<typeof fakeDebugGraph>[0]; code: keyof typeof PUBLISH_NOW_MESSAGES; cleared: boolean }> = [
      { debug: { isValid: false }, code: "ACCOUNT_NOT_CONNECTED", cleared: true },
      { debug: { expiresAt: new Date(Date.now() - 1000) }, code: "ACCOUNT_NOT_CONNECTED", cleared: true },
      { debug: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 190 }); }, code: "ACCOUNT_NOT_CONNECTED", cleared: true },
      { debug: { profileId: "4040" }, code: "ACCOUNT_NOT_CONNECTED", cleared: true },
      { debug: { scopes: ["pages_show_list", "pages_manage_posts"] }, code: "ACCOUNT_NOT_CONNECTED", cleared: true },
      // Yayın izni eksik: bağlantı silinmez, yalnızca gönderim durur.
      { debug: { scopes: [...META_REQUIRED_SCOPES] }, code: "PUBLISH_PERMISSION_MISSING", cleared: false },
      { debug: async () => { throw new MetaGraphError("TIMEOUT"); }, code: "PROVIDER_UNAVAILABLE", cleared: false },
    ];
    for (const testCase of cases) {
      await reset();
      const f = await fixture({ platform: "FACEBOOK", media: "none" });
      const { graph, calls } = fakePublishingGraph();
      const { deps, debug } = depsFor(f.storage, graph, { debug: testCase.debug });
      await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, deps), testCase.code);
      expect(debug.count()).toBe(1);
      expect(calls).toHaveLength(0);
      expect(await prisma.publishAttempt.count({ where: { scheduledPostId: f.post.id } })).toBe(0);
      expect((await intentOf(f.post.id)).state).toBe("PENDING");
      const connection = await prisma.metaConnection.findUniqueOrThrow({ where: { socialAccountId: f.account.id } });
      expect(connection.credentialRef === null).toBe(testCase.cleared);
      if (testCase.cleared) expect(connection.reauthRequiredAt).toBeInstanceOf(Date);
    }
  });

  it("checks the Instagram publishing permission and the Page content task explicitly", async () => {
    const f = await fixture();
    const { graph, calls } = fakePublishingGraph();
    await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph, { debug: { scopes: [...META_REQUIRED_SCOPES, "pages_manage_posts"] } }).deps), "PUBLISH_PERMISSION_MISSING");
    await prisma.metaConnection.update({ where: { socialAccountId: f.account.id }, data: { pageTasks: ["MODERATE", "ANALYZE"] } });
    await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps), "PAGE_TASK_MISSING");
    expect(calls).toHaveLength(0);
  });

  it("refuses when Meta publishing or Instagram media delivery is not configured", async () => {
    const f = await fixture();
    const { graph, calls } = fakePublishingGraph();
    await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph, { overrides: { adapter: null } }).deps), "NOT_CONFIGURED");
    await expectPublishError(publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph, { overrides: { mediaDeliveryConfigured: false } }).deps), "NOT_CONFIGURED");
    expect(calls).toHaveLength(0);
  });
});

describe("P6-03 media and format rules", () => {
  it("rejects unsupported formats before any provider call", async () => {
    const cases: Array<{ options: FixtureOptions; errorCode: string }> = [
      { options: { platform: "INSTAGRAM", media: "png" }, errorCode: "MEDIA_UNSUPPORTED" },
      { options: { platform: "INSTAGRAM", media: "none" }, errorCode: "MEDIA_REQUIRED" },
      { options: { platform: "INSTAGRAM", media: "tall-jpeg" }, errorCode: "MEDIA_ASPECT_RATIO" },
      { options: { platform: "INSTAGRAM", contentType: "REEL" }, errorCode: "UNSUPPORTED_FORMAT" },
      { options: { platform: "INSTAGRAM", caption: "a".repeat(2190), cta: "Rezervasyon için arayın." }, errorCode: "TEXT_TOO_LONG" },
    ];
    for (const testCase of cases) {
      await reset();
      const f = await fixture(testCase.options);
      const { graph, calls } = fakePublishingGraph();
      const result = await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps);
      expect(result.state).toBe("FAILED");
      expect(calls).toHaveLength(0);
      const [attempt] = await attemptsOf(f.post.id);
      expect(attempt).toMatchObject({ status: "FAILED", outcome: "PERMANENT_REJECTION", errorCode: testCase.errorCode });
    }
  });

  it("rejects missing bytes and foreign-tenant or deleted media lineage", async () => {
    const missing = await fixture();
    missing.storage.objects.clear();
    const { graph, calls } = fakePublishingGraph();
    expect((await publishScheduledPostNow(missing.owner.id, missing.post.id, 1, depsFor(missing.storage, graph).deps)).state).toBe("FAILED");
    expect((await attemptsOf(missing.post.id))[0].errorCode).toBe("MEDIA_MISSING");

    await reset();
    const foreign = await fixture();
    await prisma.mediaAsset.update({ where: { id: foreign.mediaAssetId! }, data: { businessId: foreign.otherBusiness.id } });
    await expectPublishError(publishScheduledPostNow(foreign.owner.id, foreign.post.id, 1, depsFor(foreign.storage, graph).deps), "MEDIA_INVALID");

    // Intent zaten varken soy bozulursa (medya satırı başka kiracıya taşındı veya depo anahtarı değişti) yine gönderilmez.
    await reset();
    const later = await fixture();
    await requestPublishIntent(later.owner.id, later.post.id, 1);
    await prisma.mediaAsset.update({ where: { id: later.mediaAssetId! }, data: { businessId: later.otherBusiness.id } });
    await expectPublishError(publishScheduledPostNow(later.owner.id, later.post.id, 1, depsFor(later.storage, graph).deps), "MEDIA_INVALID");
    await prisma.mediaAsset.update({ where: { id: later.mediaAssetId! }, data: { businessId: later.business.id, storageKey: `${later.business.id}/replaced.jpg` } });
    await expectPublishError(publishScheduledPostNow(later.owner.id, later.post.id, 1, depsFor(later.storage, graph).deps), "MEDIA_INVALID");
    expect(calls).toHaveLength(0);
  });

  it("composes caption and CTA deterministically without truncation", () => {
    const base = { content: { caption: "  Altyazı  ", cta: " CTA " } } as Parameters<typeof composeProviderText>[0];
    expect(composeProviderText(base)).toBe("Altyazı\n\nCTA");
    expect(composeProviderText({ content: { caption: "Altyazı", cta: null } } as Parameters<typeof composeProviderText>[0])).toBe("Altyazı");
  });
});

describe("P6-03 outcomes, idempotency and uncertainty", () => {
  it("treats a duplicate click after publication as a no-op", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph, calls } = fakePublishingGraph();
    const { deps } = depsFor(f.storage, graph);
    await publishScheduledPostNow(f.owner.id, f.post.id, 1, deps);
    const again = await publishScheduledPostNow(f.owner.id, f.post.id, 1, deps);
    expect(again).toMatchObject({ state: "PUBLISHED", dispatched: false });
    expect(calls).toHaveLength(1);
    expect(await attemptsOf(f.post.id)).toHaveLength(1);
  });

  it("returns IN_FLIGHT to a click that arrives while the provider call is running", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    let release!: () => void;
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { graph, calls } = fakePublishingGraph({
      async createFeedPost() {
        entered();
        await gate;
        return { postId: `${PAGE_ID}_901` };
      },
    });
    const { deps } = depsFor(f.storage, graph);
    const first = publishScheduledPostNow(f.owner.id, f.post.id, 1, deps);
    await inside;
    // Meta çağrısı sürerken hiçbir veritabanı işlemi açık değil: ikinci istek hemen yanıtlanır.
    const second = await publishScheduledPostNow(f.member.id, f.post.id, 1, deps);
    expect(second).toMatchObject({ state: "IN_FLIGHT", dispatched: false });
    release();
    expect((await first).state).toBe("PUBLISHED");
    expect(calls).toHaveLength(1);
  });

  it("does not duplicate provider submission under concurrent execution", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph, calls } = fakePublishingGraph();
    const { deps } = depsFor(f.storage, graph);
    const results = await Promise.all([1, 2, 3, 4].map(() => publishScheduledPostNow(f.owner.id, f.post.id, 1, deps).catch((error) => error)));
    expect(calls.filter((call) => call.method === "feed")).toHaveLength(1);
    expect(await attemptsOf(f.post.id)).toHaveLength(1);
    expect(results.filter((result) => result?.dispatched === true)).toHaveLength(1);
    expect((await intentOf(f.post.id)).state).toBe("PUBLISHED");
  });

  it("turns a publish timeout into UNKNOWN, keeps the container reference and never resubmits", async () => {
    const f = await fixture();
    const { graph, methods } = fakePublishingGraph({ publishContainer: async () => { throw new MetaGraphError("TIMEOUT"); } });
    const { deps } = depsFor(f.storage, graph);
    const result = await publishScheduledPostNow(f.owner.id, f.post.id, 1, deps);
    expect(result.state).toBe("UNKNOWN");
    const [attempt] = await attemptsOf(f.post.id);
    expect(attempt).toMatchObject({ status: "UNKNOWN", outcome: "UNKNOWN", errorCode: "TIMEOUT", providerContainerId: "90000000001", providerReference: null });
    expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: f.post.id } })).status).toBe("SCHEDULED");

    const again = await publishScheduledPostNow(f.owner.id, f.post.id, 1, deps);
    expect(again).toMatchObject({ state: "UNKNOWN", dispatched: false });
    expect(methods().filter((method) => method === "media_publish")).toHaveLength(1);
    expect(await attemptsOf(f.post.id)).toHaveLength(1);
  });

  it("treats ambiguous provider responses as UNKNOWN, never PUBLISHED", async () => {
    const ambiguous: Array<() => Promise<{ postId: string }>> = [
      async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 500, code: 2 }); },
      async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 503 }); },
      async () => { throw new MetaGraphError("INVALID_RESPONSE", { httpStatus: 200 }); },
      async () => { throw new MetaGraphError("TRANSPORT"); },
    ];
    for (const createFeedPost of ambiguous) {
      await reset();
      const f = await fixture({ platform: "FACEBOOK", media: "none" });
      const { graph } = fakePublishingGraph({ createFeedPost });
      expect((await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps)).state).toBe("UNKNOWN");
      expect((await intentOf(f.post.id)).providerReference).toBeNull();
    }
  });

  it("does not treat a finished or already-published container as publication", async () => {
    const finished = await fixture();
    const { graph: g1 } = fakePublishingGraph({ publishContainer: async () => { throw new MetaGraphError("INVALID_RESPONSE", { httpStatus: 200 }); } });
    expect((await publishScheduledPostNow(finished.owner.id, finished.post.id, 1, depsFor(finished.storage, g1).deps)).state).toBe("UNKNOWN");

    await reset();
    const weird = await fixture();
    const { graph: g2, methods } = fakePublishingGraph({ getContainerStatus: async () => "PUBLISHED" });
    expect((await publishScheduledPostNow(weird.owner.id, weird.post.id, 1, depsFor(weird.storage, g2).deps)).state).toBe("UNKNOWN");
    expect(methods()).not.toContain("media_publish");
  });

  it("marks permanent provider rejections FAILED and a revoked token as reauthorization required", async () => {
    const invalid = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph: g1 } = fakePublishingGraph({ createFeedPost: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 100, traceId: "AbC123_trace" }); } });
    expect((await publishScheduledPostNow(invalid.owner.id, invalid.post.id, 1, depsFor(invalid.storage, g1).deps)).state).toBe("FAILED");
    const [attempt] = await attemptsOf(invalid.post.id);
    expect(attempt).toMatchObject({ status: "FAILED", outcome: "PERMANENT_REJECTION", errorCode: "PROVIDER_REJECTED" });
    expect(attempt.diagnostics).toEqual({ code: "META_PROVIDER_100", httpStatus: 400, providerRequestId: "AbC123_trace" });
    expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: invalid.post.id } })).status).toBe("FAILED");

    await reset();
    const revoked = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph: g2 } = fakePublishingGraph({ createFeedPost: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 190 }); } });
    expect((await publishScheduledPostNow(revoked.owner.id, revoked.post.id, 1, depsFor(revoked.storage, g2).deps)).state).toBe("FAILED");
    const connection = await prisma.metaConnection.findUniqueOrThrow({ where: { socialAccountId: revoked.account.id } });
    expect(connection.credentialRef).toBeNull();
    expect(connection.reauthRequiredAt).toBeInstanceOf(Date);
  });

  it("treats definite retryable pre-acceptance failures as RETRY_WAIT and lets an explicit retry publish", async () => {
    const f = await fixture();
    let fail = true;
    const { graph, methods } = fakePublishingGraph({
      async createImageContainer() {
        if (fail) throw new MetaGraphError("TIMEOUT");
        return { containerId: "90000000002" };
      },
    });
    const { deps } = depsFor(f.storage, graph);
    expect((await publishScheduledPostNow(f.owner.id, f.post.id, 1, deps)).state).toBe("RETRY_WAIT");
    expect(methods()).not.toContain("media_publish");
    expect((await attemptsOf(f.post.id))[0]).toMatchObject({ status: "FAILED", outcome: "RETRYABLE_REJECTION" });

    fail = false;
    expect((await publishScheduledPostNow(f.owner.id, f.post.id, 1, deps)).state).toBe("PUBLISHED");
    const attempts = await attemptsOf(f.post.id);
    expect(attempts.map((attempt) => [attempt.attemptNumber, attempt.status])).toEqual([[1, "FAILED"], [2, "SUCCESS"]]);

    await reset();
    const limited = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph: g2 } = fakePublishingGraph({ createFeedPost: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 4 }); } });
    expect((await publishScheduledPostNow(limited.owner.id, limited.post.id, 1, depsFor(limited.storage, g2).deps)).state).toBe("RETRY_WAIT");

    await reset();
    const quota = await fixture();
    const { graph: g3, methods: m3 } = fakePublishingGraph({ getContentPublishingLimit: async () => ({ usage: 100, total: 100 }) });
    expect((await publishScheduledPostNow(quota.owner.id, quota.post.id, 1, depsFor(quota.storage, g3).deps)).state).toBe("RETRY_WAIT");
    expect(m3()).toEqual(["limit"]);

    await reset();
    const notReady = await fixture();
    const { graph: g4, methods: m4 } = fakePublishingGraph({ getContainerStatus: async () => "IN_PROGRESS" });
    expect((await publishScheduledPostNow(notReady.owner.id, notReady.post.id, 1, depsFor(notReady.storage, g4).deps)).state).toBe("RETRY_WAIT");
    expect(m4()).not.toContain("media_publish");
  });

  it("recovers an expired lease (process crash) as UNKNOWN without resending", async () => {
    const f = await fixture({ platform: "FACEBOOK", media: "none" });
    const intent = await requestPublishIntent(f.owner.id, f.post.id, 1);
    const attempt = await prisma.publishAttempt.create({ data: { scheduledPostId: f.post.id, publishIntentId: intent.id, attemptNumber: 1, status: "PENDING", adapterKey: "meta-native", adapterVersion: 1 } });
    await prisma.publishIntent.update({ where: { id: intent.id }, data: { state: "IN_FLIGHT", leaseExpiresAt: new Date(Date.now() - 1000), currentAttemptId: attempt.id } });
    expect(publishStatusLabelKey(await intentOf(f.post.id))).toBe("UNKNOWN");

    const { graph, calls } = fakePublishingGraph();
    const result = await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps);
    expect(result).toMatchObject({ state: "UNKNOWN", dispatched: false });
    expect(calls).toHaveLength(0);
    expect((await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps)).state).toBe("UNKNOWN");
    expect(calls).toHaveLength(0);
    expect(await attemptsOf(f.post.id)).toHaveLength(1);
  });

  it("stops before media_publish when the source is edited while the container is being created", async () => {
    const f = await fixture();
    const { graph, methods } = fakePublishingGraph({
      async createImageContainer() {
        await updateContentVariant(f.owner.id, f.variant.id, { caption: "Edited mid-flight", cta: null, language: "tr", mediaAssetId: f.mediaAssetId, aspectRatio: null });
        return { containerId: "90000000003" };
      },
    });
    const result = await publishScheduledPostNow(f.owner.id, f.post.id, 1, depsFor(f.storage, graph).deps);
    expect(result.state).toBe("UNKNOWN");
    expect(methods()).not.toContain("media_publish");
    const [attempt] = await attemptsOf(f.post.id);
    expect(attempt).toMatchObject({ status: "FAILED", errorCode: "CLAIM_LOST_BEFORE_PUBLISH", providerContainerId: "90000000003" });
  });
});

describe("P6-03 signed Instagram media delivery", () => {
  async function inFlightInstagram(providerAccountId?: string) {
    const f = await fixture({ providerAccountId });
    const intent = await requestPublishIntent(f.owner.id, f.post.id, 1);
    const attempt = await prisma.publishAttempt.create({ data: { scheduledPostId: f.post.id, publishIntentId: intent.id, attemptNumber: 1, status: "PENDING" } });
    await prisma.publishIntent.update({ where: { id: intent.id }, data: { state: "IN_FLIGHT", leaseExpiresAt: new Date(Date.now() + 60_000), currentAttemptId: attempt.id } });
    const binding = { attemptId: attempt.id, intentId: intent.id, businessId: f.business.id, mediaAssetId: f.mediaAssetId!, storageKey: [...f.storage.objects.keys()][0] };
    return { ...f, intent, attempt, binding };
  }
  const tokenOf = (url: string) => url.split("/").pop()!;

  it("serves only the exact frozen JPEG while the attempt holds the lease, and rejects expiry, tampering and cross-tenant reuse", async () => {
    const a = await inFlightInstagram();
    const now = new Date();
    const url = createSignedMediaUrl(delivery, a.binding, now);
    expect(await resolveSignedMedia(tokenOf(url), { config: delivery, storage: a.storage, now })).not.toBeNull();

    // Süre dolumu
    expect(await resolveSignedMedia(tokenOf(url), { config: delivery, storage: a.storage, now: new Date(now.getTime() + 16 * 60_000) })).toBeNull();
    // İmza/kimlik/süre kurcalama
    const [id, exp, sig] = tokenOf(url).split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    for (const forged of [`${id}.${exp}.${flipped}`, `${id}.${Number(exp) + 60}.${sig}`, `${id}x.${exp}.${sig}`, `../${id}.${exp}.${sig}`, ""]) {
      expect(await resolveSignedMedia(forged, { config: delivery, storage: a.storage, now })).toBeNull();
    }
    // Başka anahtarla imzalanmış jeton
    const otherKey = { ...delivery, secret: "another-secret-0123456789abcdefghijklmnop" };
    expect(await resolveSignedMedia(tokenOf(createSignedMediaUrl(otherKey, a.binding, now)), { config: delivery, storage: a.storage, now })).toBeNull();
    // Başka kiracının medyasına bağlama: imza DB'den türetilen bağlamla eşleşmez.
    const b = await inFlightInstagram("17841400000000077");
    const crossed = createSignedMediaUrl(delivery, { ...a.binding, mediaAssetId: b.binding.mediaAssetId, storageKey: b.binding.storageKey, businessId: b.business.id }, now);
    expect(await resolveSignedMedia(tokenOf(crossed), { config: delivery, storage: a.storage, now })).toBeNull();
    // Deneme artık kiralamayı tutmuyorsa (sonuçlandı) URL geri alınmıştır.
    await prisma.publishAttempt.update({ where: { id: a.attempt.id }, data: { status: "UNKNOWN" } });
    expect(await resolveSignedMedia(tokenOf(url), { config: delivery, storage: a.storage, now })).toBeNull();
  });

  it("route returns 404 without echoing the token and requires production HTTPS configuration", async () => {
    const response = await mediaRoute(new Request("https://publish.test/media/publish/x"), { params: Promise.resolve({ token: "abcdefghij.1234567890.secret-looking-signature" }) });
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("secret-looking-signature");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(() => loadMediaDeliveryConfig({ MEDIA_DELIVERY_SECRET: DELIVERY_SECRET, PUBLIC_APP_URL: "http://publish.example" })).toThrow();
    expect(() => loadMediaDeliveryConfig({ MEDIA_DELIVERY_SECRET: "short", PUBLIC_APP_URL: "https://publish.example" })).toThrow();
    expect(() => loadMediaDeliveryConfig({ MEDIA_DELIVERY_SECRET: DELIVERY_SECRET })).toThrow();
    expect(loadMediaDeliveryConfig({})).toBeNull();
  });
});

describe("P6-03 publishing authorization path and classification", () => {
  it("requests only the target platform's publish permission through an explicit reconnect", async () => {
    const f = await fixture();
    const session = await prisma.session.create({ data: { userId: f.owner.id, tokenHash: `hash-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    const graph = createMetaGraphClient(config, vi.fn());
    const overrides = { config, keyring, graph };
    const ig = await startMetaConnection({ userId: f.owner.id, sessionId: session.id }, f.business.id, { reconnectSocialAccountId: f.account.id, requestPublishing: true }, overrides);
    const scope = new URL(ig.authorizeUrl).searchParams.get("scope")!.split(",");
    expect(scope).toEqual([...META_REQUIRED_SCOPES, "instagram_content_publish"]);
    expect(new URL(ig.authorizeUrl).searchParams.get("auth_type")).toBe("rerequest");
    const fb = await connectAccount(f.business.id, "FACEBOOK");
    const fbStart = await startMetaConnection({ userId: f.owner.id, sessionId: session.id }, f.business.id, { reconnectSocialAccountId: fb.id, requestPublishing: true }, overrides);
    expect(new URL(fbStart.authorizeUrl).searchParams.get("scope")!.split(",")).toEqual([...META_REQUIRED_SCOPES, "pages_manage_posts"]);
    await expect(startMetaConnection({ userId: f.owner.id, sessionId: session.id }, f.business.id, { requestPublishing: true }, overrides)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const plain = await startMetaConnection({ userId: f.owner.id, sessionId: session.id }, f.business.id, {}, overrides);
    expect(new URL(plain.authorizeUrl).searchParams.get("scope")!.split(",")).toEqual([...META_REQUIRED_SCOPES]);

    await prisma.metaConnection.update({ where: { socialAccountId: f.account.id }, data: { grantedScopes: [...META_REQUIRED_SCOPES] } });
    const overview = await getMetaConnectionOverview(f.owner.id, f.business.id, { config, keyring });
    expect(overview.accounts.find((account) => account.id === f.account.id)?.publishPermission).toBe(false);
    expect(overview.accounts.find((account) => account.id === fb.id)?.publishPermission).toBe(true);
  });

  it("classifies Meta errors into a closed, redacted set by call phase", () => {
    const provider = (details: ConstructorParameters<typeof MetaGraphError>[1]) => new MetaGraphError("PROVIDER", details);
    expect(classifyMetaFailure(new MetaGraphError("TIMEOUT"), "PUBLISH")).toMatchObject({ kind: "UNKNOWN", reason: "TIMEOUT" });
    expect(classifyMetaFailure(new MetaGraphError("TIMEOUT"), "PRE_PUBLISH")).toMatchObject({ kind: "REJECTED", retryable: true });
    expect(classifyMetaFailure(provider({ httpStatus: 500 }), "PUBLISH")).toMatchObject({ kind: "UNKNOWN", reason: "PROVIDER_AMBIGUOUS" });
    expect(classifyMetaFailure(provider({ httpStatus: 400, code: 190 }), "PUBLISH")).toMatchObject({ kind: "REJECTED", retryable: false, errorCode: "AUTH_INVALID" });
    expect(classifyMetaFailure(provider({ httpStatus: 403, code: 200 }), "PUBLISH")).toMatchObject({ kind: "REJECTED", retryable: false, errorCode: "PERMISSION_DENIED" });
    expect(classifyMetaFailure(provider({ httpStatus: 400, code: 9, subcode: 2207042 }), "PUBLISH")).toMatchObject({ kind: "REJECTED", retryable: true, errorCode: "RATE_LIMITED" });
    expect(classifyMetaFailure(provider({ httpStatus: 400, code: 9007 }), "PUBLISH")).toMatchObject({ kind: "REJECTED", retryable: true, errorCode: "CONTAINER_NOT_READY" });
    expect(classifyMetaFailure(provider({ httpStatus: 400, code: 100, isTransient: true }), "PUBLISH")).toMatchObject({ kind: "REJECTED", retryable: true, errorCode: "PROVIDER_TRANSIENT" });
    expect(classifyMetaFailure(provider({ httpStatus: 400, code: 100, subcode: 2207026 }), "PUBLISH")).toMatchObject({ kind: "REJECTED", retryable: false, diagnostics: { code: "META_PROVIDER_100_2207026", httpStatus: 400 } });
    expect(classifyMetaFailure(new Error(`boom ${PAGE_TOKEN}`), "PUBLISH")).toEqual({ kind: "UNKNOWN", reason: "PROVIDER_AMBIGUOUS", providerReference: undefined, diagnostics: { code: "INTERNAL_ERROR" } });
  });

  it("the real Graph publishing client sends v26.0 requests with the token only in the Authorization header", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const responses = [
      { id: "90000000005" },
      { status_code: "FINISHED" },
      { id: "17900000000000010" },
      { id: `${PAGE_ID}_42` },
      { id: "888", post_id: `${PAGE_ID}_888` },
    ];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(url), init: init! });
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const client = createMetaPublishingClient(config, fetchImpl);
    expect(await client.createImageContainer(IG_ID, { imageUrl: "https://publish.test/media/publish/x", caption: "c" }, PAGE_TOKEN)).toEqual({ containerId: "90000000005" });
    expect(await client.getContainerStatus("90000000005", PAGE_TOKEN)).toBe("FINISHED");
    expect(await client.publishContainer(IG_ID, "90000000005", PAGE_TOKEN)).toEqual({ mediaId: "17900000000000010" });
    expect(await client.createFeedPost(PAGE_ID, "hello", PAGE_TOKEN)).toEqual({ postId: `${PAGE_ID}_42` });
    expect(await client.createPagePhoto(PAGE_ID, { bytes: await png(), mimeType: "image/png", caption: "c" }, PAGE_TOKEN)).toEqual({ photoId: "888", postId: `${PAGE_ID}_888` });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      `/v26.0/${IG_ID}/media`,
      "/v26.0/90000000005",
      `/v26.0/${IG_ID}/media_publish`,
      `/v26.0/${PAGE_ID}/feed`,
      `/v26.0/${PAGE_ID}/photos`,
    ]);
    for (const request of requests) {
      expect(request.url).not.toContain(PAGE_TOKEN);
      expect((request.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PAGE_TOKEN}`);
      expect(request.init.redirect).toBe("error");
    }
    expect(String(requests[3].init.body)).toContain("published=true");
    expect(requests[4].init.body).toBeInstanceOf(FormData);
    expect((requests[4].init.body as FormData).get("published")).toBe("true");
  });
});

describe("P6-03 secrets", () => {
  it("never exposes credentials or signed URLs in logs, errors, persisted evidence or UI labels", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
    const signed: string[] = [];
    const errors: string[] = [];

    const ig = await fixture();
    const { graph: g1 } = fakePublishingGraph({
      async createImageContainer(_ig, input) {
        signed.push(input.imageUrl.split("/").pop()!.split(".")[2]);
        return { containerId: "90000000009" };
      },
      publishContainer: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 500, code: 1 }); },
    });
    await publishScheduledPostNow(ig.owner.id, ig.post.id, 1, depsFor(ig.storage, g1).deps);

    const fb = await fixture({ platform: "FACEBOOK", media: "none" });
    const { graph: g2 } = fakePublishingGraph({ createFeedPost: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 190 }); } });
    // (IG ve FB farklı Meta varlıklarıdır; aynı testte birlikte kalabilirler.)
    await publishScheduledPostNow(fb.owner.id, fb.post.id, 1, depsFor(fb.storage, g2).deps);

    const denied = await fixture({ platform: "FACEBOOK", media: "none", providerAccountId: "1009" });
    const { graph: g3 } = fakePublishingGraph();
    await publishScheduledPostNow(denied.owner.id, denied.post.id, 1, depsFor(denied.storage, g3, { debug: { isValid: false } }).deps).catch((error: Error) => errors.push(`${error.name} ${error.message} ${error.stack ?? ""}`));

    const dump = JSON.stringify({
      attempts: await prisma.publishAttempt.findMany(),
      intents: await prisma.publishIntent.findMany(),
      audits: await prisma.metaConnectionAudit.findMany(),
    });
    const secrets = [PAGE_TOKEN, APP_SECRET, DELIVERY_SECRET, ...signed];
    expect(signed).toHaveLength(1);
    for (const secret of secrets) {
      expect(dump).not.toContain(secret);
      expect(logs.join("\n")).not.toContain(secret);
      expect(errors.join("\n")).not.toContain(secret);
      expect(JSON.stringify({ PUBLISH_NOW_MESSAGES, PUBLISH_STATUS_LABELS })).not.toContain(secret);
    }
    expect(dump).not.toContain("media/publish");
  });
});
