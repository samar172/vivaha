import { Router } from "express";
import { z } from "zod";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import * as stock from "../../services/stock";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextCreditNoteNo } from "../../services/sequence";
import { getHomeState } from "../../services/settings";
import { badRequest, notFound } from "../../utils/httpError";
import { taxOf, slabRate } from "@vivaha/shared";

const router = Router();
const inc = { item: { select: { sku: true, name: true, uom: true, gstPct: true } }, customer: { select: { id: true, name: true, gstin: true } } };

router.get("/", requirePerm("return.view"), asyncHandler(async (_req, res) => {
  const rows = await prisma.returnRequest.findMany({ include: inc, orderBy: { createdAt: "desc" } });
  res.json(rows.map((r) => ({ ...r, creditAmount: r.creditAmount == null ? null : D(r.creditAmount) })));
}));

router.post("/:id/start-inspection", requirePerm("return.process"), asyncHandler(async (req, res) => {
  const r = await prisma.returnRequest.findUnique({ where: { id: req.params.id } });
  if (!r) throw notFound();
  if (r.status !== "REQUESTED") throw badRequest("Return is not awaiting receipt");
  await prisma.returnRequest.update({ where: { id: r.id }, data: { status: "INSPECTION" } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Return received for inspection", entityType: "Return", entityId: r.id, oldValue: "Requested", newValue: "Inspection" });
  res.json({ ok: true });
}));

// BR-32: the inspection outcome decides the stock bucket. Nothing re-enters
// available stock automatically. Credit note at the original order rate.
router.post("/:id/inspect", requirePerm("return.process"), asyncHandler(async (req, res) => {
  const b = z.object({ outcome: z.enum(["Good stock", "Damaged", "Rejected"]), godownId: z.string(), note: z.string().min(3, "An inspection note is required") }).parse(req.body);
  const r = await prisma.returnRequest.findUnique({ where: { id: req.params.id }, include: { item: { include: { slabs: true } }, customer: true, order: { include: { lines: true } } } });
  if (!r) throw notFound();
  if (r.status === "ACCEPTED" || r.status === "REJECTED") throw badRequest("Return already closed");
  const homeState = await getHomeState();
  const out = await prisma.$transaction(async (tx) => {
    if (b.outcome === "Rejected") {
      await tx.returnRequest.update({ where: { id: r.id }, data: { status: "REJECTED", outcome: "Rejected", note: b.note, resolvedAt: new Date() } });
      await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Return rejected", entityType: "Return", entityId: r.id, oldValue: "Inspection", newValue: "Rejected", reason: b.note });
      return { rejected: true };
    }
    await stock.receive(tx, r.itemId, b.godownId, r.qty, r.id, req.user!.name, null, null, "RETURN_IN");
    if (b.outcome === "Damaged") await stock.adjust(tx, r.itemId, b.godownId, r.qty, "damage", `Return ${r.id}: ${b.note}`, req.user!.name);
    const ol = r.order.lines.find((l) => l.itemId === r.itemId);
    const rate = ol ? D(ol.rate) : slabRate(r.item.slabs.map((s) => ({ fromQty: s.fromQty, toQty: s.toQty, rate: D(s.rate) })), r.qty);
    const taxable = r.qty * rate, tx1 = taxOf(r.customer.gstin, taxable, r.item.gstPct, homeState), total = Math.round((taxable + tx1.total) * 100) / 100;
    const cn = await nextCreditNoteNo(tx);
    await tx.ledgerEntry.create({ data: { customerId: r.customerId, date: new Date(), type: "CREDIT", ref: cn, particular: `Credit Note ${cn} · return ${r.id}`, debit: 0, credit: total } });
    await tx.returnRequest.update({ where: { id: r.id }, data: { status: "ACCEPTED", outcome: b.outcome, note: b.note, godownId: b.godownId, creditAmount: total, creditNoteNo: cn, resolvedAt: new Date() } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Return accepted", entityType: "Return", entityId: r.id, oldValue: "Inspection", newValue: `${b.outcome} · ${cn}`, reason: b.note });
    await notify(tx, { text: `Credit note ${cn} issued to ${r.customer.name} for ₹${total.toFixed(2)}`, kind: "OK", role: "ACCOUNTS_MANAGER" });
    return { creditNoteNo: cn, total };
  });
  res.json(out);
}));

export default router;
