import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { AppSidebar } from "@/components/app-sidebar";
import { WebMcpTools } from "@/components/webmcp-tools";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  return (
    <div className="app-shell">
      <WebMcpTools businessName={business?.name} />
      <AppSidebar userName={user.name} businessName={business?.name} />
      <main className="app-main">{children}</main>
    </div>
  );
}
