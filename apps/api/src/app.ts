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
const VERCEL_HOST = /^https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app$/i;
const allowOrigin = (origin?: string) =>
  !origin || origins.includes(origin) || origin.startsWith("http://localhost") || (env.ALLOW_VERCEL_ORIGINS && VERCEL_HOST.test(origin));
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
app.use("/api/masters", requireAuth, mastersRoutes);
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
