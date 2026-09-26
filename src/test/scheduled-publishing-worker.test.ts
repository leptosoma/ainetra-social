import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { StorageProvider } from "@/lib/storage";
import { createContent, updateContentVariant } from "@/features/content/service";
import { approveContentVariant } from "@/features/approval/service";
import { scheduleContentVariant } from "@/features/publishing/service";
import { requestPublishIntent } from "@/features/publishing/intent";
import { MAX_PUBLISH_ATTEMPTS, PUBLISH_CALL_GUARD_MARKER, evidenceForExpiredLease, planRetry } from "@/features/publishing/intent-state";
import { META_PUBLISH_SCOPES, META_REQUIRED_SCOPES, loadMetaConfig, type MetaConfig } from "@/features/meta-connection/config";
import { credentialAad, encryptCredential, loadCredentialKeyring } from "@/features/meta-connection/crypto";
import { MetaGraphError, type MetaGraphClient, type MetaPublishingGraphClient, type MetaTokenDebug } from "@/features/meta-connection/graph-client";
import { resolveMetaAccessToken, verifyMetaPublishingCredential } from "@/features/meta-connection/service";
import { createMetaPublishingAdapter } from "@/features/publishing/meta-adapter";
import { createSignedMediaUrl, loadMediaDeliveryConfig, type MediaDeliveryConfig } from "@/features/publishing/media-delivery";
import { publishScheduledPostNow, type PublishNowDeps } from "@/features/publishing/submission";
import { createPublishingWorker, loadWorkerConfig, sanitizeLogEntry, type PublishingWorkerOptions } from "@/features/publishing/worker";

const APP_ID = "1234567890";
const PAGE_ID = "1001";
const IG_ID = "17841400000000001";
const PAGE_TOKEN = "PAGE-SECRET-TOKEN-p604";
const DELIVERY_SECRET = "delivery-secret-p604-0123456789abcdefghij";
const LEASE_MS = 5 * 60_000;

const config = loadMetaConfig({ META_APP_ID: APP_ID, META_APP_SECRET: "test-app-secret-p604", META_REDIRECT_URI: "http://localhost:3001/integrations/meta/callback", META_GRAPH_API_VERSION: "v26.0" }) as MetaConfig;
const keyring = loadCredentialKeyring({ META_CREDENTIAL_KEY: randomBytes(32).toString("base64"), META_CREDENTIAL_KEY_ID: "k1" })!;
const delivery = loadMediaDeliveryConfig({ MEDIA_DELIVERY_SECRET: DELIVERY_SECRET, PUBLIC_APP_URL: "https://publish.test" }) as MediaDeliveryConfig;
const ALL_SCOPES = [...META_REQUIRED_SCOPES, ...META_PUBLISH_SCOPES.INSTAGRAM, ...META_PUBLISH_SCOPES.FACEBOOK];

// ---------------------------------------------------------------------------------------------------------
// Deterministic fakes: fixed clock, in-memory storage, fake Graph (no live Meta token).

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

class Clock {
  constructor(public at: Date) {}
  now = () => new Date(this.at.getTime());
  advance(ms: number) {
    this.at = new Date(this.at.getTime() + ms);
  }
}

type GraphBehavior = Partial<{ [K in keyof MetaPublishingGraphClient]: (...args: Parameters<MetaPublishingGraphClient[K]>) => ReturnType<MetaPublishingGraphClient[K]> }>;

function fakeGraph(behavior: GraphBehavior = {}) {
  const calls: string[] = [];
  let seq = 0;
  const graph: MetaPublishingGraphClient = {
    async getContentPublishingLimit(ig, token) {
      calls.push("limit");
      return behavior.getContentPublishingLimit ? behavior.getContentPublishingLimit(ig, token) : { usage: 1, total: 100 };
    },
    async createImageContainer(ig, input, token) {
      calls.push("container");
      return behavior.createImageContainer ? behavior.createImageContainer(ig, input, token) : { containerId: `9000000000${++seq}` };
    },
    async getContainerStatus(id, token) {
      calls.push("status");
      return behavior.getContainerStatus ? behavior.getContainerStatus(id, token) : "FINISHED";
    },
    async publishContainer(ig, id, token) {
      calls.push("media_publish");
      return behavior.publishContainer ? behavior.publishContainer(ig, id, token) : { mediaId: `1790000000000${++seq}` };
    },
    async createFeedPost(page, message, token) {
      expect(token).toBe(PAGE_TOKEN);
      calls.push("feed");
      return behavior.createFeedPost ? behavior.createFeedPost(page, message, token) : { postId: `${PAGE_ID}_${++seq}` };
    },
    async createPagePhoto(page, input, token) {
      calls.push("photos");
      return behavior.createPagePhoto ? behavior.createPagePhoto(page, input, token) : { photoId: "777", postId: `${PAGE_ID}_${++seq}` };
    },
  };
  return { graph, calls, count: (method: string) => calls.filter((call) => call === method).length };
}

function debugGraph(debug: Partial<MetaTokenDebug> = {}) {
  return {
    async debugToken() {
      return { appId: APP_ID, type: "PAGE", isValid: true, expiresAt: null, dataAccessExpiresAt: new Date(Date.now() + 80 * 86400_000), scopes: ALL_SCOPES, userId: "555", profileId: PAGE_ID, ...debug };
    },
  } as unknown as MetaGraphClient;
}

function publishDeps(storage: StorageProvider, graph: MetaPublishingGraphClient, debug: Partial<MetaTokenDebug> = {}): Partial<Omit<PublishNowDeps, "now">> {
  const adapter = createMetaPublishingAdapter({
    graph,
    resolveToken: (target) => resolveMetaAccessToken(target, { keyring }),
    storage,
    signMediaUrl: (binding) => createSignedMediaUrl(delivery, binding, new Date()),
    now: () => new Date(),
    sleep: async () => undefined,
    containerPoll: { attempts: 3, intervalMs: 0 },
  });
  const debugClient = debugGraph(debug);
  return {
    adapter,
    mediaDeliveryConfigured: true,
    verifyCredential: (connection, actor) => verifyMetaPublishingCredential(connection, actor, { config, keyring, graph: debugClient }),
    leaseMs: LEASE_MS,
  };
}

type LogLine = { level: string; entry: Record<string, string | number | boolean> };

function worker(clock: Clock, deps: Partial<Omit<PublishNowDeps, "now">>, options: Partial<PublishingWorkerOptions> = {}) {
  const logs: LogLine[] = [];
  const instance = createPublishingWorker({ now: clock.now, publish: deps, logger: (level, entry) => logs.push({ level, entry }), intervalMs: 1_000, ...options });
  return Object.assign(instance, { logs });
}

// ---------------------------------------------------------------------------------------------------------
// Fixtures

type Platform = "INSTAGRAM" | "FACEBOOK";

async function jpeg(width = 1080, height = 1350) {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } }).jpeg().toBuffer());
}

async function tenant(platform: Platform = "FACEBOOK", providerAccountId?: string) {
  const storage = new MemoryStorage();
  const owner = await prisma.user.create({ data: { name: "Owner", email: `owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({ data: { name: "Mimoza", sector: "RESTAURANT", memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  const externalId = providerAccountId ?? (platform === "INSTAGRAM" ? IG_ID : PAGE_ID);
  const account = await prisma.socialAccount.create({ data: { businessId: business.id, platform, displayName: "Mimoza", externalAccountId: externalId, status: "CONNECTED" } });
  const encrypted = encryptCredential(keyring, PAGE_TOKEN, credentialAad({ purpose: "connection", businessId: business.id, subjectId: account.id, platform, providerAccountId: externalId }));
  await prisma.metaConnection.create({
    data: {
      businessId: business.id,
      socialAccountId: account.id,
      platform,
      providerAccountId: externalId,
      metaPageId: PAGE_ID,
      instagramAccountId: platform === "INSTAGRAM" ? externalId : IG_ID,
      pageName: "Mimoza Bodrum",
      instagramUsername: "mimoza",
      grantedScopes: ALL_SCOPES,
      pageTasks: ["MANAGE", "CREATE_CONTENT"],
      tokenType: "PAGE",
      credentialRef: `mcred_${randomBytes(12).toString("base64url")}`,
      ...encrypted,
      connectedAt: new Date(),
      lastValidatedAt: new Date(),
    },
  });
  return { storage, owner, business, account, platform };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** Onaylı gönderiyi mutlak bir zamana planlar (P6-03 düğmesiyle aynı hizmet). */
async function schedule(t: Tenant, scheduledAt: Date, options: { caption?: string; approve?: boolean } = {}) {
  let mediaAssetId: string | null = null;
  if (t.platform === "INSTAGRAM") {
    const bytes = await jpeg();
    const storageKey = `${t.business.id}/asset-${crypto.randomUUID()}.jpg`;
    await t.storage.put({ key: storageKey, bytes });
    mediaAssetId = (await prisma.mediaAsset.create({ data: { businessId: t.business.id, originalFilename: "steak", mimeType: "image/jpeg", size: bytes.byteLength, width: 1080, height: 1350, storageKey } })).id;
  }
  const content = await createContent(t.owner.id, t.business.id, {
    title: "Friday Steak",
    topic: "Reservation",
    contentType: "POST",
    platform: t.platform,
    caption: options.caption ?? "Cuma akşamı dana antrikot.",
    cta: "Rezervasyon için arayın.",
    language: "tr",
    mediaAssetId,
  });
  const variant = content.variants[0];
  if (options.approve === false) {
    // Onaysız satır yalnızca doğrudan eklenebilir (planlama hizmeti onay ister): worker onu yayınlamamalı.
    return prisma.scheduledPost.create({ data: { businessId: t.business.id, socialAccountId: t.account.id, contentVariantId: variant.id, contentVersion: 1, scheduledAt } });
  }
  await approveContentVariant(t.owner.id, variant.id);
  return scheduleContentVariant(t.owner.id, variant.id, { socialAccountId: t.account.id, scheduledAt, expectedVersion: 1 }, new Date(scheduledAt.getTime() - 60_000));
}

const intentOf = (postId: string) => prisma.publishIntent.findFirst({ where: { scheduledPostId: postId } });
const attemptsOf = (postId: string) => prisma.publishAttempt.findMany({ where: { scheduledPostId: postId }, orderBy: { attemptNumber: "asc" } });
const postOf = (postId: string) => prisma.scheduledPost.findUniqueOrThrow({ where: { id: postId } });

function gate() {
  let release!: () => void;
  let entered!: () => void;
  const inside = new Promise<void>((resolve) => (entered = resolve));
  const open = new Promise<void>((resolve) => (release = resolve));
  return { inside, open, release, entered };
}

const T0 = () => new Date(Math.floor(Date.now() / 1000) * 1000);

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------

describe("P6-04 due selection and dispatch", () => {
  it("skips future schedules and publishes a due PENDING post through the shared P6-03 path", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, new Date(clock.at.getTime() + 10 * 60_000));
    const { graph, calls } = fakeGraph();
    const w = worker(clock, publishDeps(t.storage, graph));

    const early = await w.tick();
    expect(early).toMatchObject({ intentsCreated: 0, due: 0, dispatched: 0 });
    expect(await intentOf(post.id)).toBeNull();
    expect(calls).toHaveLength(0);

    clock.advance(10 * 60_000);
    const due = await w.tick();
    expect(due).toMatchObject({ intentsCreated: 1, due: 1, dispatched: 1, published: 1 });
    const intent = (await intentOf(post.id))!;
    expect(intent).toMatchObject({ state: "PUBLISHED", nextAttemptAt: null, leaseExpiresAt: null });
    expect(intent.providerReference).toMatch(/^1001_\d+$/);
    expect((await postOf(post.id)).status).toBe("PUBLISHED");
    const [attempt] = await attemptsOf(post.id);
    expect(attempt).toMatchObject({ attemptNumber: 1, status: "SUCCESS", outcome: "PUBLISHED" });
    expect(attempt.publishCallStartedAt).toEqual(clock.at);
    expect(calls).toEqual(["feed"]);

    // PUBLISHED asla yeniden gönderilmez.
    clock.advance(60 * 60_000);
    expect(await w.tick()).toMatchObject({ due: 0, dispatched: 0 });
    expect(calls).toEqual(["feed"]);
  });

  it("publishes an Instagram image, persisting the container before the guarded media_publish", async () => {
    const clock = new Clock(T0());
    const t = await tenant("INSTAGRAM");
    const post = await schedule(t, clock.now());
    const { graph, calls } = fakeGraph({
      async publishContainer() {
        const [attempt] = await attemptsOf(post.id);
        expect(attempt.providerContainerId).toMatch(/^9000000000\d+$/);
        expect(attempt.publishCallStartedAt).toBeInstanceOf(Date);
        return { mediaId: "17900000000000042" };
      },
    });
    const w = worker(clock, publishDeps(t.storage, graph));
    expect(await w.tick()).toMatchObject({ dispatched: 1, published: 1 });
    expect(calls).toEqual(["limit", "container", "status", "media_publish"]);
    expect((await intentOf(post.id))!.providerReference).toBe("17900000000000042");
  });

  it("uses absolute timestamps regardless of the process time zone", async () => {
    const previous = process.env.TZ;
    try {
      const clock = new Clock(new Date("2026-09-26T21:30:00.000Z"));
      const t = await tenant("FACEBOOK");
      const post = await schedule(t, new Date("2026-09-26T22:00:00.000Z"));
      const { graph, calls } = fakeGraph();
      const w = worker(clock, publishDeps(t.storage, graph));
      for (const zone of ["Pacific/Kiritimati", "America/Adak", "Europe/Istanbul"]) {
        process.env.TZ = zone;
        expect((await w.tick()).dispatched).toBe(0);
      }
      clock.at = new Date("2026-09-26T22:00:00.000Z");
      process.env.TZ = "Pacific/Kiritimati";
      expect((await w.tick()).published).toBe(1);
      expect((await intentOf(post.id))!.dueAt.toISOString()).toBe("2026-09-26T22:00:00.000Z");
      expect(calls).toEqual(["feed"]);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("creates the intent for an existing schedule from its approved version, and never for an unapproved one", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const approved = await schedule(t, clock.now());
    const unapproved = await schedule(t, clock.now(), { approve: false });
    const { graph, calls } = fakeGraph();
    const summary = await worker(clock, publishDeps(t.storage, graph)).tick();
    expect(summary).toMatchObject({ intentsCreated: 1, invalid: 1, published: 1 });
    const intent = (await intentOf(approved.id))!;
    expect(intent).toMatchObject({ sourceVersion: 1, generation: 1, businessId: t.business.id });
    expect(await intentOf(unapproved.id)).toBeNull();
    expect((await postOf(unapproved.id)).status).toBe("SCHEDULED");
    expect(calls).toEqual(["feed"]);
  });
});

describe("P6-04 concurrency: one authoritative CAS claim", () => {
  it("two workers and a button racing on the same due posts produce exactly one provider call each", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const posts = [await schedule(t, clock.now(), { caption: "Bir" }), await schedule(t, clock.now(), { caption: "İki" }), await schedule(t, clock.now(), { caption: "Üç" })];
    const { graph, calls } = fakeGraph({
      async createFeedPost(_page, message) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { postId: `${PAGE_ID}_${message.slice(0, 3).length}${Math.random().toString().slice(2, 8)}` };
      },
    });
    const deps = publishDeps(t.storage, graph);
    const a = worker(clock, deps, { workerId: "worker-a" });
    const b = worker(clock, deps, { workerId: "worker-b" });
    const button = publishScheduledPostNow(t.owner.id, posts[0].id, 1, { ...deps, now: clock.now }).catch((error) => error);
    const [sa, sb] = await Promise.all([a.tick(), b.tick(), button]);
    expect(calls.filter((call) => call === "feed")).toHaveLength(3);
    expect(sa.dispatched + sb.dispatched).toBeLessThanOrEqual(3);
    for (const post of posts) {
      expect((await intentOf(post.id))!.state).toBe("PUBLISHED");
      expect(await attemptsOf(post.id)).toHaveLength(1);
      expect(await prisma.publishIntent.count({ where: { scheduledPostId: post.id } })).toBe(1);
    }
    // Sonraki turlarda hiçbir şey yeniden gönderilmez.
    await Promise.all([a.tick(), b.tick()]);
    expect(calls.filter((call) => call === "feed")).toHaveLength(3);
  });

  it("skips an active IN_FLIGHT lease held by another worker", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now());
    const hold = gate();
    const { graph, calls } = fakeGraph({
      async createFeedPost() {
        hold.entered();
        await hold.open;
        return { postId: `${PAGE_ID}_1` };
      },
    });
    const deps = publishDeps(t.storage, graph);
    const first = worker(clock, deps).tick();
    await hold.inside;
    clock.advance(LEASE_MS - 1_000);
    const second = await worker(clock, deps).tick();
    expect(second).toMatchObject({ recovered: 0, due: 0, dispatched: 0 });
    expect((await intentOf(post.id))!.state).toBe("IN_FLIGHT");
    expect(await attemptsOf(post.id)).toHaveLength(1);
    hold.release();
    expect((await first).published).toBe(1);
    expect(calls).toEqual(["feed"]);
  });
});

describe("P6-04 never redispatches terminal or uncertain intents", () => {
  it("skips PUBLISHED, permanent FAILED, UNKNOWN, CANCELLED and INVALIDATED intents", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const states = ["PUBLISHED", "FAILED", "UNKNOWN", "CANCELLED", "INVALIDATED"] as const;
    const posts = [];
    for (const state of states) {
      const post = await schedule(t, clock.now(), { caption: `Durum ${state}` });
      const intent = await requestPublishIntent(t.owner.id, post.id, 1);
      await prisma.publishIntent.update({ where: { id: intent.id }, data: { state, nextAttemptAt: new Date(clock.at.getTime() - 1_000), providerReference: state === "PUBLISHED" ? `${PAGE_ID}_9` : null } });
      posts.push(post);
    }
    const { graph, calls } = fakeGraph();
    const summary = await worker(clock, publishDeps(t.storage, graph)).tick();
    expect(summary).toMatchObject({ due: 0, dispatched: 0, intentsCreated: 0 });
    expect(calls).toHaveLength(0);
    for (const post of posts) expect(await attemptsOf(post.id)).toHaveLength(0);
  });

  it("turns an ambiguous publish timeout into UNKNOWN and never resubmits it automatically", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now());
    const { graph, count } = fakeGraph({ createFeedPost: async () => { throw new MetaGraphError("TIMEOUT"); } });
    const w = worker(clock, publishDeps(t.storage, graph));
    expect(await w.tick()).toMatchObject({ dispatched: 1, reconciliationRequired: 1 });
    for (let i = 0; i < 3; i++) {
      clock.advance(10 * 60_000);
      expect(await w.tick()).toMatchObject({ dispatched: 0, due: 0 });
    }
    expect(count("feed")).toBe(1);
    expect((await intentOf(post.id))!).toMatchObject({ state: "UNKNOWN", nextAttemptAt: null });
    expect((await postOf(post.id)).status).toBe("SCHEDULED");
  });

  it("marks permanent and auth refusals FAILED without any retry", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const permanent = await schedule(t, clock.now(), { caption: "Kalıcı" });
    const { graph, count } = fakeGraph({ createFeedPost: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 100 }); } });
    const w = worker(clock, publishDeps(t.storage, graph));
    expect(await w.tick()).toMatchObject({ dispatched: 1, failed: 1 });
    clock.advance(10 * 60_000);
    await w.tick();
    expect(count("feed")).toBe(1);
    expect((await intentOf(permanent.id))!).toMatchObject({ state: "FAILED", nextAttemptAt: null });
    expect((await postOf(permanent.id)).status).toBe("FAILED");

    const auth = await schedule(t, clock.now(), { caption: "Yetki" });
    const { graph: g2, count: c2 } = fakeGraph({ createFeedPost: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 190 }); } });
    const w2 = worker(clock, publishDeps(t.storage, g2));
    expect(await w2.tick()).toMatchObject({ failed: 1 });
    clock.advance(10 * 60_000);
    await w2.tick();
    expect(c2("feed")).toBe(1);
    expect((await intentOf(auth.id))!.state).toBe("FAILED");
    expect((await prisma.metaConnection.findUniqueOrThrow({ where: { socialAccountId: t.account.id } })).credentialRef).toBeNull();
  });
});

describe("P6-04 bounded safe retry", () => {
  it("retries a definite safe rejection after 60 seconds, then 5 minutes, and fails terminally on the third attempt", async () => {
    const start = T0();
    const clock = new Clock(start);
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now());
    const { graph, count } = fakeGraph({ createFeedPost: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 4 }); } });
    const w = worker(clock, publishDeps(t.storage, graph));

    expect(await w.tick()).toMatchObject({ dispatched: 1, retryWait: 1 });
    let intent = (await intentOf(post.id))!;
    expect(intent.state).toBe("RETRY_WAIT");
    expect(intent.nextAttemptAt).toEqual(new Date(start.getTime() + 60_000));

    clock.advance(59_999);
    expect(await w.tick()).toMatchObject({ due: 0, dispatched: 0 });
    expect(count("feed")).toBe(1);

    clock.advance(1);
    expect(await w.tick()).toMatchObject({ dispatched: 1, retryWait: 1 });
    intent = (await intentOf(post.id))!;
    expect(intent.nextAttemptAt).toEqual(new Date(start.getTime() + 60_000 + 5 * 60_000));

    clock.advance(5 * 60_000 - 1);
    expect(await w.tick()).toMatchObject({ dispatched: 0 });
    clock.advance(1);
    expect(await w.tick()).toMatchObject({ dispatched: 1, failed: 1 });

    intent = (await intentOf(post.id))!;
    expect(intent).toMatchObject({ state: "FAILED", nextAttemptAt: null });
    expect(intent.providerEvidence).toMatchObject({ kind: "RETRY_BUDGET_EXHAUSTED" });
    expect((await postOf(post.id)).status).toBe("FAILED");
    const attempts = await attemptsOf(post.id);
    expect(attempts.map((attempt) => [attempt.attemptNumber, attempt.status, attempt.outcome, attempt.errorCode])).toEqual([
      [1, "FAILED", "RETRYABLE_REJECTION", "RATE_LIMITED"],
      [2, "FAILED", "RETRYABLE_REJECTION", "RATE_LIMITED"],
      [3, "FAILED", "RETRYABLE_REJECTION", "RATE_LIMITED"],
    ]);
    clock.advance(60 * 60_000);
    await w.tick();
    expect(count("feed")).toBe(MAX_PUBLISH_ATTEMPTS);
  });

  it("publishes on a due safe retry and ignores legacy or unproven RETRY_WAIT rows", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now(), { caption: "Yeniden" });
    let fail = true;
    const { graph, count } = fakeGraph({
      async createFeedPost() {
        if (fail) throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 4 });
        return { postId: `${PAGE_ID}_42` };
      },
    });
    const w = worker(clock, publishDeps(t.storage, graph));
    await w.tick();
    fail = false;
    clock.advance(60_000);
    expect(await w.tick()).toMatchObject({ dispatched: 1, published: 1 });
    expect((await attemptsOf(post.id)).map((attempt) => attempt.status)).toEqual(["FAILED", "SUCCESS"]);

    // P6-04 öncesi RETRY_WAIT (nextAttemptAt boş) ve son denemesi belirsiz olan RETRY_WAIT otomatik denenmez.
    const legacy = await schedule(t, clock.now(), { caption: "Eski" });
    const legacyIntent = await requestPublishIntent(t.owner.id, legacy.id, 1);
    await prisma.publishIntent.update({ where: { id: legacyIntent.id }, data: { state: "RETRY_WAIT", nextAttemptAt: null } });
    const unproven = await schedule(t, clock.now(), { caption: "Belirsiz" });
    const unprovenIntent = await requestPublishIntent(t.owner.id, unproven.id, 1);
    const unknownAttempt = await prisma.publishAttempt.create({ data: { scheduledPostId: unproven.id, publishIntentId: unprovenIntent.id, attemptNumber: 1, status: "UNKNOWN", outcome: "UNKNOWN", errorCode: "TIMEOUT" } });
    await prisma.publishIntent.update({ where: { id: unprovenIntent.id }, data: { state: "RETRY_WAIT", nextAttemptAt: new Date(clock.at.getTime() - 1_000), currentAttemptId: unknownAttempt.id } });

    clock.advance(10 * 60_000);
    const summary = await w.tick();
    expect(summary.dispatched).toBe(0);
    expect(count("feed")).toBe(2);
    expect((await intentOf(legacy.id))!.state).toBe("RETRY_WAIT");
    expect((await intentOf(unproven.id))!.state).toBe("RETRY_WAIT");
    expect(await attemptsOf(unproven.id)).toHaveLength(1);
  });

  it("derives deterministic backoff and budget from the attempt number", () => {
    const at = new Date("2026-09-26T10:00:00.000Z");
    expect(planRetry(1, at)).toEqual({ kind: "RETRY", nextAttemptAt: new Date("2026-09-26T10:01:00.000Z") });
    expect(planRetry(2, at)).toEqual({ kind: "RETRY", nextAttemptAt: new Date("2026-09-26T10:05:00.000Z") });
    expect(planRetry(3, at)).toEqual({ kind: "EXHAUSTED" });
    expect(planRetry(0, at)).toEqual({ kind: "EXHAUSTED" });
  });
});

describe("P6-04 crash safety", () => {
  it("crash before claim: the next poll simply proceeds", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now());
    await requestPublishIntent(t.owner.id, post.id, 1);
    const { graph, calls } = fakeGraph();
    expect(await worker(clock, publishDeps(t.storage, graph)).tick()).toMatchObject({ published: 1 });
    expect(calls).toEqual(["feed"]);
  });

  it("crash after claim but before any publish call recovers safely and fences the old worker out", async () => {
    const clock = new Clock(T0());
    const t = await tenant("INSTAGRAM");
    const post = await schedule(t, clock.now());
    const stuck = gate();
    const old = fakeGraph({
      async getContainerStatus() {
        stuck.entered();
        await stuck.open;
        return "FINISHED";
      },
    });
    const oldTick = worker(clock, publishDeps(t.storage, old.graph), { workerId: "old" }).tick();
    await stuck.inside;
    const [claimed] = await attemptsOf(post.id);
    expect(claimed).toMatchObject({ status: "PENDING", publishCallStartedAt: null });
    expect(claimed.providerContainerId).toMatch(/^9000000000\d+$/);
    expect(claimed.diagnostics).toEqual({ publishGuard: PUBLISH_CALL_GUARD_MARKER });

    clock.advance(LEASE_MS);
    const fresh = fakeGraph();
    const next = worker(clock, publishDeps(t.storage, fresh.graph), { workerId: "new" });
    expect(await next.tick()).toMatchObject({ recovered: 1, safeRetry: 1, dispatched: 0 });
    let intent = (await intentOf(post.id))!;
    expect(intent.state).toBe("RETRY_WAIT");
    expect(intent.nextAttemptAt).toEqual(new Date(clock.at.getTime() + 60_000));
    expect((await attemptsOf(post.id))[0]).toMatchObject({ status: "FAILED", outcome: "RETRYABLE_REJECTION", errorCode: "LEASE_EXPIRED_BEFORE_PUBLISH", providerContainerId: claimed.providerContainerId, publishCallStartedAt: null });

    // Eski işçi uyanır: kiralaması geri alınmıştır, media_publish çağrılamaz.
    stuck.release();
    await oldTick;
    expect(old.calls).not.toContain("media_publish");

    clock.advance(60_000);
    expect(await next.tick()).toMatchObject({ dispatched: 1, published: 1 });
    intent = (await intentOf(post.id))!;
    expect(intent.state).toBe("PUBLISHED");
    expect(old.count("media_publish") + fresh.count("media_publish")).toBe(1);
    expect((await attemptsOf(post.id)).map((attempt) => [attempt.attemptNumber, attempt.status])).toEqual([[1, "FAILED"], [2, "SUCCESS"]]);
  });

  it("crash during the provider call stays UNKNOWN; a late provider result is kept on its attempt only", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now());
    const stuck = gate();
    const old = fakeGraph({
      async createFeedPost() {
        stuck.entered();
        await stuck.open;
        return { postId: `${PAGE_ID}_late` };
      },
    });
    const oldTick = worker(clock, publishDeps(t.storage, old.graph)).tick();
    await stuck.inside;
    expect((await attemptsOf(post.id))[0].publishCallStartedAt).toBeInstanceOf(Date);

    clock.advance(LEASE_MS);
    const fresh = fakeGraph();
    const next = worker(clock, publishDeps(t.storage, fresh.graph));
    expect(await next.tick()).toMatchObject({ recovered: 1, reconciliationRequired: 1, dispatched: 0 });
    expect((await intentOf(post.id))!).toMatchObject({ state: "UNKNOWN", nextAttemptAt: null });

    stuck.release();
    await oldTick;
    clock.advance(60 * 60_000);
    await next.tick();
    expect(fresh.calls).toHaveLength(0);
    const intent = (await intentOf(post.id))!;
    expect(intent).toMatchObject({ state: "UNKNOWN", providerReference: null });
    expect((await attemptsOf(post.id))[0]).toMatchObject({ status: "SUCCESS", providerReference: `${PAGE_ID}_late` });
    expect((await postOf(post.id)).status).toBe("SCHEDULED");
  });

  it("provider accepted but the result write failed: recovery marks UNKNOWN and never duplicates", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now());
    let breakNextWrite = false;
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((...args: Parameters<typeof prisma.$transaction>) => {
      if (breakNextWrite) {
        breakNextWrite = false;
        return Promise.reject(new Error("Connection terminated unexpectedly"));
      }
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as typeof prisma.$transaction);
    const { graph, count } = fakeGraph({
      async createFeedPost() {
        breakNextWrite = true;
        return { postId: `${PAGE_ID}_accepted` };
      },
    });
    const w = worker(clock, publishDeps(t.storage, graph));
    const first = await w.tick();
    expect(first).toMatchObject({ errors: 1, dispatched: 0 });
    expect((await intentOf(post.id))!.state).toBe("IN_FLIGHT");
    expect((await attemptsOf(post.id))[0]).toMatchObject({ status: "PENDING" });

    clock.advance(LEASE_MS);
    expect(await w.tick()).toMatchObject({ recovered: 1, reconciliationRequired: 1 });
    clock.advance(60 * 60_000);
    await w.tick();
    expect(count("feed")).toBe(1);
    expect((await intentOf(post.id))!.state).toBe("UNKNOWN");
  });

  it("treats unmarked legacy attempts and a marker without a finished call as ambiguous", () => {
    const expired = { state: "IN_FLIGHT" as const, leaseExpiresAt: new Date("2026-09-26T10:00:00Z") };
    const now = new Date("2026-09-26T10:00:01Z");
    const guarded = { status: "PENDING" as const, errorCode: null, diagnostics: { publishGuard: PUBLISH_CALL_GUARD_MARKER }, publishCallStartedAt: null };
    expect(evidenceForExpiredLease(expired, guarded, now)).toEqual({ kind: "LEASE_EXPIRED_BEFORE_PUBLISH_CALL" });
    expect(evidenceForExpiredLease(expired, { ...guarded, publishCallStartedAt: now }, now)).toEqual({ kind: "OUTCOME_UNKNOWN", reason: "LEASE_EXPIRED" });
    expect(evidenceForExpiredLease(expired, { ...guarded, diagnostics: null }, now)).toEqual({ kind: "OUTCOME_UNKNOWN", reason: "LEASE_EXPIRED" });
    expect(evidenceForExpiredLease(expired, { ...guarded, status: "UNKNOWN" }, now)).toEqual({ kind: "OUTCOME_UNKNOWN", reason: "LEASE_EXPIRED" });
    expect(evidenceForExpiredLease(expired, null, now)).toEqual({ kind: "OUTCOME_UNKNOWN", reason: "LEASE_EXPIRED" });
    expect(evidenceForExpiredLease({ ...expired, leaseExpiresAt: new Date("2026-09-26T10:05:00Z") }, guarded, now)).toBeNull();
  });
});

describe("P6-04 isolation and guards", () => {
  it("one broken tenant or job does not block unrelated jobs, and invalid rows do not starve the scan", async () => {
    const clock = new Clock(T0());
    const broken = await tenant("FACEBOOK", "2002");
    const healthy = await tenant("FACEBOOK", PAGE_ID);
    const brokenPost = await schedule(broken, new Date(clock.at.getTime() - 2_000), { caption: "Bozuk" });
    const unapproved = await schedule(healthy, new Date(clock.at.getTime() - 1_000), { approve: false });
    const goodPost = await schedule(healthy, clock.now(), { caption: "Sağlam" });
    // Bozuk kiracının kimlik bilgisi yerel olarak kaldırıldı (yeniden yetki gerekli).
    await prisma.metaConnection.update({ where: { socialAccountId: broken.account.id }, data: { reauthRequiredAt: clock.now(), reauthReason: "TOKEN_REVOKED" } });

    const { graph, calls } = fakeGraph();
    const w = worker(clock, publishDeps(healthy.storage, graph), { batchSize: 1 });
    for (let i = 0; i < 4; i++) await w.tick();
    expect((await intentOf(goodPost.id))!.state).toBe("PUBLISHED");
    expect((await intentOf(brokenPost.id))!.state).toBe("PENDING");
    expect(await attemptsOf(brokenPost.id)).toHaveLength(0);
    expect(await intentOf(unapproved.id)).toBeNull();
    expect(calls).toEqual(["feed"]);
    const refused = w.logs.find((line) => line.entry.event === "dispatch_refused");
    expect(refused?.entry).toMatchObject({ intentId: (await intentOf(brokenPost.id))!.id, category: "ACCOUNT_NOT_CONNECTED" });
  });

  it("keeps tenant, account, snapshot, version, media and credential guards active without a user session", async () => {
    const clock = new Clock(T0());
    const t = await tenant("INSTAGRAM");
    const tampered = await schedule(t, clock.now(), { caption: "Snapshot" });
    const edited = await schedule(t, clock.now(), { caption: "Düzenlenecek" });
    const foreignMedia = await schedule(t, clock.now(), { caption: "Medya" });
    const tamperedIntent = await requestPublishIntent(t.owner.id, tampered.id, 1);
    const snapshot = tamperedIntent.snapshot as { content: { caption: string } };
    await prisma.publishIntent.update({ where: { id: tamperedIntent.id }, data: { snapshot: { ...snapshot, content: { ...snapshot.content, caption: "Değiştirildi" } } } });
    await requestPublishIntent(t.owner.id, edited.id, 1);
    const editedVariant = await prisma.scheduledPost.findUniqueOrThrow({ where: { id: edited.id } });
    await updateContentVariant(t.owner.id, editedVariant.contentVariantId, { caption: "Yeni metin", cta: null, language: "tr", mediaAssetId: null, aspectRatio: null, expectedVersion: 1 });
    const foreignIntent = await requestPublishIntent(t.owner.id, foreignMedia.id, 1);
    const other = await prisma.business.create({ data: { name: "Other", sector: "HOTEL" } });
    const mediaId = (foreignIntent.snapshot as { media: { mediaAssetId: string } }).media.mediaAssetId;
    await prisma.mediaAsset.update({ where: { id: mediaId }, data: { businessId: other.id } });

    const { graph, calls } = fakeGraph();
    const w = worker(clock, publishDeps(t.storage, graph));
    await w.tick();
    expect(calls).toHaveLength(0);
    expect((await intentOf(tampered.id))!.state).toBe("PENDING");
    expect((await intentOf(edited.id))!.state).toBe("INVALIDATED");
    expect((await intentOf(foreignMedia.id))!.state).toBe("PENDING");
    const categories = w.logs.filter((line) => line.entry.event === "dispatch_refused").map((line) => line.entry.category).sort();
    expect(categories).toEqual(["MEDIA_INVALID", "NOT_PUBLISHABLE"]);

    // Gerçek kimlik bilgisi yeniden doğrulanır: yayın izni eksikse gönderilmez; denetim aktörü yoktur.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User", "Business" CASCADE`);
    const t2 = await tenant("FACEBOOK");
    const post = await schedule(t2, clock.now());
    const { graph: g2, calls: c2 } = fakeGraph();
    const w2 = worker(clock, publishDeps(t2.storage, g2, { scopes: [...META_REQUIRED_SCOPES] }));
    await w2.tick();
    expect(c2).toHaveLength(0);
    expect((await intentOf(post.id))!.state).toBe("PENDING");
    expect(w2.logs.find((line) => line.entry.event === "dispatch_refused")?.entry.category).toBe("PUBLISH_PERMISSION_MISSING");
  });
});

describe("P6-04 process lifecycle and observability", () => {
  it("graceful shutdown stops new claims and waits for the active call", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const first = await schedule(t, new Date(clock.at.getTime() - 1_000), { caption: "İlk" });
    const second = await schedule(t, clock.now(), { caption: "İkinci" });
    const hold = gate();
    const { graph, calls } = fakeGraph({
      async createFeedPost() {
        hold.entered();
        await hold.open;
        return { postId: `${PAGE_ID}_1` };
      },
    });
    const w = worker(clock, publishDeps(t.storage, graph), { concurrency: 1, shutdownTimeoutMs: 10_000 });
    const running = w.run();
    await hold.inside;
    const stopping = w.stop();
    expect(w.stopping).toBe(true);
    hold.release();
    expect(await stopping).toEqual({ drained: true });
    await running;
    expect(calls).toEqual(["feed"]);
    expect((await intentOf(first.id))!.state).toBe("PUBLISHED");
    expect((await intentOf(second.id))!.state).toBe("PENDING");
    expect(await attemptsOf(second.id)).toHaveLength(0);
    expect(w.logs.map((line) => line.entry.event)).toEqual(expect.arrayContaining(["worker_started", "tick", "worker_stopped"]));
  });

  it("gives up waiting after the shutdown timeout; the unfinished attempt is left to the crash rules", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now());
    const hold = gate();
    const { graph } = fakeGraph({
      async createFeedPost() {
        hold.entered();
        await hold.open;
        return { postId: `${PAGE_ID}_1` };
      },
    });
    const w = worker(clock, publishDeps(t.storage, graph), { shutdownTimeoutMs: 50 });
    const running = w.run();
    await hold.inside;
    expect(await w.stop()).toEqual({ drained: false });
    expect((await intentOf(post.id))!.state).toBe("IN_FLIGHT");
    hold.release();
    await running;
  });

  it("logs only sanitized ids, states and closed categories: no tokens, credentials, captions or signed URLs", async () => {
    const clock = new Clock(T0());
    const t = await tenant("INSTAGRAM");
    await schedule(t, clock.now(), { caption: "Gizli altyazı metni #mimoza" });
    const signed: string[] = [];
    const { graph } = fakeGraph({
      async createImageContainer(_ig, input) {
        signed.push(input.imageUrl);
        return { containerId: "90000000077" };
      },
      publishContainer: async () => { throw new MetaGraphError("PROVIDER", { httpStatus: 400, code: 100, traceId: "TraceAbc" }); },
    });
    const consoleLines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => void consoleLines.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => void consoleLines.push(args.join(" ")));
    const w = createPublishingWorker({ now: clock.now, publish: publishDeps(t.storage, graph) });
    await w.tick();
    const text = consoleLines.join("\n");
    expect(signed).toHaveLength(1);
    expect(consoleLines.length).toBeGreaterThan(0);
    for (const secret of [PAGE_TOKEN, DELIVERY_SECRET, signed[0], "https://", "Gizli altyazı", "mcred_", "ciphertext", "test-app-secret"]) {
      expect(text).not.toContain(secret);
    }
    for (const line of consoleLines) expect(JSON.parse(line)).toMatchObject({ component: "publishing-worker" });

    expect(sanitizeLogEntry({ event: "x", category: "https://publish.test/media/publish/abc.123.sig", intentId: "cabc123" } as never)).toEqual({ event: "x", category: "[redacted]", intentId: "cabc123" });
    expect(sanitizeLogEntry({ event: "x", token: PAGE_TOKEN } as never)).toEqual({ event: "x" });
  });

  it("reads bounded worker configuration from the environment", () => {
    expect(loadWorkerConfig({})).toEqual({ batchSize: 25, intervalMs: 15_000, concurrency: 4, shutdownTimeoutMs: 30_000 });
    expect(loadWorkerConfig({ PUBLISHING_WORKER_BATCH_SIZE: "10", PUBLISHING_WORKER_INTERVAL_MS: "5000", PUBLISHING_WORKER_CONCURRENCY: "2", PUBLISHING_WORKER_SHUTDOWN_TIMEOUT_MS: "20000" })).toEqual({ batchSize: 10, intervalMs: 5_000, concurrency: 2, shutdownTimeoutMs: 20_000 });
    expect(loadWorkerConfig({ PUBLISHING_WORKER_BATCH_SIZE: "100000", PUBLISHING_WORKER_INTERVAL_MS: "1", PUBLISHING_WORKER_CONCURRENCY: "abc" })).toMatchObject({ batchSize: 25, intervalMs: 15_000, concurrency: 4 });
  });

  it("backs off and keeps running when the database is temporarily unreachable", async () => {
    const clock = new Clock(T0());
    const t = await tenant("FACEBOOK");
    const post = await schedule(t, clock.now());
    const findMany = prisma.publishIntent.findMany.bind(prisma.publishIntent);
    let failures = 1;
    vi.spyOn(prisma.publishIntent, "findMany").mockImplementation(((...args: Parameters<typeof prisma.publishIntent.findMany>) => {
      if (failures > 0) {
        failures--;
        return Promise.reject(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432 password=secret"), { code: "P1001" }));
      }
      return (findMany as (...a: unknown[]) => unknown)(...args);
    }) as never);
    const { graph, calls } = fakeGraph();
    const w = worker(clock, publishDeps(t.storage, graph), { intervalMs: 10, maxBackoffMs: 20 });
    const running = w.run();
    for (let i = 0; i < 100 && (await intentOf(post.id))?.state !== "PUBLISHED"; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    await w.stop();
    await running;
    expect(calls).toEqual(["feed"]);
    const failed = w.logs.find((line) => line.entry.event === "tick_failed");
    expect(failed?.entry).toMatchObject({ category: "DB_P1001", retryInMs: 20 });
    expect(JSON.stringify(w.logs)).not.toContain("password");
  });
});
