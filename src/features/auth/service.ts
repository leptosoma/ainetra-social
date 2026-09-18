import { z } from "zod";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { hashPassword, verifyPassword } from "./password";

export const credentialsSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
});

export const signUpSchema = credentialsSchema.extend({
  name: z.string().trim().min(2).max(100),
});

export async function registerUser(input: unknown) {
  const data = signUpSchema.parse(input);
  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) throw new DomainError("Bu e-posta zaten kayıtlı.", "CONFLICT");
  return prisma.user.create({
    data: { name: data.name, email: data.email, passwordHash: await hashPassword(data.password) },
  });
}

export async function authenticateUser(input: unknown) {
  const data = credentialsSchema.parse(input);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
    throw new DomainError("E-posta veya parola hatalı.", "UNAUTHORIZED");
  }
  return user;
}
