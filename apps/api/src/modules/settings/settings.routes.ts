import { Router } from "express";
import { z } from "zod";
import { PERMS, ROLES, DEFAULT_ROLE_PERMS } from "@vivaha/shared";
import { prisma } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { allRolePerms, invalidatePermCache } from "../../services/permissions";
import { getMinMargin, getCompany, setSetting } from "../../services/settings";
import { audit } from "../../services/audit";

const router = Router();
router.get("/", asyncHandler(async (_req, res) => res.json({ minMargin: await getMinMargin(), company: await getCompany() })));
router.put("/", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = z.object({ minMargin: z.number().min(0).max(0.9).optional(), company: z.object({ name: z.string(), address: z.string(), gstin: z.string(), state: z.string().length(2), phone: z.string() }).optional() }).parse(req.body);
  if (b.minMargin != null) { const before = await getMinMargin(); await setSetting("MIN_MARGIN", b.minMargin); await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Margin floor changed", entityType: "Settings", entityId: "MIN_MARGIN", oldValue: before * 100 + "%", newValue: b.minMargin * 100 + "%" }); }
  if (b.company) await setSetting("COMPANY", b.company);
  res.json({ minMargin: await getMinMargin(), company: await getCompany() });
}));
router.get("/permissions", asyncHandler(async (_req, res) => res.json({ perms: PERMS, roles: ROLES.filter((r) => r !== "CUSTOMER"), matrix: await allRolePerms() })));
router.put("/permissions/:role", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const role = z.enum(ROLES).parse(req.params.role);
  const { perms } = z.object({ perms: z.array(z.enum(PERMS)) }).parse(req.body);
  await prisma.$transaction([prisma.rolePermission.deleteMany({ where: { role } }), prisma.rolePermission.createMany({ data: perms.map((perm) => ({ role, perm })) })]);
  invalidatePermCache();
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Role permissions changed", entityType: "Settings", entityId: role, newValue: perms.length + " capabilities" });
  res.json({ ok: true });
}));
router.post("/permissions/reset", requirePerm("settings.manage"), asyncHandler(async (_req, res) => {
  await prisma.rolePermission.deleteMany();
  await prisma.rolePermission.createMany({ data: ROLES.flatMap((role) => DEFAULT_ROLE_PERMS[role].map((perm) => ({ role, perm }))) });
  invalidatePermCache();
  res.json({ ok: true });
}));
router.get("/counts", asyncHandler(async (_req, res) => {
  const [items, firms, orders, invoices, stockRows, txns, auditRows] = await Promise.all([prisma.item.count(), prisma.customer.count(), prisma.order.count(), prisma.invoice.count(), prisma.stockBalance.count(), prisma.stockTxn.count(), prisma.auditLog.count()]);
  res.json({ items, firms, orders, invoices, stockRows, txns, audit: auditRows });
}));
export default router;
