"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { updateBusiness } from "@/features/business/service";
import {
  acceptBusinessAttribute,
  acceptSuggestedGoal,
  addManualBusinessAttribute,
  editBusinessAttribute,
  rejectBusinessAttribute,
  runBusinessBrainAnalysis,
} from "@/features/business-brain/service";

function str(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

async function currentUserId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

function refreshBrain() {
  revalidatePath("/business-brain");
  revalidatePath("/dashboard");
}

export async function analyzeBusinessBrainAction(formData: FormData) {
  const userId = await currentUserId();
  const businessId = str(formData, "businessId");
  let notice = "analysis-error";
  try {
    await updateBusiness(userId, businessId, {
      name: str(formData, "name"),
      sector: str(formData, "sector"),
      location: str(formData, "location"),
      website: str(formData, "website"),
      instagramHandle: str(formData, "instagramHandle"),
      timezone: str(formData, "timezone") || "Europe/Istanbul",
    });
    const result = await runBusinessBrainAnalysis(userId, businessId);
    notice = result.status === "SUCCEEDED" ? "analysis-complete" : result.status.toLowerCase();
  } catch {
    notice = "analysis-error";
  }
  refreshBrain();
  redirect(`/business-brain?notice=${notice}`);
}

export async function acceptBusinessAttributeAction(formData: FormData) {
  await acceptBusinessAttribute(await currentUserId(), str(formData, "attributeId"));
  refreshBrain();
}

export async function rejectBusinessAttributeAction(formData: FormData) {
  await rejectBusinessAttribute(await currentUserId(), str(formData, "attributeId"));
  refreshBrain();
}

export async function editBusinessAttributeAction(formData: FormData) {
  await editBusinessAttribute(await currentUserId(), { attributeId: str(formData, "attributeId"), value: str(formData, "value") });
  refreshBrain();
}

export async function addManualBusinessAttributeAction(formData: FormData) {
  await addManualBusinessAttribute(await currentUserId(), str(formData, "businessId"), { category: str(formData, "category"), value: str(formData, "value") });
  refreshBrain();
}

export async function acceptSuggestedGoalAction(formData: FormData) {
  const priority = str(formData, "priority") === "SECONDARY" ? "SECONDARY" : "PRIMARY";
  await acceptSuggestedGoal(await currentUserId(), str(formData, "attributeId"), priority);
  refreshBrain();
}
