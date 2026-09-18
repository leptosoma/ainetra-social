import { beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User", "Business" CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
