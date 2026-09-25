import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createContent, recordContentExport, updateContentVariant } from "@/features/content/service";
import { approveContentVariant } from "@/features/approval/service";
import { isScheduledPostPublishable, scheduleContentVariant } from "@/features/publishing/service";
import { checkPublishIntentDispatchable, requestPublishIntent, transitionPublishIntent } from "@/features/publishing/intent";
import {
  attemptStatusForOutcome,
  evidenceForElapsedTime,
  evidenceFromReconcileResult,
  evidenceFromSubmitOutcome,
  planIntentTransition,
  type PublishIntentEvidence,
  type PublishIntentState,
} from "@/features/publishing/intent-state";
import { PUBLISHING_ROUTES } from "@/features/publishing/adapter";
import { canonicalJson, hashPublishSnapshot, verifyPublishSnapshotHash, type PublishSnapshotV1 } from "@/features/publishing/snapshot";

const future = () => new Date(Date.now() + 24 * 60 * 60_000);
const edit = (caption: string, mediaAssetId: string | null = null) => ({ caption, cta: null, language: "tr", mediaAssetId, aspectRatio: null });

async function fixture(options: { platform?: "INSTAGRAM" | "FACEBOOK" | "TIKTOK"; accountStatus?: "CONNECTED" | "DISCONNECTED" } = {}) {
  const platform = options.platform ?? "INSTAGRAM";
  const owner = await prisma.user.create({ data: { name: "Owner", email: `owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `outside-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({ data: { name: "Mimoza", sector: "RESTAURANT", memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  const otherBusiness = await prisma.business.create({ data: { name: "Other", sector: "HOTEL", memberships: { create: { userId: outsider.id, role: "OWNER" } } } });
  const account = await prisma.socialAccount.create({ data: { businessId: business.id, platform, displayName: "Demo", externalAccountId: "ig-123", status: options.accountStatus ?? "CONNECTED" } });
  const otherAccount = await prisma.socialAccount.create({ data: { businessId: otherBusiness.id, platform, displayName: "Other", status: "CONNECTED" } });
  const media = await prisma.mediaAsset.create({ data: { businessId: business.id, originalFilename: "steak.jpg", mimeType: "image/jpeg", size: 100, width: 1080, height: 1350, storageKey: `${business.id}/steak-${crypto.randomUUID()}.jpg` } });
  const content = await createContent(owner.id, business.id, { title: "Friday Steak", topic: "Reservation", contentType: "POST", platform, caption: "Original caption", language: "tr", mediaAssetId: media.id });
  const variant = content.variants[0];
  return { owner, outsider, business, otherBusiness, account, otherAccount, media, content, variant };
}

async function scheduledFixture(options: Parameters<typeof fixture>[0] = {}) {
  const base = await fixture(options);
  await approveContentVariant(base.owner.id, base.variant.id);
  const post = await scheduleContentVariant(base.owner.id, base.variant.id, { socialAccountId: base.account.id, scheduledAt: future(), expectedVersion: 1 });
  return { ...base, post };
}

describe("P6-01 publish intent creation", () => {
  it("creates one durable intent with a stable snapshot and no attempt from the approved current version", async () => {
    const { owner, business, account, variant, media, post, content } = await scheduledFixture();
    const intent = await requestPublishIntent(owner.id, post.id, 1);

    expect(intent).toMatchObject({
      businessId: business.id,
      socialAccountId: account.id,
      scheduledPostId: post.id,
      sourceVariantId: variant.id,
      sourceVersion: 1,
      platform: "INSTAGRAM",
      generation: 1,
      state: "PENDING",
      snapshotVersion: 1,
      adapterKey: PUBLISHING_ROUTES.INSTAGRAM.adapterKey,
      adapterVersion: PUBLISHING_ROUTES.INSTAGRAM.adapterVersion,
      providerReference: null,
      publishedAt: null,
    });
    expect(intent.dueAt.getTime()).toBe(post.scheduledAt.getTime());
    expect(intent.idempotencyKey).toMatch(/^ainetra-pub-[0-9a-f]{40}$/);
    const approval = await prisma.approval.findFirstOrThrow({ where: { contentVariantId: variant.id, approvedVersion: 1 } });
    expect(intent.approvalId).toBe(approval.id);

    const snapshot = intent.snapshot as unknown as PublishSnapshotV1;
    expect(snapshot).toMatchObject({
      snapshotVersion: 1,
      businessId: business.id,
      scheduledPostId: post.id,
      scheduledAt: post.scheduledAt.toISOString(),
      target: { socialAccountId: account.id, platform: "INSTAGRAM", externalAccountId: "ig-123" },
      content: { contentItemId: content.id, variantId: variant.id, version: 1, approvalId: approval.id, contentType: "POST", caption: "Original caption", cta: null, language: "tr" },
      media: { mediaAssetId: media.id, type: "IMAGE", mimeType: "image/jpeg", storageKey: media.storageKey, origin: "UPLOAD" },
    });
    expect(intent.snapshotHash).toBe(hashPublishSnapshot(snapshot));
    expect(verifyPublishSnapshotHash(intent.snapshot, intent.snapshotHash)).toBe(true);
    expect(canonicalJson(snapshot)).not.toMatch(/token|secret|password/i);

    expect(await prisma.publishIntent.count()).toBe(1);
    expect(await prisma.publishAttempt.count()).toBe(0);
    expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("SCHEDULED");
    expect(await checkPublishIntentDispatchable(intent.id)).toEqual({ dispatchable: true });
  });

  it("does not create an intent or publication from scheduling or export alone", async () => {
    const { owner, variant, post } = await scheduledFixture();
    await recordContentExport(owner.id, variant.id);
    expect(await prisma.publishIntent.count()).toBe(0);
    expect(await prisma.publishAttempt.count()).toBe(0);
    expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("SCHEDULED");
  });

  it("rejects an unapproved current version without an outbox row", async () => {
    const { owner, variant, post } = await scheduledFixture();
    // Onay satırı silinmiş (ör. eski veri) bir planlı post yine de yayına hazırlanamaz.
    await prisma.approval.deleteMany({ where: { contentVariantId: variant.id } });
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.publishIntent.count()).toBe(0);
  });

  it("rejects a stale expected version and invalidated or cancelled posts", async () => {
    const { owner, variant, post } = await scheduledFixture();
    await expect(requestPublishIntent(owner.id, post.id, 2)).rejects.toMatchObject({ code: "CONFLICT" });

    await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: "CANCELLED" } });
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "CONFLICT" });

    await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: "SCHEDULED" } });
    await updateContentVariant(owner.id, variant.id, edit("Changed"));
    await approveContentVariant(owner.id, variant.id);
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(requestPublishIntent(owner.id, post.id, 2)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.publishIntent.count()).toBe(0);
  });

  it("rejects a disconnected account", async () => {
    const { owner, post } = await scheduledFixture({ accountStatus: "DISCONNECTED" });
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.publishIntent.count()).toBe(0);
  });

  it("rejects an account whose platform does not match the variant", async () => {
    const { owner, business, variant } = await fixture();
    await approveContentVariant(owner.id, variant.id);
    const facebook = await prisma.socialAccount.create({ data: { businessId: business.id, platform: "FACEBOOK", displayName: "FB", status: "CONNECTED" } });
    const post = await scheduleContentVariant(owner.id, variant.id, { socialAccountId: facebook.id, scheduledAt: future(), expectedVersion: 1 });
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.publishIntent.count()).toBe(0);
  });

  it("rejects an unsupported platform (TikTok is outside Phase 6)", async () => {
    const { owner, post } = await scheduledFixture({ platform: "TIKTOK" });
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.publishIntent.count()).toBe(0);
  });

  it("enforces tenant isolation for the user, account and media", async () => {
    const { owner, outsider, account, otherAccount, otherBusiness, variant, post } = await scheduledFixture();
    await expect(requestPublishIntent(outsider.id, post.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await prisma.scheduledPost.update({ where: { id: post.id }, data: { socialAccountId: otherAccount.id } });
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await prisma.scheduledPost.update({ where: { id: post.id }, data: { socialAccountId: account.id } });
    const foreignMedia = await prisma.mediaAsset.create({ data: { businessId: otherBusiness.id, originalFilename: "x.jpg", mimeType: "image/jpeg", size: 1, storageKey: `other/${crypto.randomUUID()}.jpg` } });
    await prisma.contentVariant.update({ where: { id: variant.id }, data: { mediaAssetId: foreignMedia.id } });
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(requestPublishIntent(owner.id, "missing-post", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.publishIntent.count()).toBe(0);
  });
});

describe("P6-01 idempotency", () => {
  it("returns the same intent for repeated requests", async () => {
    const { owner, post } = await scheduledFixture();
    const first = await requestPublishIntent(owner.id, post.id, 1);
    const second = await requestPublishIntent(owner.id, post.id, 1);
    expect(second.id).toBe(first.id);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.snapshotHash).toBe(first.snapshotHash);
    expect(await prisma.publishIntent.count()).toBe(1);
  });

  it("collapses genuinely concurrent requests into one intent and idempotency key", async () => {
    const { owner, post } = await scheduledFixture();
    const results = await Promise.all(Array.from({ length: 6 }, () => requestPublishIntent(owner.id, post.id, 1)));
    expect(new Set(results.map((intent) => intent.id)).size).toBe(1);
    expect(new Set(results.map((intent) => intent.idempotencyKey)).size).toBe(1);
    expect(await prisma.publishIntent.count({ where: { scheduledPostId: post.id } })).toBe(1);
  });

  it("conflicts when the snapshot changed instead of silently creating a new generation", async () => {
    const { owner, account, post } = await scheduledFixture();
    const first = await requestPublishIntent(owner.id, post.id, 1);
    await prisma.socialAccount.update({ where: { id: account.id }, data: { externalAccountId: "ig-999" } });
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    const rows = await prisma.publishIntent.findMany({ where: { scheduledPostId: post.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].snapshotHash).toBe(first.snapshotHash);
  });

  it("enforces the (post, generation) and idempotency key uniqueness in the database", async () => {
    const { owner, post } = await scheduledFixture();
    const intent = await requestPublishIntent(owner.id, post.id, 1);
    const { id: _id, createdAt: _c, updatedAt: _u, snapshot, providerEvidence: _p, ...rest } = intent;
    void _id; void _c; void _u; void _p;
    await expect(prisma.publishIntent.create({ data: { ...rest, snapshot: snapshot as object, idempotencyKey: "different" } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.publishIntent.create({ data: { ...rest, snapshot: snapshot as object, generation: 2 } })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("P6-01 content edit invalidation", () => {
  it("invalidates the schedule and the unsent intent without rewriting the snapshot", async () => {
    const { owner, variant, post } = await scheduledFixture();
    const intent = await requestPublishIntent(owner.id, post.id, 1);
    await updateContentVariant(owner.id, variant.id, edit("Edited after intent"));

    const after = await prisma.publishIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.state).toBe("INVALIDATED");
    expect(after.invalidatedAt).not.toBeNull();
    expect(after.snapshotHash).toBe(intent.snapshotHash);
    expect((after.snapshot as unknown as PublishSnapshotV1).content.caption).toBe("Original caption");
    expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("INVALIDATED");
    expect(await checkPublishIntentDispatchable(intent.id)).toMatchObject({ dispatchable: false });

    // Eski onay intent'i yeniden etkinleştiremez; yeni sürümü onaylamak da geçersiz postu canlandırmaz.
    await expect(requestPublishIntent(owner.id, post.id, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    await approveContentVariant(owner.id, variant.id);
    await expect(requestPublishIntent(owner.id, post.id, 2)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(transitionPublishIntent({ intentId: intent.id, expectedState: "INVALIDATED", evidence: { kind: "LEASE_ACQUIRED", leaseExpiresAt: future() } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await isScheduledPostPublishable(post.id)).toBe(false);
  });

  it("moves an in-flight intent to UNKNOWN on edit and never re-dispatches it", async () => {
    const { owner, variant, post } = await scheduledFixture();
    const intent = await requestPublishIntent(owner.id, post.id, 1);
    await transitionPublishIntent({ intentId: intent.id, expectedState: "PENDING", evidence: { kind: "LEASE_ACQUIRED", leaseExpiresAt: future() } });
    await updateContentVariant(owner.id, variant.id, edit("Edited while in flight"));

    const after = await prisma.publishIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.state).toBe("UNKNOWN");
    expect(after.invalidatedAt).not.toBeNull();
    expect(after.snapshotHash).toBe(intent.snapshotHash);
    await expect(transitionPublishIntent({ intentId: intent.id, expectedState: "UNKNOWN", evidence: { kind: "RECONCILED_NOT_FOUND" } })).rejects.toMatchObject({ code: "CONFLICT" });
    // Doğrulanmış sağlayıcı kanıtı ise eski sürümün gerçekten yayınlandığını kaydedebilir.
    const published = await transitionPublishIntent({ intentId: intent.id, expectedState: "UNKNOWN", evidence: { kind: "RECONCILED_PUBLISHED", providerReference: "remote-1", publishedAt: new Date() } });
    expect(published.state).toBe("PUBLISHED");
  });
});

describe("P6-01 state transitions and uncertainty", () => {
  const subject = (state: PublishIntentState, invalidatedAt: Date | null = null) => ({ state, invalidatedAt });
  const lease: PublishIntentEvidence = { kind: "LEASE_ACQUIRED", leaseExpiresAt: new Date() };
  const confirmed: PublishIntentEvidence = { kind: "PROVIDER_CONFIRMED", providerReference: "remote-1", publishedAt: new Date() };
  const timeout: PublishIntentEvidence = { kind: "OUTCOME_UNKNOWN", reason: "TIMEOUT" };

  it("allows only the documented legal transitions", () => {
    expect(planIntentTransition(subject("PENDING"), lease).to).toBe("IN_FLIGHT");
    expect(planIntentTransition(subject("RETRY_WAIT"), lease).to).toBe("IN_FLIGHT");
    expect(planIntentTransition(subject("IN_FLIGHT"), confirmed).to).toBe("PUBLISHED");
    expect(planIntentTransition(subject("IN_FLIGHT"), { kind: "PROVIDER_REJECTED", retryable: true, errorCode: "RATE_LIMIT" }).to).toBe("RETRY_WAIT");
    expect(planIntentTransition(subject("IN_FLIGHT"), { kind: "PROVIDER_REJECTED", retryable: false, errorCode: "INVALID_MEDIA" }).to).toBe("FAILED");
    expect(planIntentTransition(subject("IN_FLIGHT"), timeout).to).toBe("UNKNOWN");
    expect(planIntentTransition(subject("UNKNOWN"), { kind: "RECONCILED_PUBLISHED", providerReference: "r", publishedAt: new Date() }).to).toBe("PUBLISHED");
    expect(planIntentTransition(subject("UNKNOWN"), { kind: "RECONCILED_NOT_FOUND" }).to).toBe("RETRY_WAIT");
    expect(planIntentTransition(subject("RETRY_WAIT"), { kind: "RETRY_BUDGET_EXHAUSTED" }).to).toBe("FAILED");
    expect(planIntentTransition(subject("PENDING"), { kind: "USER_CANCELLED" }).to).toBe("CANCELLED");
    expect(planIntentTransition(subject("PENDING"), { kind: "SOURCE_INVALIDATED" }).to).toBe("INVALIDATED");
  });

  it("rejects impossible, duplicate and terminal transitions", () => {
    const illegal: [PublishIntentState, PublishIntentEvidence][] = [
      ["PENDING", confirmed],
      ["PENDING", timeout],
      ["IN_FLIGHT", lease],
      ["UNKNOWN", timeout],
      ["UNKNOWN", lease],
      ["UNKNOWN", { kind: "USER_CANCELLED" }],
      ["UNKNOWN", { kind: "RETRY_BUDGET_EXHAUSTED" }],
      ["IN_FLIGHT", { kind: "SOURCE_INVALIDATED" }],
      ["PUBLISHED", confirmed],
      ["PUBLISHED", lease],
      ["FAILED", lease],
      ["CANCELLED", lease],
      ["INVALIDATED", lease],
    ];
    for (const [state, evidence] of illegal) {
      expect(() => planIntentTransition(subject(state), evidence), `${state} + ${evidence.kind}`).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    }
    expect(() => planIntentTransition(subject("IN_FLIGHT"), { ...confirmed, providerReference: " " })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("treats silence and timeouts as UNKNOWN, never as published or definitively failed", () => {
    const now = new Date();
    const expired = new Date(now.getTime() - 1);
    expect(evidenceForElapsedTime({ state: "IN_FLIGHT", leaseExpiresAt: expired }, now)).toEqual({ kind: "OUTCOME_UNKNOWN", reason: "LEASE_EXPIRED" });
    expect(evidenceForElapsedTime({ state: "IN_FLIGHT", leaseExpiresAt: new Date(now.getTime() + 60_000) }, now)).toBeNull();
    expect(evidenceForElapsedTime({ state: "UNKNOWN", leaseExpiresAt: expired }, now)).toBeNull();
    expect(evidenceForElapsedTime({ state: "PENDING", leaseExpiresAt: null }, now)).toBeNull();

    const fromTimeout = evidenceFromSubmitOutcome({ kind: "UNKNOWN", reason: "TIMEOUT" });
    expect(planIntentTransition(subject("IN_FLIGHT"), fromTimeout).to).toBe("UNKNOWN");
    expect(evidenceFromReconcileResult({ kind: "UNKNOWN", reason: "TIMEOUT" })).toBeNull();
    expect(evidenceFromReconcileResult({ kind: "NOT_FOUND", authoritative: false })).toBeNull();
    expect(evidenceFromReconcileResult({ kind: "NOT_FOUND", authoritative: true })).toEqual({ kind: "RECONCILED_NOT_FOUND" });
  });

  it("records an attempt outcome only once", () => {
    const outcome = { kind: "UNKNOWN", reason: "TIMEOUT" } as const;
    expect(attemptStatusForOutcome("PENDING", outcome)).toBe("UNKNOWN");
    expect(attemptStatusForOutcome("PENDING", { kind: "PUBLISHED", providerReference: "r", remotePostId: "p", publishedAt: new Date() })).toBe("SUCCESS");
    for (const done of ["SUCCESS", "FAILED", "UNKNOWN"] as const) {
      expect(() => attemptStatusForOutcome(done, outcome)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    }
  });

  it("rejects stale and concurrent duplicate transitions in the database", async () => {
    const { owner, post } = await scheduledFixture();
    const intent = await requestPublishIntent(owner.id, post.id, 1);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => transitionPublishIntent({ intentId: intent.id, expectedState: "PENDING", evidence: { kind: "LEASE_ACQUIRED", leaseExpiresAt: future() } })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.publishIntent.findUniqueOrThrow({ where: { id: intent.id } })).state).toBe("IN_FLIGHT");
    await expect(transitionPublishIntent({ intentId: intent.id, expectedState: "PENDING", evidence: { kind: "USER_CANCELLED" } })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("sets the scheduled post PUBLISHED only with provider evidence", async () => {
    const { owner, post } = await scheduledFixture();
    const intent = await requestPublishIntent(owner.id, post.id, 1);
    await transitionPublishIntent({ intentId: intent.id, expectedState: "PENDING", evidence: { kind: "LEASE_ACQUIRED", leaseExpiresAt: future() } });
    const unknown = await transitionPublishIntent({ intentId: intent.id, expectedState: "IN_FLIGHT", evidence: { kind: "OUTCOME_UNKNOWN", reason: "TIMEOUT" } });
    expect(unknown.state).toBe("UNKNOWN");
    expect(unknown.publishedAt).toBeNull();
    expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("SCHEDULED");

    const publishedAt = new Date();
    const published = await transitionPublishIntent({ intentId: intent.id, expectedState: "UNKNOWN", evidence: { kind: "RECONCILED_PUBLISHED", providerReference: "remote-42", publishedAt } });
    expect(published).toMatchObject({ state: "PUBLISHED", providerReference: "remote-42" });
    expect(published.publishedAt?.getTime()).toBe(publishedAt.getTime());
    expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("PUBLISHED");
  });

  it("refuses dispatch when the stored snapshot no longer matches its hash", async () => {
    const { owner, post } = await scheduledFixture();
    const intent = await requestPublishIntent(owner.id, post.id, 1);
    const tampered = { ...(intent.snapshot as object), content: { ...(intent.snapshot as unknown as PublishSnapshotV1).content, caption: "Tampered" } };
    await prisma.publishIntent.update({ where: { id: intent.id }, data: { snapshot: JSON.parse(JSON.stringify(tampered)) } });
    expect(await checkPublishIntentDispatchable(intent.id)).toEqual({ dispatchable: false, reason: "SNAPSHOT" });
  });
});

describe("P6-01 migration compatibility", () => {
  it("keeps legacy schedule and attempt rows valid without backfilling intents", async () => {
    const { post } = await scheduledFixture();
    const legacy = await prisma.publishAttempt.create({ data: { scheduledPostId: post.id, status: "FAILED", errorCode: "LEGACY" } });
    await prisma.publishAttempt.create({ data: { scheduledPostId: post.id } });
    expect(legacy).toMatchObject({ publishIntentId: null, attemptNumber: null, outcome: null, providerReference: null, diagnostics: null });
    expect(await prisma.publishAttempt.count({ where: { scheduledPostId: post.id } })).toBe(2);
    expect(await prisma.publishIntent.count()).toBe(0);
    expect(await isScheduledPostPublishable(post.id)).toBe(true);
  });
});
