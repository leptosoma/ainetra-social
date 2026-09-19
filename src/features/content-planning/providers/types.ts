import type { buildBusinessContext } from "@/features/business-brain/service";
import type { ActivePlatformRule } from "@/features/platform-intelligence/service";
import type { PlanningOutput, StrategyInput } from "../schemas";

export type ContentPlanningProviderInput = {
  context: Awaited<ReturnType<typeof buildBusinessContext>>;
  strategy: StrategyInput;
  rules: ActivePlatformRule[];
  period: "SEVEN_DAYS" | "THIRTY_DAYS";
  startDate: string;
  prompt: string;
  itemToRegenerate?: PlanningOutput["contentItems"][number];
};

export interface ContentPlanningProvider {
  readonly provider: string;
  readonly model: string;
  generate(input: ContentPlanningProviderInput): Promise<unknown>;
}
