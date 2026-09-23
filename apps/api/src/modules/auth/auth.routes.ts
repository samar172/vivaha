import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../db";
import { env } from "../../env";
import * as svc from "./auth.service";

const router = Router();
const cookieOpts = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
});

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1), kind: z.enum(["internal", "customer"]).default("internal") });

router.post("/login", asyncHandler(async (req, res) => {
  const { username, password, kind } = loginSchema.parse(req.body);
  const { accessToken, refreshToken, user } = await svc.login(username, password, kind, req.ip ?? null);
  res.cookie(svc.REFRESH_COOKIE_NAME, refreshToken, { ...cookieOpts(), maxAge: svc.REFRESH_COOKIE_MAX_AGE_MS });
  res.json({ accessToken, user });
}));

router.post("/refresh", asyncHandler(async (req, res) => {
  const token = req.cookies?.[svc.REFRESH_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "No refresh token" });
  const { accessToken, refreshToken, user } = await svc.refresh(token);
  res.cookie(svc.REFRESH_COOKIE_NAME, refreshToken, { ...cookieOpts(), maxAge: svc.REFRESH_COOKIE_MAX_AGE_MS });
  res.json({ accessToken, user });
}));

router.post("/logout", (_req, res) => { res.clearCookie(svc.REFRESH_COOKIE_NAME, cookieOpts()); res.status(204).send(); });

router.get("/me", requireAuth, asyncHandler(async (req, res) => res.json(await svc.me(req.user!.id))));

const pwSchema = z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: z.string().min(8, "Use at least 8 characters") });
router.post("/change-password", requireAuth, asyncHandler(async (req, res) => {
  const b = pwSchema.parse(req.body);
  await svc.changePassword(req.user!.id, b.currentPassword, b.newPassword);
  res.json({ ok: true });
}));

// The login screen's demo pickers, and off unless somebody deliberately turns
// them on.
//
// This is unauthenticated, and on a live system it was listing every active
// account: the office's usernames and roles, and every retailer's username
// alongside their firm name, town and pricing group — to anyone who opened the
// login page. That is half of each credential and a customer list, given away.
//
// It is genuinely useful on a demo, so it stays, behind DEMO_LOGINS=1. With the
// flag off it returns nothing and the screen asks people to type the username
// and password the office issued them, which is what a real shop does.
router.get("/demo-logins", asyncHandler(async (_req, res) => {
  if (!env.DEMO_LOGINS) return res.json({ demo: false, internal: [], customers: [] });
  const users = await prisma.user.findMany({ where: { isActive: true }, include: { customer: { select: { name: true, group: true, tehsil: true } } }, orderBy: { createdAt: "asc" } });
  res.json({
    demo: true,
    internal: users.filter((u) => u.role !== "CUSTOMER").map((u) => ({ username: u.username, name: u.name, role: u.role })),
    customers: users.filter((u) => u.role === "CUSTOMER" && u.customer).map((u) => ({ username: u.username, firm: u.customer!.name, group: u.customer!.group, tehsil: u.customer!.tehsil })),
  });
}));

export default router;
