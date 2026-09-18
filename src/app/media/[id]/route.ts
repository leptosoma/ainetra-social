import { NextResponse } from "next/server";
import { getCurrentUser } from "@/features/auth/session";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, business: { memberships: { some: { userId: user.id } } } },
  });
  if (!asset) return new NextResponse("Not found", { status: 404 });
  const object = await storage.get(asset.storageKey);
  if (!object) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.size),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
