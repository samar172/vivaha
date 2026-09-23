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
  // Item photographs. Set CLOUDINARY_URL and images go to Cloudinary; leave it
  // unset and they land on local disk under UPLOAD_DIR, served at /api/uploads,
  // so a developer checkout works with no external account. Same arrangement,
  // and the same credentials, as JMS on this box.
  // Format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
  CLOUDINARY_URL: z.string().optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
  // The login screen's demo pickers. Off unless deliberately turned on: the
  // endpoint behind them is unauthenticated, and on a live system it listed
  // every account — office usernames, and every retailer's username beside
  // their firm, town and pricing group.
  DEMO_LOGINS: z.string().optional().transform((v) => v === "1" || v === "true"),
});

export const env = envSchema.parse(process.env);
