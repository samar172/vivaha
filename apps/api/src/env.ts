import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(20),
  JWT_REFRESH_SECRET: z.string().min(20),
  PORT: z.coerce.number().default(4100),
  CORS_ORIGIN: z.string().default("http://localhost:3100"),
  // Vercel gives every preview deployment its own *.vercel.app host, so they cannot
  // be enumerated in CORS_ORIGIN. Opt in per environment rather than always allowing.
  ALLOW_VERCEL_ORIGINS: z.string().optional().transform((v) => v === "true"),
});

export const env = envSchema.parse(process.env);
