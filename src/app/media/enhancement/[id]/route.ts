import { NextResponse } from "next/server";
import { getCurrentUser } from "@/features/auth/session";
import { readSafeEnhancementOutput } from "@/features/safe-enhance/service";

// Karar verilmeden önce iyileştirme çıktısını önizlemek için. Saklanan çıktı ayrıca bir MediaAsset
// olduğundan `/media/[id]` üzerinden de sunulur; atılan çıktının baytları silindiği için 404 döner.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const output = await readSafeEnhancementOutput(user.id, id);
  if (!output) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(output.bytes), {
    headers: {
      "Content-Type": output.mimeType,
      "Content-Length": String(output.size),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
