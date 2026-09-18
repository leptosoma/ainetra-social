import { GoalPriority } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authorization";
import { DomainError } from "@/lib/domain-error";

export type GoalInput = { type: string; priority: GoalPriority };

export function normalizeAndValidateGoals(goals: GoalInput[]) {
  const normalized = goals.map((goal) => ({
    type: goal.type.trim().toUpperCase().replace(/\s+/g, "_"),
    priority: goal.priority,
  }));
  const primaryCount = normalized.filter((goal) => goal.priority === "PRIMARY").length;
  const secondaryCount = normalized.filter((goal) => goal.priority === "SECONDARY").length;
  if (primaryCount > 1) {
    throw new DomainError("En fazla bir ana hedef seçilebilir.", "VALIDATION_ERROR");
  }
  if (secondaryCount > 2) {
    throw new DomainError("En fazla iki ikincil hedef seçilebilir.", "VALIDATION_ERROR");
  }
  if (new Set(normalized.map((goal) => goal.type)).size !== normalized.length) {
    throw new DomainError("Aynı hedef birden fazla kez seçilemez.", "VALIDATION_ERROR");
  }
  return normalized;
}

export async function replaceBusinessGoals(userId: string, businessId: string, goals: GoalInput[]) {
  await requireMembership(userId, businessId);
  const normalized = normalizeAndValidateGoals(goals);
  return prisma.$transaction(async (tx) => {
    await tx.businessGoal.deleteMany({
      where: { businessId, type: { notIn: normalized.map((goal) => goal.type) } },
    });
    await Promise.all(normalized.map((goal) => tx.businessGoal.upsert({
      where: { businessId_type: { businessId, type: goal.type } },
      create: { ...goal, businessId },
      update: { priority: goal.priority },
    })));
    return tx.businessGoal.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
  });
}
