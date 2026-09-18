"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { createBusiness, updateBrandProfile, updateBusiness } from "@/features/business/service";
import { replaceBusinessGoals } from "@/features/goals/service";

function str(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

export async function createBusinessAction(formData: FormData) {
  await createBusiness(await userId(), {
    name: str(formData, "name"),
    sector: str(formData, "sector"),
    location: str(formData, "location"),
    website: str(formData, "website"),
    instagramHandle: str(formData, "instagramHandle"),
    timezone: str(formData, "timezone") || "Europe/Istanbul",
  });
  redirect("/dashboard");
}

export async function updateBusinessAction(formData: FormData) {
  const businessId = str(formData, "businessId");
  await updateBusiness(await userId(), businessId, {
    name: str(formData, "name"),
    sector: str(formData, "sector"),
    location: str(formData, "location"),
    website: str(formData, "website"),
    instagramHandle: str(formData, "instagramHandle"),
    timezone: str(formData, "timezone"),
  });
  revalidatePath("/brand");
}

export async function updateBrandAction(formData: FormData) {
  const businessId = str(formData, "businessId");
  await updateBrandProfile(await userId(), businessId, {
    description: str(formData, "description"),
    targetAudience: str(formData, "targetAudience"),
    languages: str(formData, "languages").split(",").map((entry) => entry.trim()).filter(Boolean),
    productsSummary: str(formData, "productsSummary"),
    toneDimensions: {
      corporateFriendly: Number(str(formData, "corporateFriendly") || 65),
      minimalVibrant: Number(str(formData, "minimalVibrant") || 50),
      luxuryAccessible: Number(str(formData, "luxuryAccessible") || 45),
      modernNatural: Number(str(formData, "modernNatural") || 50),
      seriousPlayful: Number(str(formData, "seriousPlayful") || 40),
    },
  });
  revalidatePath("/brand");
}

export async function updateGoalsAction(formData: FormData) {
  const goals = [];
  const primary = str(formData, "primary");
  if (primary) goals.push({ type: primary, priority: "PRIMARY" as const });
  for (const secondary of formData.getAll("secondary").map(String).filter(Boolean)) {
    goals.push({ type: secondary, priority: "SECONDARY" as const });
  }
  await replaceBusinessGoals(await userId(), str(formData, "businessId"), goals);
  revalidatePath("/brand");
}
