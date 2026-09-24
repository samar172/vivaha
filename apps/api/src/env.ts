import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(20),
  JWT_REFRESH_SECRET: z.string().min(20),
  PORT: z.coerce.number().default(4100),
  CORS_ORIGIN: z.string().default("http://localhost:3100"),
  // Vercel gives every preview deployment its own host, so previews cannot be
  // enumerated in CORS_ORIGIN. This used to be answered by allowing *any*
  // *.vercel.app origin, which is not a small thing: the refresh token is an
  // httpOnly cookie with SameSite=None in production, so a page on any
  // vercel.app subdomain — and they are free to register — could call
  // /api/auth/refresh with the visitor's cookie and read a working access token
  // straight out of the response. That is account takeover for anyone signed in
  // who happened to open the page.
  //
  // So a preview host must now match this project's own suffix, which includes
  // the Vercel team slug and cannot be registered by anybody else. Unset means
  // no preview origin is allowed at all, which is the right default.
  VERCEL_PREVIEW_SUFFIX: z.string().optional(),
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
