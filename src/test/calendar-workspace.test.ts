import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCalendarWeekSummary, getCalendarWorkspace } from "@/features/calendar/service";
import {
  buildCalendarProjection,
  calendarRange,
  shiftCalendarAnchor,
  startOfCalendarWeek,
  summarizeCalendarEvents,
  zonedDay,
  zonedTime,
  type ProjectionPlanItem,
} from "@/features/calendar/projection";
import { calendarStatusIcons, calendarStatusLabels } from "@/features/calendar/labels";
import type { ContentPlanStatus, MediaAssetOrigin, MediaAvailability, MediaRequirement, SocialPlatform } from "../../generated/prisma/enums";

// 2026-10-05 bir Pazartesi; işletme-yerel hafta 05–11 Ekim 2026.
const now = new Date("2026-10-05T09:00:00.000Z");
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function fixture(options: { timezone?: string } = {}) {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `cal-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `cal-out-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({ data: {
    name: "Mimoza", sector: "RESTAURANT", timezone: options.timezone ?? "Europe/Istanbul",
    memberships: { create: { userId: owner.id, role: "OWNER" } },
    goals: { create: [{ type: "RESERVATIONS", priority: "PRIMARY" }] },
  }, include: { goals: true } });
  const otherBusiness = await prisma.business.create({ data: {
    name: "Komşu", sector: "CAFE", timezone: "Europe/Istanbul",
    memberships: { create: { userId: outsider.id, role: "OWNER" } },
    goals: { create: [{ type: "RESERVATIONS", priority: "PRIMARY" }] },
  }, include: { goals: true } });
  return { owner, outsider, business, otherBusiness };
}

async function createStrategy(businessId: string) {
  return prisma.contentStrategy.create({ data: {
    businessId, mode: "AINETRA_RECOMMENDED",
    platformSettings: [{ platform: "INSTAGRAM", enabled: true, weeklyFrequency: 2, contentTypes: ["POST"] }],
    contentMix: [{ pillar: "PRODUCT", percentage: 100 }], languages: ["tr"], rationale: "Test stratejisi", approvedAt: now,
  } });
}

async function createPlan(businessId: string, options: { status?: ContentPlanStatus; version?: number; startDate?: string } = {}) {
  const strategy = await prisma.contentStrategy.findUnique({ where: { businessId } }) ?? await createStrategy(businessId);
  const startDate = options.startDate ?? "2026-10-05";
  return prisma.contentPlan.create({ data: {
    businessId, strategyId: strategy.id, period: "SEVEN_DAYS", startDate: day(startDate), endDate: day("2026-10-11"),
    timezone: "Europe/Istanbul", version: options.version ?? 1, status: options.status ?? "APPROVED",
    strategySummary: "Hafta özeti", strategySnapshot: {}, platformStrategies: [], contentMix: [],
    provider: "test", model: "test", promptVersion: "test-v1", inputHash: crypto.randomUUID(),
  } });
}

async function createItem(planId: string, goalId: string, options: {
  plannedDate?: string;
  recommendedTime?: string;
  platform?: SocialPlatform;
  mediaRequirement?: MediaRequirement;
  mediaAvailability?: MediaAvailability;
  mediaAssetId?: string | null;
  contentItemId?: string | null;
  status?: "ACTIVE" | "REPLACED";
  topic?: string;
} = {}) {
  return prisma.contentPlanItem.create({ data: {
    planId, goalId,
    platform: options.platform ?? "INSTAGRAM", contentType: "POST",
    plannedDate: day(options.plannedDate ?? "2026-10-07"), recommendedTime: options.recommendedTime ?? "19:30",
    pillar: "PRODUCT", topic: options.topic ?? "Akşam servisi", concept: "Akşam servisini göster",
    hookCategory: "QUESTION", hook: "Akşam ne yiyoruz?", captionDirection: "Kısa ve davetkâr",
    cta: "Rezervasyon için yaz", language: "tr",
    mediaRequirement: options.mediaRequirement ?? "PHOTO_PRODUCT",
    mediaAvailability: options.mediaAvailability ?? "MISSING",
    mediaAssetId: options.mediaAssetId ?? null,
    contentItemId: options.contentItemId ?? null,
    status: options.status ?? "ACTIVE",
    reasoning: "Ürün sütunu bu hafta öne çıkıyor", platformRulesApplied: [],
  } });
}

async function createAsset(businessId: string, options: { origin?: MediaAssetOrigin; tags?: string[]; filename?: string } = {}) {
  return prisma.mediaAsset.create({ data: {
    businessId, type: "IMAGE", originalFilename: options.filename ?? "urun.jpg", mimeType: "image/jpeg", size: 1024,
    storageKey: `cal/${crypto.randomUUID()}.jpg`, tags: options.tags ?? ["PHOTO_PRODUCT"], origin: options.origin ?? "UPLOAD",
  } });
}

async function createApprovedContent(businessId: string, ownerId: string, options: { version?: number; approvedVersion?: number | null; platform?: SocialPlatform } = {}) {
  const version = options.version ?? 1;
  const item = await prisma.contentItem.create({ data: { businessId, title: "Akşam servisi gönderisi", topic: "Akşam servisi", contentType: "POST" } });
  const variant = await prisma.contentVariant.create({ data: { contentItemId: item.id, platform: options.platform ?? "INSTAGRAM", caption: "Bu akşam mutfakta.", version } });
  const approvedVersion = options.approvedVersion === undefined ? version : options.approvedVersion;
  if (approvedVersion !== null) {
    await prisma.approval.create({ data: { contentVariantId: variant.id, approvedVersion, approvedById: ownerId } });
  }
  return { item, variant };
}

async function createScheduledPost(businessId: string, variantId: string, options: { scheduledAt: string; contentVersion: number; status?: "SCHEDULED" | "INVALIDATED" }) {
  const account = await prisma.socialAccount.create({ data: { businessId, platform: "INSTAGRAM", displayName: "@mimoza", status: "CONNECTED" } });
  return prisma.scheduledPost.create({ data: {
    businessId, socialAccountId: account.id, contentVariantId: variantId,
    contentVersion: options.contentVersion, scheduledAt: new Date(options.scheduledAt), status: options.status ?? "SCHEDULED",
  } });
}

function planItemInput(overrides: Partial<ProjectionPlanItem> = {}): ProjectionPlanItem {
  return {
    id: "item-1", businessId: "business-1", planId: "plan-1", planStatus: "APPROVED", itemStatus: "ACTIVE",
    platform: "INSTAGRAM", contentType: "POST", plannedDate: day("2026-10-07"), recommendedTime: "19:30",
    topic: "Akşam servisi", concept: "Akşam servisini göster",
    mediaRequirement: "PHOTO_PRODUCT", mediaAvailability: "MISSING", mediaAsset: null,
    contentItem: null, captureRequest: null, fallbackProposalPending: false,
    ...overrides,
  };
}

function project(items: ProjectionPlanItem[], businessId = "business-1") {
  return buildCalendarProjection({
    businessId, timeZone: "Europe/Istanbul", today: "2026-10-05",
    range: { from: "2026-10-05", to: "2026-10-12" }, planItems: items, scheduledPosts: [],
  });
}

describe("Ainetra P5.5A calendar projection", () => {
  it("keeps every status label and icon in plain Turkish rather than raw enum values", () => {
    for (const [status, label] of Object.entries(calendarStatusLabels)) {
      expect(label).not.toBe(status);
      expect(label).not.toMatch(/^[A-Z_]+$/);
      expect(calendarStatusIcons[status as keyof typeof calendarStatusIcons]).toBeTruthy();
    }
    expect(calendarStatusLabels.MEDIA_NEEDED).toBe("Medya gerekli");
    expect(calendarStatusLabels.READY).toBe("Hazır");
  });

  it("maps a missing media requirement to Medya gerekli with a plain need sentence", () => {
    const [event] = project([planItemInput()]);
    expect(event.status).toBe("MEDIA_NEEDED");
    expect(event.need).toBe("Ürün fotoğrafı gerekiyor.");
    expect(event.statusReason).not.toContain("PHOTO_PRODUCT");
    expect(event.requiresUserAction).toBe(true);
  });

  it("drops rows that belong to another business", () => {
    const events = project([planItemInput({ id: "mine" }), planItemInput({ id: "theirs", businessId: "business-2" })]);
    expect(events.map((event) => event.refId)).toEqual(["mine"]);
  });

  it("does not let a designed creative satisfy an authentic photo requirement", () => {
    const designed = { id: "asset-1", originalFilename: "tasarim.png", origin: "CREATIVE_CAMPAIGN" as MediaAssetOrigin };
    const [photo] = project([planItemInput({ mediaRequirement: "PHOTO_PRODUCT", mediaAvailability: "AVAILABLE", mediaAsset: designed })]);
    expect(photo.status).toBe("MEDIA_NEEDED");
    expect(photo.designedCreative).toBe(true);
    expect(photo.statusReason).toContain("tasarım");
    const [graphic] = project([planItemInput({ mediaRequirement: "CUSTOM_GRAPHIC", mediaAvailability: "AVAILABLE", mediaAsset: designed })]);
    expect(graphic.status).toBe("PLANNED");
  });

  it("only offers the Ainetra help route when the existing fallback engine would accept the item", () => {
    const [past] = project([planItemInput({ plannedDate: day("2026-10-05") })]);
    expect(past.fallbackEligible).toBe(true);
    const [older] = project([planItemInput({ plannedDate: day("2026-10-04") })]);
    expect(older).toBeUndefined();
    const projected = buildCalendarProjection({
      businessId: "business-1", timeZone: "Europe/Istanbul", today: "2026-10-08",
      range: { from: "2026-10-05", to: "2026-10-12" },
      planItems: [planItemInput({ plannedDate: day("2026-10-07") })], scheduledPosts: [],
    });
    expect(projected[0].fallbackEligible).toBe(false);
    const asset = { id: "asset-2", originalFilename: "urun.jpg", origin: "UPLOAD" as MediaAssetOrigin };
    const [covered] = project([planItemInput({ mediaAvailability: "AVAILABLE", mediaAsset: asset })]);
    expect(covered.fallbackEligible).toBe(false);
    const [pending] = project([planItemInput({ fallbackProposalPending: true })]);
    expect(pending.status).toBe("AINETRA_CAN_HELP");
    expect(pending.fallbackEligible).toBe(true);
  });

  it("requires the current content version to be approved before calling an item ready", () => {
    const asset = { id: "asset-3", originalFilename: "urun.jpg", origin: "UPLOAD" as MediaAssetOrigin };
    const base = { mediaAvailability: "AVAILABLE" as MediaAvailability, mediaAsset: asset };
    const [stale] = project([planItemInput({ ...base, contentItem: { id: "content-1", title: "Gönderi", variants: [{ platform: "INSTAGRAM", version: 2, approvedVersions: [1] }] } })]);
    expect(stale.status).toBe("ACTION_NEEDED");
    const [ready] = project([planItemInput({ ...base, contentItem: { id: "content-1", title: "Gönderi", variants: [{ platform: "INSTAGRAM", version: 2, approvedVersions: [1, 2] }] } })]);
    expect(ready.status).toBe("READY");
  });

  it("computes week, month and year ranges on business-local calendar days", () => {
    expect(startOfCalendarWeek("2026-10-07")).toBe("2026-10-05");
    expect(calendarRange("week", "2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-12" });
    expect(calendarRange("month", "2026-10-07")).toEqual({ from: "2026-09-28", to: "2026-11-09" });
    expect(calendarRange("year", "2026-10-07")).toEqual({ from: "2026-01-01", to: "2027-01-01" });
    expect(shiftCalendarAnchor("month", "2026-10-07", 1)).toBe("2026-11-01");
    expect(shiftCalendarAnchor("year", "2026-10-07", -1)).toBe("2025-01-01");
  });

  it("reads a real instant in the business timezone", () => {
    const instant = new Date("2026-10-05T22:30:00.000Z");
    expect(zonedDay(instant, "Europe/Istanbul")).toBe("2026-10-06");
    expect(zonedTime(instant, "Europe/Istanbul")).toBe("01:30");
    expect(zonedDay(instant, "UTC")).toBe("2026-10-05");
    expect(zonedTime(instant, "UTC")).toBe("22:30");
  });

  it("summarizes counts from the same events the calendar shows", () => {
    const asset = { id: "asset-4", originalFilename: "urun.jpg", origin: "UPLOAD" as MediaAssetOrigin };
    const events = project([
      planItemInput({ id: "a" }),
      planItemInput({ id: "b", fallbackProposalPending: true }),
      planItemInput({ id: "c", mediaAvailability: "AVAILABLE", mediaAsset: asset }),
      planItemInput({ id: "d", mediaAvailability: "AVAILABLE", mediaAsset: asset, contentItem: { id: "content-2", title: "Gönderi", variants: [{ platform: "INSTAGRAM", version: 1, approvedVersions: [1] }] } }),
    ]);
    expect(summarizeCalendarEvents(events)).toMatchObject({ total: 4, ready: 1, planned: 1, mediaNeeded: 1, ainetraCanHelp: 1, actionNeeded: 0, userAction: 2 });
  });
});

describe("Ainetra P5.5A calendar workspace", () => {
  it("refuses a calendar read from outside the business", async () => {
    const { outsider, business } = await fixture();
    await expect(getCalendarWorkspace(outsider.id, business.id, { now })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getCalendarWeekSummary(outsider.id, business.id, { now })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("projects only the current plan version and ACTIVE items", async () => {
    const { owner, business } = await fixture();
    const superseded = await createPlan(business.id, { status: "SUPERSEDED", version: 1 });
    await createItem(superseded.id, business.goals[0].id, { topic: "Eski sürüm" });
    const current = await createPlan(business.id, { status: "APPROVED", version: 2 });
    const active = await createItem(current.id, business.goals[0].id, { topic: "Güncel sürüm" });
    await createItem(current.id, business.goals[0].id, { topic: "Değiştirilmiş öğe", status: "REPLACED" });

    const workspace = await getCalendarWorkspace(owner.id, business.id, { view: "week", now });
    expect(workspace.events.map((event) => event.refId)).toEqual([active.id]);
    expect(workspace.events[0].title).toBe("Güncel sürüm");
    expect(workspace.counts.total).toBe(1);
  });

  it("never shows another tenant's plan item on this business calendar", async () => {
    const { owner, business, otherBusiness } = await fixture();
    const mine = await createPlan(business.id);
    const myItem = await createItem(mine.id, business.goals[0].id, { topic: "Benim öğem" });
    const theirs = await createPlan(otherBusiness.id);
    await createItem(theirs.id, otherBusiness.goals[0].id, { topic: "Komşunun öğesi" });

    const workspace = await getCalendarWorkspace(owner.id, business.id, { view: "week", now });
    expect(workspace.events.map((event) => event.refId)).toEqual([myItem.id]);
    expect(workspace.events.some((event) => event.title === "Komşunun öğesi")).toBe(false);
  });

  it("states the media need and the existing capture guidance for a media-needed day", async () => {
    const { owner, business } = await fixture();
    const plan = await createPlan(business.id);
    const item = await createItem(plan.id, business.goals[0].id, { plannedDate: "2026-10-07", recommendedTime: "19:30", mediaRequirement: "VIDEO_VERTICAL" });
    await prisma.captureRequest.create({ data: {
      businessId: business.id, contentPlanItemId: item.id, mediaRequirement: "VIDEO_VERTICAL", requestedMediaType: "VIDEO",
      title: "Çarşamba Post — Kısa dikey video", instructions: "Telefonu dik tut ve 8–12 saniye kesintisiz çek.", dueAt: day("2026-10-07"),
    } });

    const workspace = await getCalendarWorkspace(owner.id, business.id, { view: "day", anchor: "2026-10-07", now });
    const [event] = workspace.events;
    expect(event.status).toBe("MEDIA_NEEDED");
    expect(event.date).toBe("2026-10-07");
    expect(event.time).toBe("19:30");
    expect(event.need).toBe("Dikey video gerekiyor.");
    expect(event.captureGuidance?.instructions).toContain("8–12 saniye");
    expect(event.fallbackEligible).toBe(true);
    expect(event.contentItemId).toBeNull();
  });

  it("does not treat a designed creative as the authentic media a plan item asks for", async () => {
    const { owner, business } = await fixture();
    const plan = await createPlan(business.id);
    const design = await createAsset(business.id, { origin: "CREATIVE_CAMPAIGN", tags: ["CUSTOM_GRAPHIC"], filename: "kampanya.png" });
    await createItem(plan.id, business.goals[0].id, { mediaRequirement: "PHOTO_PRODUCT", mediaAvailability: "AVAILABLE", mediaAssetId: design.id });

    const workspace = await getCalendarWorkspace(owner.id, business.id, { view: "week", now });
    expect(workspace.events[0].status).toBe("MEDIA_NEEDED");
    expect(workspace.events[0].designedCreative).toBe(true);
    expect(workspace.counts.ready).toBe(0);
  });

  it("places a scheduled post on the business-local day and keeps version safety visible", async () => {
    const { owner, business } = await fixture({ timezone: "Europe/Istanbul" });
    const { variant } = await createApprovedContent(business.id, owner.id, { version: 1 });
    await createScheduledPost(business.id, variant.id, { scheduledAt: "2026-10-05T22:30:00.000Z", contentVersion: 1 });

    const onFifth = await getCalendarWorkspace(owner.id, business.id, { view: "day", anchor: "2026-10-05", now });
    expect(onFifth.events).toHaveLength(0);
    const onSixth = await getCalendarWorkspace(owner.id, business.id, { view: "day", anchor: "2026-10-06", now });
    expect(onSixth.events).toHaveLength(1);
    expect(onSixth.events[0].time).toBe("01:30");
    expect(onSixth.events[0].status).toBe("READY");
    expect(onSixth.events[0].accountName).toBe("@mimoza");

    await prisma.contentVariant.update({ where: { id: variant.id }, data: { version: 2 } });
    const afterEdit = await getCalendarWorkspace(owner.id, business.id, { view: "day", anchor: "2026-10-06", now });
    expect(afterEdit.events[0].status).toBe("ACTION_NEEDED");
    expect(afterEdit.events[0].need).toContain("onaylay");
  });

  it("uses the business timezone, not the server clock, for the scheduled day", async () => {
    const owner = await prisma.user.create({ data: { name: "UTC Owner", email: `cal-utc-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
    const business = await prisma.business.create({ data: {
      name: "Londra", sector: "CAFE", timezone: "UTC",
      memberships: { create: { userId: owner.id, role: "OWNER" } },
    } });
    const { variant } = await createApprovedContent(business.id, owner.id, { version: 1 });
    await createScheduledPost(business.id, variant.id, { scheduledAt: "2026-10-05T22:30:00.000Z", contentVersion: 1 });

    const workspace = await getCalendarWorkspace(owner.id, business.id, { view: "day", anchor: "2026-10-05", now });
    expect(workspace.events).toHaveLength(1);
    expect(workspace.events[0].time).toBe("22:30");
  });

  it("summarizes the week for the dashboard with the same projection policy", async () => {
    const { owner, business } = await fixture();
    const superseded = await createPlan(business.id, { status: "SUPERSEDED", version: 1 });
    await createItem(superseded.id, business.goals[0].id, { topic: "Eski sürüm" });
    const plan = await createPlan(business.id, { status: "APPROVED", version: 2 });
    const asset = await createAsset(business.id);
    const { item: contentItem } = await createApprovedContent(business.id, owner.id, { version: 1 });
    await createItem(plan.id, business.goals[0].id, { plannedDate: "2026-10-06", mediaRequirement: "PHOTO_PRODUCT", mediaAvailability: "AVAILABLE", mediaAssetId: asset.id, contentItemId: contentItem.id });
    await createItem(plan.id, business.goals[0].id, { plannedDate: "2026-10-08", topic: "Medya bekleyen" });
    // Hafta dışındaki öğe bu haftanın sayımına girmez.
    await createItem(plan.id, business.goals[0].id, { plannedDate: "2026-10-20", topic: "Gelecek hafta" });

    const summary = await getCalendarWeekSummary(owner.id, business.id, { now });
    expect(summary.weekStart).toBe("2026-10-05");
    expect(summary.weekEnd).toBe("2026-10-11");
    expect(summary.counts).toMatchObject({ total: 2, ready: 1, userAction: 1, mediaNeeded: 1 });
    expect(summary.nextActions).toHaveLength(1);
    expect(summary.nextActions[0].title).toBe("Medya bekleyen");
    expect(summary.nextActions.every((event) => event.requiresUserAction)).toBe(true);
  });
});
