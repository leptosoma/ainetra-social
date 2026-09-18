import { z } from "zod";

export const contentInputSchema = z.object({
  title: z.string().trim().min(3).max(180),
  topic: z.string().trim().min(2).max(220),
  contentType: z.enum(["POST", "REEL", "STORY", "CAROUSEL"]),
  goalId: z.string().trim().optional().nullable(),
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK"]),
  caption: z.string().trim().min(1).max(2200),
  cta: z.string().trim().max(300).optional().nullable(),
  language: z.string().trim().min(2).max(12).default("tr"),
  mediaAssetId: z.string().trim().optional().nullable(),
  aspectRatio: z.string().trim().max(20).optional().nullable(),
});

export const variantUpdateSchema = z.object({
  caption: z.string().trim().min(1).max(2200),
  cta: z.string().trim().max(300).optional().nullable(),
  language: z.string().trim().min(2).max(12),
  mediaAssetId: z.string().trim().optional().nullable(),
  aspectRatio: z.string().trim().max(20).optional().nullable(),
});
