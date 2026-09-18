import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((value) => !value || /^https?:\/\//i.test(value), "Web sitesi http:// veya https:// ile başlamalıdır.");

export const businessInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sector: z.string().trim().min(2).max(80),
  location: z.string().trim().max(160).optional().default(""),
  website: optionalUrl.optional().default(""),
  instagramHandle: z.string().trim().max(80).optional().default(""),
  timezone: z.string().trim().min(3).max(80).default("Europe/Istanbul"),
});

export const brandInputSchema = z.object({
  description: z.string().trim().max(1500),
  targetAudience: z.string().trim().max(1000),
  languages: z.array(z.string().trim().min(2).max(12)).min(1).max(8),
  productsSummary: z.string().trim().max(1500),
  toneDimensions: z.record(z.string(), z.number().int().min(0).max(100)),
});
