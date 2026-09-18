import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { updateBusiness } from "@/features/business/service";
import { replaceBusinessGoals } from "@/features/goals/service";
import { createContent, recordContentExport, updateContentVariant } from "@/features/content/service";
import { approveContentVariant, isCurrentVersionApproved } from "@/features/approval/service";
import { isScheduledPostPublishable, scheduleContentVariant } from "@/features/publishing/service";

async function fixture() {
  const owner = await prisma.user.create({ data: { name: "Owner", email: `owner-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const outsider = await prisma.user.create({ data: { name: "Outsider", email: `outside-${crypto.randomUUID()}@test.dev`, passwordHash: "hash" } });
  const business = await prisma.business.create({ data: { name: "Mimoza", sector: "RESTAURANT", memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  const otherBusiness = await prisma.business.create({ data: { name: "Other", sector: "HOTEL", memberships: { create: { userId: outsider.id, role: "OWNER" } } } });
  const account = await prisma.socialAccount.create({ data: { businessId: business.id, platform: "INSTAGRAM", displayName: "Demo" } });
  const otherAccount = await prisma.socialAccount.create({ data: { businessId: otherBusiness.id, platform: "INSTAGRAM", displayName: "Other" } });
  const content = await createContent(owner.id, business.id, { title: "Friday Steak", topic: "Reservation", contentType: "POST", platform: "INSTAGRAM", caption: "Original caption", language: "tr" });
  return { owner, outsider, business, otherBusiness, account, otherAccount, content, variant: content.variants[0] };
}

describe("Ainetra Social domain rules", () => {
  it("prevents a user from changing another business", async () => {
    const { outsider, business } = await fixture();
    await expect(updateBusiness(outsider.id, business.id, { name: "Hacked", sector: "BAR", location: "", website: "", instagramHandle: "", timezone: "Europe/Istanbul" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows at most one primary business goal", async () => {
    const { owner, business } = await fixture();
    await expect(replaceBusinessGoals(owner.id, business.id, [{ type: "RESERVATIONS", priority: "PRIMARY" }, { type: "SALES", priority: "PRIMARY" }])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("allows at most two secondary business goals", async () => {
    const { owner, business } = await fixture();
    await expect(replaceBusinessGoals(owner.id, business.id, [{ type: "A", priority: "SECONDARY" }, { type: "B", priority: "SECONDARY" }, { type: "C", priority: "SECONDARY" }])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("invalidates an approval when content version changes", async () => {
    const { owner, variant } = await fixture();
    await approveContentVariant(owner.id, variant.id);
    expect(await isCurrentVersionApproved(variant.id)).toBe(true);
    await updateContentVariant(owner.id, variant.id, { caption: "Changed", cta: null, language: "tr", mediaAssetId: null, aspectRatio: null });
    expect(await isCurrentVersionApproved(variant.id)).toBe(false);
  });

  it("cannot schedule a version different from the approved version", async () => {
    const { owner, variant, account } = await fixture();
    await approveContentVariant(owner.id, variant.id);
    await updateContentVariant(owner.id, variant.id, { caption: "Version two", cta: null, language: "tr", mediaAssetId: null, aspectRatio: null });
    await expect(scheduleContentVariant(owner.id, variant.id, { socialAccountId: account.id, scheduledAt: new Date(Date.now() + 60_000), expectedVersion: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("makes an old schedule unpublishable after content changes", async () => {
    const { owner, variant, account } = await fixture();
    await approveContentVariant(owner.id, variant.id);
    const scheduled = await scheduleContentVariant(owner.id, variant.id, { socialAccountId: account.id, scheduledAt: new Date(Date.now() + 60_000), expectedVersion: 1 });
    expect(await isScheduledPostPublishable(scheduled.id)).toBe(true);
    await updateContentVariant(owner.id, variant.id, { caption: "Changed after scheduling", cta: null, language: "tr", mediaAssetId: null, aspectRatio: null });
    expect(await isScheduledPostPublishable(scheduled.id)).toBe(false);
    expect((await prisma.scheduledPost.findUnique({ where: { id: scheduled.id } }))?.status).toBe("INVALIDATED");
  });

  it("cannot schedule in the past", async () => {
    const { owner, variant, account } = await fixture();
    await approveContentVariant(owner.id, variant.id);
    await expect(scheduleContentVariant(owner.id, variant.id, { socialAccountId: account.id, scheduledAt: new Date(Date.now() - 60_000), expectedVersion: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("cannot attach another business media asset to a variant", async () => {
    const { owner, business, otherBusiness } = await fixture();
    const media = await prisma.mediaAsset.create({ data: { businessId: otherBusiness.id, originalFilename: "other.jpg", mimeType: "image/jpeg", size: 10, width: 10, height: 10, storageKey: "other/key.jpg" } });
    await expect(createContent(owner.id, business.id, { title: "New content", topic: "Topic", contentType: "POST", platform: "INSTAGRAM", caption: "Caption", language: "tr", mediaAssetId: media.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records export without creating a published state", async () => {
    const { owner, variant } = await fixture();
    const exported = await recordContentExport(owner.id, variant.id);
    expect(exported.exportedVersion).toBe(1);
    expect(await prisma.scheduledPost.count({ where: { contentVariantId: variant.id } })).toBe(0);
    expect(await prisma.publishAttempt.count()).toBe(0);
  });

  it("cannot schedule through another business social account", async () => {
    const { owner, variant, otherAccount } = await fixture();
    await approveContentVariant(owner.id, variant.id);
    await expect(scheduleContentVariant(owner.id, variant.id, { socialAccountId: otherAccount.id, scheduledAt: new Date(Date.now() + 60_000), expectedVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
