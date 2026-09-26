"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { META_POST_FLOW_PATH } from "@/features/meta-connection/config";
import {
  cancelMetaSelection,
  completeMetaSelection,
  disconnectMetaAccount,
  metaFailureCodeForError,
  startMetaConnection,
  validateMetaConnection,
} from "@/features/meta-connection/service";
import { META_SELECTION_COOKIE } from "@/features/meta-connection/selection-cookie";

async function sessionContext() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  return { userId: session.userId, sessionId: session.id };
}

function settingsWith(param: "metaError" | "metaNotice", code: string): never {
  revalidatePath(META_POST_FLOW_PATH);
  redirect(`${META_POST_FLOW_PATH}?${param}=${code}`);
}

async function takeSelectionHandle() {
  const cookieStore = await cookies();
  const handle = cookieStore.get(META_SELECTION_COOKIE)?.value ?? "";
  cookieStore.delete({ name: META_SELECTION_COOKIE, path: "/settings" });
  return handle;
}

/** İşletme tarayıcıdan değil sunucu tarafı üyelikten türetilir; yeniden bağlama hedefi sunucuda doğrulanır. */
export async function startMetaConnectionAction(formData: FormData) {
  const ctx = await sessionContext();
  const business = await getFirstBusinessForUser(ctx.userId);
  if (!business) redirect("/dashboard");
  const reconnectSocialAccountId = String(formData.get("socialAccountId") ?? "") || null;
  const requestPublishing = String(formData.get("requestPublishing") ?? "") === "1";
  let authorizeUrl: string;
  try {
    authorizeUrl = (await startMetaConnection(ctx, business.id, { reconnectSocialAccountId, requestPublishing })).authorizeUrl;
  } catch (error) {
    settingsWith("metaError", metaFailureCodeForError(error));
  }
  redirect(authorizeUrl);
}

export async function completeMetaSelectionAction(formData: FormData) {
  const ctx = await sessionContext();
  const choices = formData.getAll("asset").map(String);
  if (choices.length === 0) redirect("/settings/meta?empty=1");
  const handle = await takeSelectionHandle();
  try {
    await completeMetaSelection(ctx, handle, choices);
  } catch (error) {
    settingsWith("metaError", metaFailureCodeForError(error));
  }
  settingsWith("metaNotice", "CONNECTED");
}

export async function cancelMetaSelectionAction() {
  const ctx = await sessionContext();
  await cancelMetaSelection(ctx, await takeSelectionHandle());
  settingsWith("metaNotice", "CANCELLED");
}

export async function disconnectMetaAccountAction(formData: FormData) {
  const ctx = await sessionContext();
  try {
    await disconnectMetaAccount(ctx.userId, String(formData.get("socialAccountId") ?? ""));
  } catch (error) {
    settingsWith("metaError", metaFailureCodeForError(error));
  }
  settingsWith("metaNotice", "DISCONNECTED");
}

export async function validateMetaConnectionAction(formData: FormData) {
  const ctx = await sessionContext();
  let state: string;
  try {
    state = (await validateMetaConnection(ctx.userId, String(formData.get("socialAccountId") ?? ""))).state;
  } catch (error) {
    settingsWith("metaError", metaFailureCodeForError(error));
  }
  settingsWith("metaNotice", state === "CONNECTED" ? "VALIDATED" : "REAUTH_REQUIRED");
}
