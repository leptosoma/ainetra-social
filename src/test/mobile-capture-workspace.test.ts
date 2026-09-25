import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { listCurrentCaptureRequests } from "@/features/capture-engine/service";
import { buildCapturePrompt, captureAcceptByMediaType, type CapturePromptSource } from "@/features/capture-engine/prompt";
import { uploadMediaForCaptureRequest } from "@/features/media/service";
import { getCalendarWorkspace, getMobileCalendar, getTodayAgenda } from "@/features/calendar/service";
import {
  groupCalendarEventsByDay,
  isMobileCalendarView,
  mobileCalendarRange,
  mobileViewForDesktop,
  shiftMobileCalendarAnchor,
  type CalendarEvent,
} from "@/features/calendar/projection";
import { businessNavigation, dockNavigation, isNavigationActive, navigation } from "@/components/navigation";
import type { ContentPlanStatus, MediaAvailability, MediaRequirement, MediaType } from "../../generated/prisma/enums";

// 2026-10-05 Pazartesi. İstanbul'da 2026-10-06T22:30Z = 7 Ekim 01:30; UTC'de hâlâ 6 Ekim.
const now = new Date("2026-10-05T09:00:00.000Z");
const lateNight = new Date("2026-10-06T22:30:00.000Z");
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function fixture(options: { timezone?: string } = {}) {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `mob-owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `mob-out-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
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

async function createPlan(businessId: string, options: { status?: ContentPlanStatus; version?: number } = {}) {
  const strategy = await prisma.contentStrategy.upsert({
    where: { businessId },
    create: { businessId, mode: "AINETRA_RECOMMENDED", platformSettings: [], contentMix: [], languages: ["tr"], rationale: "Test", approvedAt: now },
    update: {},
  });
  return prisma.contentPlan.create({ data: {
    businessId, strategyId: strategy.id, period: "SEVEN_DAYS", startDate: day("2026-10-05"), endDate: day("2026-10-11"),
    timezone: "Europe/Istanbul", version: options.version ?? 1, status: options.status ?? "APPROVED",
    strategySummary: "Hafta", strategySnapshot: {}, platformStrategies: [], contentMix: [],
    provider: "test", model: "test", promptVersion: "test-v1", inputHash: crypto.randomUUID(),
  } });
}

async function createItem(planId: string, goalId: string, options: {
  plannedDate?: string;
  recommendedTime?: string;
  mediaRequirement?: MediaRequirement;
  mediaAvailability?: MediaAvailability;
  status?: "ACTIVE" | "REPLACED";
  topic?: string;
  contentType?: "POST" | "REEL";
} = {}) {
  return prisma.contentPlanItem.create({ data: {
    planId, goalId, platform: "INSTAGRAM", contentType: options.contentType ?? "POST",
    plannedDate: day(options.plannedDate ?? "2026-10-09"), recommendedTime: options.recommendedTime ?? "19:30",
    pillar: "PRODUCT", topic: options.topic ?? "Akşam servisi", concept: "Akşam servisini göster",
    hookCategory: "QUESTION", hook: "Akşam ne yiyoruz?", captionDirection: "Kısa", cta: "Rezervasyon", language: "tr",
    mediaRequirement: options.mediaRequirement ?? "PHOTO_PRODUCT", mediaAvailability: options.mediaAvailability ?? "MISSING",
    status: options.status ?? "ACTIVE", reasoning: "Test", platformRulesApplied: [],
  } });
}

async function createRequest(businessId: string, itemId: string, options: {
  mediaRequirement?: MediaRequirement;
  requestedMediaType?: MediaType;
  dueAt?: string;
  status?: "OPEN" | "FULFILLED" | "DISMISSED" | "EXPIRED";
  title?: string;
} = {}) {
  const mediaRequirement = options.mediaRequirement ?? "PHOTO_PRODUCT";
  return prisma.captureRequest.create({ data: {
    businessId, contentPlanItemId: itemId, mediaRequirement: mediaRequirement as never,
    requestedMediaType: options.requestedMediaType ?? (mediaRequirement.startsWith("VIDEO") ? "VIDEO" : "IMAGE"),
    title: options.title ?? "Cuma Post — Yemek fotoğrafı",
    instructions: "Ürünü doğal ışıkta, masadaki gereksiz objeleri kaldırarak yakın plandan çek.",
    dueAt: day(options.dueAt ?? "2026-10-09"), status: options.status ?? "OPEN",
  } });
}

async function pngFile(name = "urun.png") {
  const buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 30, g: 120, b: 60 } } }).png().toBuffer();
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return new File([copy.buffer], name, { type: "image/png" });
}

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "plan:1", source: "PLAN_ITEM", refId: "1", date: "2026-10-07", time: "19:30", platform: "INSTAGRAM", contentType: "POST",
    title: "Akşam servisi", summary: "", status: "READY", statusReason: "", requiresUserAction: false, need: null,
    mediaRequirement: null, mediaAssetId: null, mediaFilename: null, mediaType: null, designedCreative: false,
    planId: null, contentItemId: null, accountName: null, captureGuidance: null, fallbackEligible: false, fallbackProposalPending: false,
    ...overrides,
  };
}

describe("Ainetra P5.5B current capture context", () => {
  it("returns only this business's current open capture work, never stale or other-tenant rows", async () => {
    const { owner, business, otherBusiness } = await fixture();
    const goalId = business.goals[0].id;
    const plan = await createPlan(business.id);
    const current = await createRequest(business.id, (await createItem(plan.id, goalId, { topic: "Güncel" })).id, { title: "Güncel" });
    await createRequest(business.id, (await createItem(plan.id, goalId, { status: "REPLACED" })).id, { title: "Yerine konmuş" });
    const changed = await createItem(plan.id, goalId, { mediaRequirement: "VIDEO_VERTICAL" });
    await createRequest(business.id, changed.id, { mediaRequirement: "PHOTO_PRODUCT", title: "İhtiyacı değişmiş" });
    await createRequest(business.id, (await createItem(plan.id, goalId, { plannedDate: "2026-10-04" })).id, { dueAt: "2026-10-04", title: "Vadesi geçmiş" });
    await createRequest(business.id, (await createItem(plan.id, goalId)).id, { status: "FULFILLED", title: "Karşılanmış" });
    await createRequest(business.id, (await createItem(plan.id, goalId)).id, { status: "DISMISSED", title: "Reddedilmiş" });
    await createRequest(business.id, (await createItem(plan.id, goalId, { mediaAvailability: "AVAILABLE" })).id, { title: "Medyası var" });
    const oldPlan = await createPlan(business.id, { status: "SUPERSEDED", version: 0 });
    await createRequest(business.id, (await createItem(oldPlan.id, goalId)).id, { title: "Eski plan" });
    const otherPlan = await createPlan(otherBusiness.id);
    await createRequest(otherBusiness.id, (await createItem(otherPlan.id, otherBusiness.goals[0].id)).id, { title: "Komşu" });

    const requests = await listCurrentCaptureRequests(owner.id, business.id, { now });
    expect(requests.map((request) => request.title)).toEqual(["Güncel"]);
    expect(requests[0].id).toBe(current.id);
  });

  it("is read-only: stale open rows are filtered, not rewritten", async () => {
    const { owner, business } = await fixture();
    const plan = await createPlan(business.id);
    const stale = await createRequest(business.id, (await createItem(plan.id, business.goals[0].id, { status: "REPLACED" })).id);
    await listCurrentCaptureRequests(owner.id, business.id, { now });
    expect((await prisma.captureRequest.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("OPEN");
  });

  it("uses the business-local day to decide what is still current", async () => {
    const istanbul = await fixture();
    const plan = await createPlan(istanbul.business.id);
    await createRequest(istanbul.business.id, (await createItem(plan.id, istanbul.business.goals[0].id, { plannedDate: "2026-10-06" })).id, { dueAt: "2026-10-06", title: "Dün" });
    await createRequest(istanbul.business.id, (await createItem(plan.id, istanbul.business.goals[0].id, { plannedDate: "2026-10-07" })).id, { dueAt: "2026-10-07", title: "Bugün" });
    expect((await listCurrentCaptureRequests(istanbul.owner.id, istanbul.business.id, { now: lateNight })).map((request) => request.title)).toEqual(["Bugün"]);

    const utc = await fixture({ timezone: "UTC" });
    const utcPlan = await createPlan(utc.business.id);
    await createRequest(utc.business.id, (await createItem(utcPlan.id, utc.business.goals[0].id, { plannedDate: "2026-10-06" })).id, { dueAt: "2026-10-06", title: "UTC bugün" });
    expect((await listCurrentCaptureRequests(utc.owner.id, utc.business.id, { now: lateNight })).map((request) => request.title)).toEqual(["UTC bugün"]);
  });

  it("refuses to read capture context from outside the business", async () => {
    const { outsider, business } = await fixture();
    await expect(listCurrentCaptureRequests(outsider.id, business.id, { now })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Ainetra P5.5B capture prompt", () => {
  const source = (overrides: Partial<CapturePromptSource> = {}): CapturePromptSource => ({
    id: "req-1", mediaRequirement: "PHOTO_PRODUCT", requestedMediaType: "IMAGE",
    title: "Cuma Post — Yemek fotoğrafı", instructions: "Ürünü doğal ışıkta yakın plandan çek.", dueAt: day("2026-10-09"),
    contentPlanItem: { platform: "INSTAGRAM", contentType: "POST", recommendedTime: "19:30" },
    ...overrides,
  });

  it("turns a photo request into a specific camera prompt with its planning tag", () => {
    const prompt = buildCapturePrompt(source());
    expect(prompt).toMatchObject({
      headline: "Cuma gönderisi için fotoğraf çek",
      actionLabel: "Fotoğraf çek",
      mediaType: "IMAGE",
      mediaRequirement: "PHOTO_PRODUCT",
      accept: captureAcceptByMediaType.IMAGE,
      dueDay: "2026-10-09",
      instructions: "Ürünü doğal ışıkta yakın plandan çek.",
    });
    expect(prompt?.detail).toBe("Ürün fotoğrafı · Instagram gönderi · 9 Ekim, Cuma 19:30");
  });

  it("turns a vertical video request into a video prompt that accepts only video", () => {
    const prompt = buildCapturePrompt(source({
      mediaRequirement: "VIDEO_VERTICAL", requestedMediaType: "VIDEO",
      contentPlanItem: { platform: "INSTAGRAM", contentType: "REEL", recommendedTime: "20:00" },
    }));
    expect(prompt?.headline).toBe("Cuma dikey videosu için video çek");
    expect(prompt?.actionLabel).toBe("Video çek");
    expect(prompt?.accept).toBe("video/mp4,video/quicktime,video/webm");
    expect(prompt?.detail).toContain("Dikey video");
  });

  it("never prompts a capture for a requirement that needs no new media", () => {
    expect(buildCapturePrompt(source({ mediaRequirement: "NO_NEW_MEDIA_REQUIRED" }))).toBeNull();
  });
});

describe("Ainetra P5.5B capture upload", () => {
  it("derives business and tag from the request and fulfils it through the existing media service", async () => {
    const { owner, business } = await fixture();
    const plan = await createPlan(business.id);
    const item = await createItem(plan.id, business.goals[0].id);
    const request = await createRequest(business.id, item.id);

    const asset = await uploadMediaForCaptureRequest(owner.id, request.id, await pngFile(), now);
    expect(asset.businessId).toBe(business.id);
    expect(asset.tags).toEqual(["PHOTO_PRODUCT"]);
    expect(asset.origin).toBe("UPLOAD");

    const fulfilled = await prisma.captureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(fulfilled.status).toBe("FULFILLED");
    expect(fulfilled.fulfilledByMediaAssetId).toBe(asset.id);
    const updatedItem = await prisma.contentPlanItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updatedItem).toMatchObject({ mediaAssetId: asset.id, mediaAvailability: "AVAILABLE" });
  });

  it("denies another tenant's user and stores nothing", async () => {
    const { outsider, business } = await fixture();
    const plan = await createPlan(business.id);
    const request = await createRequest(business.id, (await createItem(plan.id, business.goals[0].id)).id);
    await expect(uploadMediaForCaptureRequest(outsider.id, request.id, await pngFile(), now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);
    expect((await prisma.captureRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("OPEN");
  });

  it("rejects stale, closed and expired requests as no longer current", async () => {
    const { owner, business } = await fixture();
    const plan = await createPlan(business.id);
    const goalId = business.goals[0].id;
    const replaced = await createRequest(business.id, (await createItem(plan.id, goalId, { status: "REPLACED" })).id);
    const dismissed = await createRequest(business.id, (await createItem(plan.id, goalId)).id, { status: "DISMISSED" });
    const pastDue = await createRequest(business.id, (await createItem(plan.id, goalId, { plannedDate: "2026-10-04" })).id, { dueAt: "2026-10-04" });
    for (const request of [replaced, dismissed, pastDue]) {
      await expect(uploadMediaForCaptureRequest(owner.id, request.id, await pngFile(), now)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await prisma.mediaAsset.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("rejects a photo for a video request and keeps the existing file validation", async () => {
    const { owner, business } = await fixture();
    const plan = await createPlan(business.id);
    const request = await createRequest(business.id, (await createItem(plan.id, business.goals[0].id, { mediaRequirement: "VIDEO_VERTICAL" })).id, { mediaRequirement: "VIDEO_VERTICAL" });
    await expect(uploadMediaForCaptureRequest(owner.id, request.id, await pngFile(), now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const text = new File(["merhaba"], "not.txt", { type: "text/plain" });
    await expect(uploadMediaForCaptureRequest(owner.id, request.id, text, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const disguised = new File([new Uint8Array(64).fill(0x41)], "sahte.mp4", { type: "video/mp4" });
    await expect(uploadMediaForCaptureRequest(owner.id, request.id, disguised, now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await prisma.captureRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("OPEN");
  });
});

describe("Ainetra P5.5B mobile calendar presentation", () => {
  it("covers today, three days, a Monday week and only the month's own days", () => {
    expect(mobileCalendarRange("day", "2026-10-07")).toEqual({ from: "2026-10-07", to: "2026-10-08" });
    expect(mobileCalendarRange("3day", "2026-10-07")).toEqual({ from: "2026-10-07", to: "2026-10-10" });
    expect(mobileCalendarRange("week", "2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-12" });
    expect(mobileCalendarRange("month", "2026-10-07")).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    expect(shiftMobileCalendarAnchor("3day", "2026-10-07", 1)).toBe("2026-10-10");
    expect(shiftMobileCalendarAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(mobileViewForDesktop("year")).toBe("month");
    expect(isMobileCalendarView("3day")).toBe(true);
    expect(isMobileCalendarView("year")).toBe(false);
  });

  it("groups events into every day of the range with the calendar's counting policy", () => {
    const days = groupCalendarEventsByDay([
      event({ id: "b", date: "2026-10-09", time: "20:00", status: "MEDIA_NEEDED", requiresUserAction: true }),
      event({ id: "a", date: "2026-10-09", time: "09:00" }),
      event({ id: "outside", date: "2026-10-12" }),
    ], { from: "2026-10-07", to: "2026-10-10" });
    expect(days.map((group) => group.date)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(days[0].events).toEqual([]);
    expect(days[2].events.map((item) => item.id)).toEqual(["a", "b"]);
    expect(days[2].counts).toMatchObject({ total: 2, ready: 1, mediaNeeded: 1, userAction: 1 });
  });
});

describe("Ainetra P5.5B mobile calendar and Today reads", () => {
  it("shows a three-day window from the same tenant-scoped projection and selects its events", async () => {
    const { owner, business, otherBusiness } = await fixture();
    const plan = await createPlan(business.id);
    const goalId = business.goals[0].id;
    await createItem(plan.id, goalId, { plannedDate: "2026-10-07", topic: "İçeride" });
    await createItem(plan.id, goalId, { plannedDate: "2026-10-09", topic: "Son gün" });
    await createItem(plan.id, goalId, { plannedDate: "2026-10-10", topic: "Dışarıda" });
    await createItem(plan.id, goalId, { plannedDate: "2026-10-08", topic: "Değiştirilmiş", status: "REPLACED" });
    const otherPlan = await createPlan(otherBusiness.id);
    await createItem(otherPlan.id, otherBusiness.goals[0].id, { plannedDate: "2026-10-08", topic: "Komşu" });

    const mobile = await getMobileCalendar(owner.id, business.id, { view: "3day", anchor: "2026-10-07", now });
    expect(mobile.days.map((group) => group.date)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(mobile.events.map((item) => item.title)).toEqual(["İçeride", "Son gün"]);
    expect(mobile.counts).toMatchObject({ total: 2, mediaNeeded: 2, userAction: 2 });
    const selected = mobile.days.flatMap((group) => group.events).find((item) => item.title === "Son gün");
    expect(selected?.id).toMatch(/^plan:/);
    expect(selected?.need).toBe("Ürün fotoğrafı gerekiyor.");

    await expect(getMobileCalendar(owner.id, otherBusiness.id, { view: "3day", anchor: "2026-10-07", now })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps the mobile week identical to the P5.5A desktop week", async () => {
    const { owner, business } = await fixture();
    const plan = await createPlan(business.id);
    for (const plannedDate of ["2026-10-05", "2026-10-07", "2026-10-11"]) await createItem(plan.id, business.goals[0].id, { plannedDate });
    const desktop = await getCalendarWorkspace(owner.id, business.id, { view: "week", anchor: "2026-10-07", now });
    const mobile = await getMobileCalendar(owner.id, business.id, { view: "week", anchor: "2026-10-07", now });
    expect(mobile.range).toEqual(desktop.range);
    expect(mobile.events).toEqual(desktop.events);
    expect(mobile.counts).toEqual(desktop.counts);
    expect(mobile.days.reduce((sum, group) => sum + group.counts.total, 0)).toBe(desktop.counts.total);
  });

  it("builds Today from the business-local day and lists upcoming work separately", async () => {
    const { owner, business } = await fixture();
    const plan = await createPlan(business.id);
    const goalId = business.goals[0].id;
    await createItem(plan.id, goalId, { plannedDate: "2026-10-06", topic: "Dün" });
    await createItem(plan.id, goalId, { plannedDate: "2026-10-07", topic: "Bugün", mediaRequirement: "NO_NEW_MEDIA_REQUIRED" });
    await createItem(plan.id, goalId, { plannedDate: "2026-10-09", topic: "Cuma" });

    const agenda = await getTodayAgenda(owner.id, business.id, { now: lateNight });
    expect(agenda.today).toBe("2026-10-07");
    expect(agenda.todayEvents.map((item) => item.title)).toEqual(["Bugün"]);
    expect(agenda.todayCounts).toMatchObject({ total: 1, planned: 1, userAction: 0 });
    expect(agenda.upcomingActions.map((item) => item.title)).toEqual(["Cuma"]);
  });
});

describe("Ainetra P5.5B navigation and dev port", () => {
  it("keeps every existing route reachable on mobile through the dock or İşletmem", () => {
    expect(dockNavigation.map((item) => item.mobileLabel ?? item.label)).toEqual(["Bugün", "Takvim", "İçerikler", "Medya"]);
    expect(new Set([...dockNavigation, ...businessNavigation].map((item) => item.href))).toEqual(new Set(navigation.map((item) => item.href)));
    expect(businessNavigation.map((item) => item.href)).toEqual(expect.arrayContaining(["/content-plan", "/brand", "/strategy", "/business-brain", "/settings"]));
    for (const item of navigation) {
      expect(existsSync(path.join(process.cwd(), "src/app/(app)", item.href, "page.tsx"))).toBe(true);
      expect(item.label).not.toMatch(/^[A-Z_]+$/);
    }
    expect(isNavigationActive("/content/abc", "/content")).toBe(true);
    expect(isNavigationActive("/content-plan", "/content")).toBe(false);
  });

  it("runs Ainetra Social on port 3001 by default", () => {
    const scripts = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts.dev).toBe("next dev -p 3001");
    expect(scripts.start).toBe("next start -p 3001");
  });
});
