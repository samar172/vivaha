import { Router } from "express";
import { prisma } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";

const router = Router();
// Targeted (userId) or broadcast (role); broadcast read-state is per recipient.
router.get("/", asyncHandler(async (req, res) => {
  const u = req.user!;
  const [rows, reads] = await Promise.all([
    prisma.notification.findMany({ where: { OR: [{ userId: u.id }, { userId: null, role: u.role }, ...(u.role === "SUPER_ADMIN" ? [{ userId: null }] : [])] }, orderBy: { createdAt: "desc" }, take: 60 }),
    prisma.notificationRead.findMany({ where: { userId: u.id }, select: { notificationId: true } }),
  ]);
  const rd = new Set(reads.map((r) => r.notificationId));
  const seen = new Set<string>();
  const out = rows.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))).map((n) => ({ ...n, isRead: n.userId ? n.isRead : rd.has(n.id) }));
  res.json({ notifications: out, unread: out.filter((n) => !n.isRead).length });
}));
router.post("/:id/read", asyncHandler(async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!n) throw notFound();
  if (n.userId === null) await prisma.notificationRead.upsert({ where: { notificationId_userId: { notificationId: n.id, userId: req.user!.id } }, create: { notificationId: n.id, userId: req.user!.id }, update: {} });
  else if (n.userId === req.user!.id) await prisma.notification.update({ where: { id: n.id }, data: { isRead: true } });
  res.json({ ok: true });
}));
router.post("/read-all", asyncHandler(async (req, res) => {
  const u = req.user!;
  const bs = await prisma.notification.findMany({ where: { userId: null, ...(u.role === "SUPER_ADMIN" ? {} : { role: u.role }) }, select: { id: true } });
  await prisma.$transaction([
    prisma.notification.updateMany({ where: { userId: u.id, isRead: false }, data: { isRead: true } }),
    ...bs.map((b) => prisma.notificationRead.upsert({ where: { notificationId_userId: { notificationId: b.id, userId: u.id } }, create: { notificationId: b.id, userId: u.id }, update: {} })),
  ]);
  res.json({ ok: true });
}));
export default router;
