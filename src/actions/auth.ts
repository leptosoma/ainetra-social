"use server";

import { redirect } from "next/navigation";
import { authenticateUser, registerUser } from "@/features/auth/service";
import { createSession, destroyCurrentSession } from "@/features/auth/session";

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

export async function signInAction(formData: FormData) {
  try {
    const user = await authenticateUser({ email: value(formData, "email"), password: value(formData, "password") });
    await createSession(user.id);
  } catch (error) {
    redirect(`/sign-in?error=${encodeURIComponent(error instanceof Error ? error.message : "Giriş başarısız.")}`);
  }
  redirect("/dashboard");
}

export async function signUpAction(formData: FormData) {
  try {
    const user = await registerUser({
      name: value(formData, "name"),
      email: value(formData, "email"),
      password: value(formData, "password"),
    });
    await createSession(user.id);
  } catch (error) {
    redirect(`/sign-up?error=${encodeURIComponent(error instanceof Error ? error.message : "Kayıt başarısız.")}`);
  }
  redirect("/dashboard");
}

export async function signOutAction() {
  await destroyCurrentSession();
  redirect("/sign-in");
}
