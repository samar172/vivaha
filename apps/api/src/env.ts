import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(20),
  JWT_REFRESH_SECRET: z.string().min(20),
  PORT: z.coerce.number().default(4100),
  CORS_ORIGIN: z.string().default("http://localhost:3100"),
});

export const env = envSchema.parse(process.env);
