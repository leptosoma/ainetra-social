import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "ainetra_session";
const SESSION_DAYS = 30;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt } });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.user;
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  cookieStore.delete(COOKIE_NAME);
}
