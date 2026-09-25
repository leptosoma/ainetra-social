import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";
import { getFirstBusinessForUser } from "@/lib/authorization";
import { listCurrentCaptureRequests } from "@/features/capture-engine/service";
import { buildCapturePrompt, type CapturePrompt } from "@/features/capture-engine/prompt";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileDock, MobileTopbar } from "@/components/mobile-navigation";
import { WebMcpTools } from "@/components/webmcp-tools";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const business = await getFirstBusinessForUser(user.id);
  // P5.5B: merkez çekim düğmesinin bağlamı; salt okunur, kiracı ve güncellik süzgeçli sorgu.
  const prompts: CapturePrompt[] = business
    ? (await listCurrentCaptureRequests(user.id, business.id, { limit: 3 })).map(buildCapturePrompt).filter((prompt): prompt is CapturePrompt => prompt !== null)
    : [];
  return (
    <div className="app-shell">
      <WebMcpTools businessName={business?.name} />
      <AppSidebar userName={user.name} businessName={business?.name} />
      <MobileTopbar userName={user.name} businessName={business?.name} />
      <main className="app-main">{children}</main>
      <MobileDock businessId={business?.id} prompts={prompts} />
    </div>
  );
}
