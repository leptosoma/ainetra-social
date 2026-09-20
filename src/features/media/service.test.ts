import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { uploadMedia, updateMediaPlanningTags } from "@/features/media/service";
import { syncCaptureRequestsForActiveItems } from "@/features/capture-engine/service";

async function businessFixture() {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `media-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({
    data: {
      name: "Mimoza", sector: "RESTAURANT", timezone: "Europe/Istanbul",
      memberships: { create: { userId: owner.id, role: "OWNER" } },
      goals: { create: [{ type: "RESERVATIONS", priority: "PRIMARY" }] },
    },
    include: { goals: true },
  });
  return { owner, business, goalId: business.goals[0].id };
}

async function planItemFixture(businessId: string, goalId: string, mediaRequirement: string) {
  const strategy = await prisma.contentStrategy.upsert({
    where: { businessId },
    create: { businessId, mode: "CUSTOM", platformSettings: [], contentMix: [], languages: ["tr"], rationale: "test", approvedAt: new Date() },
    update: {},
  });
  const period = "SEVEN_DAYS" as const;
  const startDate = new Date("2026-10-05T00:00:00.000Z");
  const previousPlan = await prisma.contentPlan.findFirst({ where: { businessId, period, startDate }, orderBy: { version: "desc" } });
  const plan = await prisma.contentPlan.create({
    data: {
      businessId, strategyId: strategy.id, period, startDate, endDate: new Date("2026-10-11T00:00:00.000Z"),
      version: (previousPlan?.version ?? 0) + 1,
      timezone: "Europe/Istanbul", strategySummary: "test", strategySnapshot: {}, platformStrategies: {}, contentMix: {},
      provider: "test", model: "test", promptVersion: "test", inputHash: crypto.randomUUID(),
    },
  });
  return prisma.contentPlanItem.create({
    data: {
      planId: plan.id, goalId, platform: "INSTAGRAM", contentType: "REEL",
      plannedDate: new Date("2026-10-09T00:00:00.000Z"), recommendedTime: "19:30",
      pillar: "ATMOSPHERE", topic: "Akşam atmosferi", concept: "Akşam atmosferini göster", hookCategory: "curiosity", hook: "Akşam yaklaşıyor",
      captionDirection: "Sıcak bir dille anlat", cta: "Rezervasyon yapın", language: "tr",
      mediaRequirement: mediaRequirement as never, mediaAvailability: "MISSING" as never,
      reasoning: "test", platformRulesApplied: [],
    },
  });
}

// Gerçek bir kod çözücüyü tatmin eden tam bir video üretmiyoruz; servis yalnızca
// konteyner imzasını (magic bytes) doğruluyor, bu da testin amacına uygun.
function fakeMp4(totalSize = 64): Uint8Array {
  const buffer = new Uint8Array(totalSize);
  const box = new TextEncoder().encode("....ftypisom");
  buffer.set(box.subarray(0, Math.min(box.length, totalSize)));
  return buffer;
}

function fakeWebm(totalSize = 64): Uint8Array {
  const buffer = new Uint8Array(totalSize);
  buffer[0] = 0x1a; buffer[1] = 0x45; buffer[2] = 0xdf; buffer[3] = 0xa3;
  return buffer;
}

async function realJpeg(): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer();
  return new Uint8Array(buffer);
}

function blobBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

describe("Ainetra Phase 4 B2 — video upload", () => {
  it("uploads a valid MP4, stores it as VIDEO, and fulfills the matching CaptureRequest", async () => {
    const { owner, business, goalId } = await businessFixture();
    const item = await planItemFixture(business.id, goalId, "VIDEO_VERTICAL");
    await prisma.$transaction((tx) => syncCaptureRequestsForActiveItems(tx, { id: business.id, sector: business.sector, timezone: business.timezone }, [item]));

    const file = new File([blobBytes(fakeMp4())], "teras.mp4", { type: "video/mp4" });
    const created = await uploadMedia(owner.id, business.id, file, ["VIDEO_VERTICAL"]);
    expect(created.type).toBe("VIDEO");
    expect(created.width).toBeNull();
    expect(created.height).toBeNull();

    const request = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } });
    expect(request.status).toBe("FULFILLED");
    expect(request.fulfilledByMediaAssetId).toBe(created.id);
  });

  it("accepts a valid WebM video", async () => {
    const { owner, business } = await businessFixture();
    const file = new File([blobBytes(fakeWebm())], "atmosfer.webm", { type: "video/webm" });
    const created = await uploadMedia(owner.id, business.id, file, ["VIDEO_KITCHEN"]);
    expect(created.type).toBe("VIDEO");
    expect(created.mimeType).toBe("video/webm");
  });

  it("rejects a file whose declared MIME does not match its byte signature", async () => {
    const { owner, business } = await businessFixture();
    const notActuallyMp4 = new Uint8Array(64).fill(0x41);
    const file = new File([blobBytes(notActuallyMp4)], "sahte.mp4", { type: "video/mp4" });
    await expect(uploadMedia(owner.id, business.id, file, ["VIDEO_VERTICAL"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a video larger than MAX_VIDEO_UPLOAD_BYTES", async () => {
    const { owner, business } = await businessFixture();
    const original = process.env.MAX_VIDEO_UPLOAD_BYTES;
    process.env.MAX_VIDEO_UPLOAD_BYTES = "1000";
    try {
      const file = new File([blobBytes(fakeMp4(2000))], "buyuk.mp4", { type: "video/mp4" });
      await expect(uploadMedia(owner.id, business.id, file, [])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    } finally {
      if (original === undefined) delete process.env.MAX_VIDEO_UPLOAD_BYTES;
      else process.env.MAX_VIDEO_UPLOAD_BYTES = original;
    }
  });

  it("rejects tagging a video file with an image-only requirement", async () => {
    const { owner, business } = await businessFixture();
    const file = new File([blobBytes(fakeMp4())], "video.mp4", { type: "video/mp4" });
    await expect(uploadMedia(owner.id, business.id, file, ["PHOTO_PRODUCT"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects tagging an image file with a video-only requirement", async () => {
    const { owner, business } = await businessFixture();
    const file = new File([blobBytes(await realJpeg())], "urun.jpg", { type: "image/jpeg" });
    await expect(uploadMedia(owner.id, business.id, file, ["VIDEO_VERTICAL"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("still accepts a valid JPEG and stores it as IMAGE (regression)", async () => {
    const { owner, business } = await businessFixture();
    const file = new File([blobBytes(await realJpeg())], "urun.jpg", { type: "image/jpeg" });
    const created = await uploadMedia(owner.id, business.id, file, ["PHOTO_PRODUCT"]);
    expect(created.type).toBe("IMAGE");
    expect(created.width).toBe(4);
    expect(created.height).toBe(4);
  });

  it("updateMediaPlanningTags accepts video tags for a video asset and fulfills a matching CaptureRequest", async () => {
    const { owner, business, goalId } = await businessFixture();
    const item = await planItemFixture(business.id, goalId, "VIDEO_KITCHEN");
    await prisma.$transaction((tx) => syncCaptureRequestsForActiveItems(tx, { id: business.id, sector: business.sector, timezone: business.timezone }, [item]));
    const asset = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "VIDEO", originalFilename: "hazirlik.mp4", mimeType: "video/mp4", size: 100, storageKey: `${business.id}/${crypto.randomUUID()}.mp4`, tags: [] },
    });
    await updateMediaPlanningTags(owner.id, asset.id, ["VIDEO_KITCHEN"]);
    const request = await prisma.captureRequest.findFirstOrThrow({ where: { contentPlanItemId: item.id } });
    expect(request.status).toBe("FULFILLED");
    expect(request.fulfilledByMediaAssetId).toBe(asset.id);
  });

  it("updateMediaPlanningTags rejects an image tag for a video asset", async () => {
    const { owner, business } = await businessFixture();
    const asset = await prisma.mediaAsset.create({
      data: { businessId: business.id, type: "VIDEO", originalFilename: "hazirlik.mp4", mimeType: "video/mp4", size: 100, storageKey: `${business.id}/${crypto.randomUUID()}.mp4`, tags: [] },
    });
    await expect(updateMediaPlanningTags(owner.id, asset.id, ["PHOTO_PRODUCT"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
