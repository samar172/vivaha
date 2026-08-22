import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";

const router = Router();
router.get("/", requirePerm("audit.view"), asyncHandler(async (req, res) => {
  const q = z.object({ q: z.string().optional(), take: z.coerce.number().default(300) }).parse(req.query);
  const rows = await prisma.auditLog.findMany({ where: q.q ? { OR: [{ actor: { contains: q.q, mode: "insensitive" } }, { action: { contains: q.q, mode: "insensitive" } }, { entityId: { contains: q.q, mode: "insensitive" } }, { reason: { contains: q.q, mode: "insensitive" } }] } : {}, orderBy: { createdAt: "desc" }, take: q.take });
  res.json(rows);
}));
export default router;
