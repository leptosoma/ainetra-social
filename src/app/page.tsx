import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";

export default async function Home() {
  redirect((await getCurrentUser()) ? "/dashboard" : "/sign-in");
}
