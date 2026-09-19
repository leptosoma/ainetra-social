"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import {
  approveContentPlan,
  generateContentPlan,
  regenerateContentPlan,
  regenerateContentPlanItem,
  saveCustomizedContentStrategy,
  acceptRecommendedContentStrategy,
} from "@/features/content-planning/service";
import { contentPillars } from "@/features/content-planning/schemas";

function str(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

function refreshPlanning() {
  revalidatePath("/strategy");
  revalidatePath("/content-plan");
  revalidatePath("/dashboard");
}

export async function useRecommendedStrategyAction(formData: FormData) {
  await acceptRecommendedContentStrategy(await userId(), str(formData, "businessId"));
  refreshPlanning();
  redirect("/strategy?notice=recommended-saved");
}

export async function saveCustomStrategyAction(formData: FormData) {
  const platformSettings = (["INSTAGRAM", "FACEBOOK", "TIKTOK"] as const).map((platform) => ({
    platform,
    enabled: formData.get(`enabled_${platform}`) === "on",
    weeklyFrequency: Number(str(formData, `frequency_${platform}`)),
    contentTypes: formData.getAll(`types_${platform}`).map(String),
  }));
  const contentMix = contentPillars.map((pillar) => ({ pillar, percentage: Number(str(formData, `mix_${pillar}`) || "0") })).filter((entry) => entry.percentage > 0);
  const languages = str(formData, "languages").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  await saveCustomizedContentStrategy(await userId(), str(formData, "businessId"), { mode: "CUSTOM", platformSettings, contentMix, languages });
  refreshPlanning();
  redirect("/strategy?notice=custom-saved");
}

export async function generateContentPlanAction(formData: FormData) {
  const plan = await generateContentPlan(await userId(), str(formData, "businessId"), {
    period: str(formData, "period") === "THIRTY_DAYS" ? "THIRTY_DAYS" : "SEVEN_DAYS",
    startDate: str(formData, "startDate"),
  });
  refreshPlanning();
  redirect(`/content-plan?plan=${plan.id}&notice=plan-ready`);
}

export async function approveContentPlanAction(formData: FormData) {
  const planId = str(formData, "planId");
  await approveContentPlan(await userId(), planId);
  refreshPlanning();
  redirect(`/content-plan?plan=${planId}&notice=plan-approved`);
}

export async function regenerateContentPlanAction(formData: FormData) {
  const plan = await regenerateContentPlan(await userId(), str(formData, "planId"));
  refreshPlanning();
  redirect(`/content-plan?plan=${plan.id}&notice=plan-regenerated`);
}

export async function regenerateContentPlanItemAction(formData: FormData) {
  const planId = str(formData, "planId");
  await regenerateContentPlanItem(await userId(), str(formData, "itemId"));
  refreshPlanning();
  redirect(`/content-plan?plan=${planId}&notice=item-regenerated`);
}
