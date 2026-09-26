"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { publishNowErrorCode, publishScheduledPostNow } from "@/features/publishing/submission";

const ID = /^[a-z0-9]{10,40}$/;

/**
 * P6-03: tek, açık "Yayınla" eylemi. Tarayıcıdan yalnızca planlı gönderi kimliği ve beklenen sürüm alınır;
 * hesap, platform, Meta kimliği ve yük sunucuda intent/snapshot'tan türetilir. Sonuç kapalı bir kodla döner.
 */
export async function publishNowAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const scheduledPostId = String(formData.get("scheduledPostId") ?? "");
  const contentId = String(formData.get("contentId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? "");
  const back = ID.test(contentId) ? `/content/${contentId}` : "/content";
  let query: string;
  try {
    const result = await publishScheduledPostNow(user.id, scheduledPostId, expectedVersion);
    query = `publish=${result.state}`;
  } catch (error) {
    query = `publishError=${publishNowErrorCode(error)}`;
  }
  revalidatePath(back);
  revalidatePath("/calendar");
  redirect(`${back}?${query}`);
}
