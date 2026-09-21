"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { acceptContentFallbackProposal, proposeContentFallback } from "@/features/content-fallback/service";

function str(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

async function userId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

function refresh() {
  revalidatePath("/content-plan");
  revalidatePath("/dashboard");
}

export async function proposeContentFallbackAction(formData: FormData) {
  const planId = str(formData, "planId");
  const result = await proposeContentFallback(await userId(), str(formData, "itemId"));
  refresh();
  redirect(`/content-plan?plan=${planId}&notice=${result.proposal ? "fallback-proposed" : "fallback-none"}`);
}

export async function acceptContentFallbackAction(formData: FormData) {
  const planId = str(formData, "planId");
  await acceptContentFallbackProposal(await userId(), str(formData, "proposalId"));
  refresh();
  redirect(`/content-plan?plan=${planId}&notice=fallback-accepted`);
}
