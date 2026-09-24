import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./env";
import { errorHandler } from "./middleware/errorHandler";
import { requireAuth, requireInternal, requireCustomer } from "./middleware/auth";
import { UPLOAD_ROOT } from "./services/uploads";

import authRoutes from "./modules/auth/auth.routes";
import mastersRoutes from "./modules/masters/masters.routes";
import itemsRoutes from "./modules/items/items.routes";
import stockRoutes from "./modules/stock/stock.routes";
import purchasesRoutes from "./modules/purchases/purchases.routes";
import customersRoutes from "./modules/customers/customers.routes";
import ordersRoutes from "./modules/orders/orders.routes";
import returnsRoutes from "./modules/returns/returns.routes";
import ledgerRoutes from "./modules/ledger/ledger.routes";
import jobsRoutes from "./modules/jobs/jobs.routes";
import reportsRoutes from "./modules/reports/reports.routes";
import auditRoutes from "./modules/audit/audit.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import searchRoutes from "./modules/search/search.routes";
import codesRoutes from "./modules/codes/codes.routes";
import dashboardRoutes from "./modules/dashboard/dashboard.routes";
import portalRoutes from "./modules/portal/portal.routes";
import portalStaffRoutes from "./modules/portal/staff.routes";

export const app = express();
app.set("trust proxy", 1);
app.use(helmet());
const origins = env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
// A preview deployment is allowed only when its host ends with this project's
// own suffix — which carries the Vercel team slug, so no one else can register
// a matching host. It used to be any *.vercel.app, and those are free to take:
// with credentials allowed and the refresh cookie set SameSite=None, such a
// page could call /api/auth/refresh on a visitor's behalf and read back a live
// access token.
const previewSuffix = env.VERCEL_PREVIEW_SUFFIX?.trim().toLowerCase() || null;
const isOwnPreview = (origin: string) => {
  if (!previewSuffix) return false;
  const host = origin.toLowerCase();
  return host.startsWith("https://") && host.endsWith(previewSuffix) && host.length > previewSuffix.length + 8;
};
const allowOrigin = (origin?: string) =>
  !origin || origins.includes(origin) || origin.startsWith("http://localhost") || isOwnPreview(origin);
app.use(cors({ origin: (origin, cb) => cb(null, allowOrigin(origin)), credentials: true }));
// A full-database restore is a whole business in one payload, so it gets its
// own ceiling; everything else stays on the tight limit.
app.use("/api/settings/restore", express.json({ limit: "128mb" }));
// A photograph on an ordinary JSON body needs more headroom than a form post,
// and rather less than a whole-database restore.
app.use("/api/items/:id/image", express.json({ limit: "12mb" }));
// A bus consignment carries two photographs of the loaded bundle on the same
// body as the dispatch itself, so it needs the same headroom.
app.use("/api/orders/:id/dispatch", express.json({ limit: "12mb" }));
// A receipt can carry the customer's UPI screenshot on the same body.
app.use("/api/ledger/payments", express.json({ limit: "12mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));
app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));

// Item photographs, when they are kept on local disk rather than Cloudinary.
// Served unauthenticated and deliberately: an <img> tag cannot carry a bearer
// token, and a product picture is not a secret. Mounted under /api so it rides
// the frontend's existing proxy and stays first-party to the browser.
app.use("/api/uploads", express.static(UPLOAD_ROOT, { maxAge: "30d", index: false, redirect: false, dotfiles: "deny" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "vivaha-api" }));
app.use("/api/auth", authRoutes);

const internal = [requireAuth, requireInternal];
// Masters are the office's own reference data, and they are read-only to most
// roles — which is why this once sat on requireAuth alone. That was wrong: a
// retailer's portal token is a signed-in token, so any customer could read the
// whole supplier list, with each supplier's GSTIN, phone, UPI id, what we have
// bought from them and what we still owe — and the pricing groups, from which
// every other firm's tier can be worked out. Writes were always refused; the
// reads were the leak. The portal has its own router and needs nothing here.
app.use("/api/masters", ...internal, mastersRoutes);
app.use("/api/items", ...internal, itemsRoutes);
app.use("/api/stock", ...internal, stockRoutes);
app.use("/api/purchases", ...internal, purchasesRoutes);
app.use("/api/customers", ...internal, customersRoutes);
app.use("/api/orders", ...internal, ordersRoutes);
app.use("/api/returns", ...internal, returnsRoutes);
app.use("/api/ledger", ...internal, ledgerRoutes);
app.use("/api/jobs", ...internal, jobsRoutes);
app.use("/api/reports", ...internal, reportsRoutes);
app.use("/api/audit-logs", ...internal, auditRoutes);
app.use("/api/notifications", ...internal, notificationsRoutes);
app.use("/api/settings", ...internal, settingsRoutes);
app.use("/api/codes", ...internal, codesRoutes);
app.use("/api/search", ...internal, searchRoutes);
app.use("/api/dashboard", ...internal, dashboardRoutes);
// The firm's own staff list, mounted ahead of the portal router so it keeps
// its own file — it is the one part of the portal that writes to User rows.
app.use("/api/portal/staff", requireAuth, requireCustomer, portalStaffRoutes);
app.use("/api/portal", requireAuth, requireCustomer, portalRoutes);

app.use(errorHandler);
