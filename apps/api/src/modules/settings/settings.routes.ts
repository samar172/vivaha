import { Router } from "express";
import { z } from "zod";
import { PERMS, ROLES, DEFAULT_ROLE_PERMS } from "@vivaha/shared";
import { prisma } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { allRolePerms, invalidatePermCache } from "../../services/permissions";
import { getMinMargin, getCompany, setSetting } from "../../services/settings";
import { audit } from "../../services/audit";
import { badRequest, notFound } from "../../utils/httpError";
import bcrypt from "bcryptjs";
import * as svc from "../auth/auth.service";
import { BACKUP_FORMAT, dumpAll, dataThrough, restoreAll } from "../../services/backup";

const router = Router();

// ── Users & logins ──────────────────────────────────────────────────────────
// Staff accounts and customer-portal accounts are the same User table; the role
// separates them and the login screen refuses to cross the two.
const userSelect = { id: true, username: true, name: true, initials: true, role: true, isActive: true, authority: true, mustChangePassword: true, passwordSetAt: true, lastLoginAt: true, lockedUntil: true, createdAt: true, customerId: true, customer: { select: { id: true, name: true, tehsil: true } } };

router.get("/users", requirePerm("settings.manage"), asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({ select: userSelect, orderBy: [{ role: "asc" }, { name: "asc" }] });
  res.json({ staff: users.filter((u) => u.role !== "CUSTOMER"), portal: users.filter((u) => u.role === "CUSTOMER") });
}));

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "??";

router.post("/users", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = z.object({
    name: z.string().min(2, "Enter the person's name"),
    username: z.string().min(3, "Username needs at least 3 characters").regex(/^[a-z0-9._-]+$/, "Use lowercase letters, digits, dot, dash or underscore only"),
    role: z.enum(ROLES),
    customerId: z.string().optional(),
    authority: z.enum(["Owner", "Staff"]).optional(),
  }).parse(req.body);
  if (b.role === "CUSTOMER" && !b.customerId) throw badRequest("A portal login has to be attached to a firm");
  if (b.role !== "CUSTOMER" && b.customerId) throw badRequest("Only a portal login can be attached to a firm");
  if (await prisma.user.findUnique({ where: { username: b.username } })) throw badRequest(`Username "${b.username}" is already taken`);
  if (b.customerId && !(await prisma.customer.findUnique({ where: { id: b.customerId } }))) throw notFound("Firm not found");

  const password = svc.generatePassword();
  const user = await prisma.user.create({
    data: {
      username: b.username, name: b.name, initials: initialsOf(b.name), role: b.role,
      passwordHash: await bcrypt.hash(password, 10), isActive: true,
      mustChangePassword: true, passwordSetAt: new Date(),
      customerId: b.customerId ?? null, authority: b.role === "CUSTOMER" ? (b.authority ?? "Owner") : null,
    },
    select: userSelect,
  });
  if (b.customerId) await prisma.customerContact.updateMany({ where: { customerId: b.customerId, name: b.name }, data: { hasLogin: true } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: b.role === "CUSTOMER" ? "Portal login created" : "Staff account created", entityType: "User", entityId: b.username, newValue: b.role });
  res.status(201).json({ user, password });
}));

router.post("/users/:id/reset-password", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const out = await svc.issuePassword(req.params.id, { id: req.user!.id, name: req.user!.name });
  res.json(out);
}));

router.patch("/users/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = z.object({ isActive: z.boolean().optional(), role: z.enum(ROLES).optional(), name: z.string().min(2).optional() }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!u) throw notFound("User not found");
  if (u.id === req.user!.id && b.isActive === false) throw badRequest("You cannot deactivate the account you are signed in with");
  if (b.role && (b.role === "CUSTOMER") !== (u.role === "CUSTOMER")) throw badRequest("A staff account and a portal login cannot be converted into one another");
  const user = await prisma.user.update({ where: { id: u.id }, data: { ...b, ...(b.name ? { initials: initialsOf(b.name) } : {}) }, select: userSelect });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: b.isActive === false ? "Account deactivated" : b.isActive === true ? "Account reactivated" : "Account updated", entityType: "User", entityId: u.username, oldValue: u.role, newValue: user.role });
  res.json(user);
}));

// ── Backup & restore ────────────────────────────────────────────────────────
// A full point-in-time copy of every table. The manifest carries two different
// times on purpose: `takenAt` is when the file was produced, `through` is how
// far the data inside it actually reaches. `through` is what tells you whether
// one file is older than another — two backups never overlap ambiguously.
router.get("/backup", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const { data, counts, through } = await dumpAll();
  const takenAt = new Date();
  const company = await getCompany();
  const stamp = takenAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Backup downloaded", entityType: "System", entityId: stamp, newValue: `${Object.values(counts).reduce((s, n) => s + n, 0)} rows` });
  res.setHeader("Content-Disposition", `attachment; filename="vivaha-backup-${stamp}.json"`);
  res.json({
    manifest: {
      app: "vivaha-erp", format: BACKUP_FORMAT,
      takenAt: takenAt.toISOString(),
      through,
      takenBy: req.user!.name,
      company: company?.name ?? "Vivaha Cards",
      rows: Object.values(counts).reduce((s, n) => s + n, 0),
      counts,
    },
    data,
  });
}));

// What is live right now — so the restore screen can put the file's dates next
// to the database's before anyone commits to overwriting.
router.get("/backup/state", requirePerm("settings.manage"), asyncHandler(async (_req, res) => {
  res.json({ format: BACKUP_FORMAT, through: await dataThrough() });
}));

router.post("/restore", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = z.object({
    manifest: z.object({ app: z.string(), format: z.number(), takenAt: z.string(), through: z.string().nullable().optional(), takenBy: z.string().optional(), rows: z.number().optional() }),
    data: z.record(z.array(z.record(z.unknown()))),
    confirm: z.literal("RESTORE", { errorMap: () => ({ message: 'Type RESTORE to confirm — this replaces every record' }) }),
    allowOlder: z.boolean().default(false),
  }).parse(req.body);

  if (b.manifest.app !== "vivaha-erp") throw badRequest("This file was not produced by Vivaha Cards ERP");
  if (b.manifest.format !== BACKUP_FORMAT) throw badRequest(`This backup is format ${b.manifest.format}; this build reads format ${BACKUP_FORMAT}. Restore it on a matching build.`);
  for (const m of ["Setting", "BusinessLine", "Item", "User"]) {
    if (!b.data[m]) throw badRequest(`The file is missing the ${m} table — it is not a complete backup`);
  }

  // Guard against rolling the business backwards with an older snapshot.
  const live = await dataThrough();
  const file = b.manifest.through ?? null;
  if (!b.allowOlder && live && file && new Date(file) < new Date(live)) {
    throw badRequest(`This backup only reaches ${new Date(file).toLocaleString("en-IN")}, but the live data runs to ${new Date(live).toLocaleString("en-IN")}. Everything after the backup would be lost — confirm again to restore anyway.`);
  }

  let report;
  try {
    report = await restoreAll(b.data as Record<string, Record<string, unknown>[]>);
  } catch (e) {
    // The whole restore runs in one transaction, so a failure here leaves the
    // database untouched — say what broke instead of a bare 500.
    const msg = e instanceof Error ? e.message.split("\n").filter(Boolean).slice(-3).join(" ") : String(e);
    throw badRequest(`Restore failed and nothing was changed: ${msg}`);
  }
  invalidatePermCache();
  // The audit trail was replaced along with everything else, so the restore is
  // recorded on top of the restored trail — it is the first entry after it.
  const stillHere = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (stillHere) {
    await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Backup restored", entityType: "System", entityId: b.manifest.takenAt, oldValue: live ?? "", newValue: file ?? "", reason: `Restored a backup taken by ${b.manifest.takenBy ?? "unknown"}` });
  }
  res.json({ ...report, signOutRequired: !stillHere, restoredThrough: file });
}));

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
