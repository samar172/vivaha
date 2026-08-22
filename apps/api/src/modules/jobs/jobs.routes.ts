import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextJobNo } from "../../services/sequence";
import * as stock from "../../services/stock";
import { badRequest, notFound } from "../../utils/httpError";
import { JOB_STATUSES } from "@vivaha/shared";

const router = Router();
const inc = { customer: { select: { id: true, name: true, tehsil: true } }, baseItem: { select: { id: true, sku: true, name: true, landedCost: true, uom: true } }, processItem: { select: { id: true, sku: true, name: true, wastagePct: true, setupCharge: true, slabs: true } } };

type Dec = Prisma.Decimal | number | null;
function costing(j: { qty: number; quote: Dec; baseItem: { landedCost: Dec }; processItem: { wastagePct: Dec; setupCharge: Dec; slabs: { rate: Dec }[] } }) {
  const w = D(j.processItem.wastagePct) || 4, waste = Math.ceil((j.qty * w) / 100);
  const base = (j.qty + waste) * D(j.baseItem.landedCost), proc = j.qty * D(j.processItem.slabs[0]?.rate), setup = D(j.processItem.setupCharge);
  const cost = base + proc + setup, quote = D(j.quote);
  return { wastagePct: w, waste, baseCards: j.qty + waste, baseCost: base, processRate: D(j.processItem.slabs[0]?.rate), processCost: proc, setup, cost, margin: quote > 0 ? (1 - cost / quote) : 0 };
}
const ser = (j: Parameters<typeof costing>[0] & Record<string, unknown>) => ({ ...j, quote: D(j.quote as number), costing: costing(j) });

router.get("/", requirePerm("order.view"), asyncHandler(async (_req, res) => {
  const rows = await prisma.jobWork.findMany({ include: inc, orderBy: { createdAt: "desc" } });
  res.json(rows.map((j) => ser(j as never)));
}));
router.get("/:id", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const j = await prisma.jobWork.findUnique({ where: { id: req.params.id }, include: inc });
  if (!j) throw notFound();
  res.json(ser(j as never));
}));
router.post("/", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const b = z.object({ customerId: z.string(), baseItemId: z.string(), processItemId: z.string(), qty: z.number().int().positive(), requiredBy: z.string(), text: z.string().min(1), quote: z.number().min(0).optional() }).parse(req.body);
  const [base, proc] = await Promise.all([prisma.item.findUnique({ where: { id: b.baseItemId } }), prisma.item.findUnique({ where: { id: b.processItemId }, include: { slabs: true } })]);
  if (!base || !proc) throw badRequest("Unknown base card or process");
  const c = costing({ qty: b.qty, quote: 0, baseItem: base, processItem: proc });
  const quote = b.quote ?? Math.round(c.cost * 1.3);
  const j = await prisma.$transaction(async (tx) => {
    const id = await nextJobNo(tx);
    const j = await tx.jobWork.create({ data: { id, customerId: b.customerId, baseItemId: b.baseItemId, processItemId: b.processItemId, qty: b.qty, requiredBy: new Date(b.requiredBy), text: b.text, quote, status: "QUOTED" }, include: inc });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Job work quoted", entityType: "Job", entityId: id, newValue: "₹" + quote });
    return j;
  });
  res.status(201).json(ser(j as never));
}));
// Printing cannot start without a recorded proof approval.
router.post("/:id/status", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const { to, godownId } = z.object({ to: z.enum(JOB_STATUSES), godownId: z.string().optional() }).parse(req.body);
  const j = await prisma.jobWork.findUnique({ where: { id: req.params.id }, include: inc });
  if (!j) throw notFound();
  const cur = JOB_STATUSES.indexOf(j.status), nxt = JOB_STATUSES.indexOf(to);
  if (nxt !== cur + 1) throw badRequest(`Cannot move ${j.status} → ${to}`);
  if (to === "PRINTING" && j.status !== "APPROVED_PROOF") throw badRequest("Printing cannot start without a recorded proof approval");
  await prisma.$transaction(async (tx) => {
    if (to === "PRINTING") {
      // Base cards are drawn through a normal outward movement (qty + wastage).
      const c = costing(j as never);
      const gd = godownId ?? (await tx.godown.findFirst({ where: { isActive: true } }))!.id;
      await stock.issue(tx, j.baseItemId, gd, c.baseCards, j.id, req.user!.name, "JOB_ISSUE");
    }
    await tx.jobWork.update({ where: { id: j.id }, data: { status: to, ...(to === "APPROVED_PROOF" ? { approvedAt: new Date() } : {}), ...(to === "PROOF_SENT" ? { proofs: { increment: 1 } } : {}) } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Job " + to.toLowerCase().replace(/_/g, " "), entityType: "Job", entityId: j.id, oldValue: j.status, newValue: to });
    if (to === "PROOF_SENT") await notify(tx, { text: `Proof sent for ${j.id} — waiting on ${j.customer.name}`, kind: "INFO", role: "SALES_EXECUTIVE" });
  });
  res.json({ ok: true });
}));

export default router;
