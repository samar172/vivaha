import { Router } from "express";
import { z } from "zod";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import * as stock from "../../services/stock";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextPurchaseNo } from "../../services/sequence";
import { badRequest, notFound } from "../../utils/httpError";
import { recomputeLandedCost } from "@vivaha/shared";

const router = Router();

router.get("/", requirePerm("purchase.view"), asyncHandler(async (req, res) => {
  const q = z.object({ line: z.string().optional(), q: z.string().optional() }).parse(req.query);
  const rows = await prisma.purchase.findMany({
    where: { ...(q.line && q.line !== "ALL" ? { lines: { some: { item: { lineId: q.line } } } } : {}), ...(q.q ? { OR: [{ id: { contains: q.q, mode: "insensitive" } }, { invNo: { contains: q.q, mode: "insensitive" } }] } : {}) },
    include: { vendor: true, lines: { include: { item: { select: { sku: true, name: true, uom: true, lineId: true, landedCost: true } } } } },
    orderBy: { date: "desc" },
  });
  res.json(rows.map((p) => ({ ...p, total: D(p.total), freight: D(p.freight), lines: p.lines.map((l) => ({ ...l, rate: D(l.rate), item: { ...l.item, landedCost: D(l.item.landedCost) } })) })));
}));

const lineSchema = z.object({ itemId: z.string(), qty: z.number().int().positive(), rate: z.number().min(0), alloc: z.record(z.number().int().min(0)), batchNo: z.string().optional(), expiry: z.string().optional(), mfrCode: z.string().optional() });

// The manufacturer's label travels with the goods. Register it against the item
// so a scan of that carton resolves later, even after the office re-labels it.
// Already-known codes are left alone; a code pointing at a different item is a
// real data problem and is surfaced rather than silently re-pointed.
async function registerMfrCode(tx: Parameters<typeof audit>[0], itemId: string, code: string, vendorId: string | null, by: string) {
  const trimmed = code.trim();
  if (!trimmed) return;
  const existing = await tx.itemCode.findUnique({ where: { code: trimmed } });
  if (existing) {
    if (existing.itemId !== itemId) throw badRequest(`Label "${trimmed}" is already on file against another item`);
    return;
  }
  await tx.itemCode.create({ data: { code: trimmed, itemId, kind: "MANUFACTURER", status: "ACTIVE", vendorId, by, note: "Recorded at goods receipt" } });
}
const poSchema = z.object({ vendorId: z.string(), invNo: z.string().min(1), date: z.string().optional(), eta: z.string().optional(), freight: z.number().min(0).default(0), status: z.enum(["POSTED", "IN_TRANSIT"]).default("POSTED"), lines: z.array(lineSchema).min(1) });

router.post("/", requirePerm("purchase.create"), asyncHandler(async (req, res) => {
  const b = poSchema.parse(req.body);
  const items = await prisma.item.findMany({ where: { id: { in: b.lines.map((l) => l.itemId) } } });
  const im = Object.fromEntries(items.map((i) => [i.id, i]));
  // One document, one business line. The invoice carries a single GST rate and
  // the screens are scoped per line, so a mixed document would mis-tax itself.
  const lineIds = [...new Set(items.map((i) => i.lineId))];
  if (lineIds.length > 1) throw badRequest("A purchase invoice has to stay within one business line — raise a separate document per line");
  for (const l of b.lines) {
    const it = im[l.itemId]; if (!it) throw badRequest("Unknown item " + l.itemId);
    if (b.status === "POSTED") {
      const sum = Object.values(l.alloc).reduce((s, v) => s + v, 0);
      if (sum !== l.qty) throw badRequest(`${it.sku}: godown allocation must sum to the received quantity`);
      if (it.batchTracked && !l.batchNo) throw badRequest(`${it.sku} is batch-tracked — a batch number is required at receipt`);
    }
  }
  const gross = b.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const po = await prisma.$transaction(async (tx) => {
    const id = await nextPurchaseNo(tx);
    const po = await tx.purchase.create({ data: { id, vendorId: b.vendorId, invNo: b.invNo, date: b.date ? new Date(b.date) : new Date(), eta: b.eta ? new Date(b.eta) : null, freight: b.freight, total: gross, gstPct: im[b.lines[0].itemId].gstPct, status: b.status, by: req.user!.name, lines: { create: b.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, alloc: l.alloc, batchNo: l.batchNo ?? null, expiry: l.expiry ? new Date(l.expiry) : null, mfrCode: l.mfrCode?.trim() || null })) } } });
    for (const l of b.lines) if (l.mfrCode) await registerMfrCode(tx, l.itemId, l.mfrCode, b.vendorId, req.user!.name);
    if (b.status === "POSTED") {
      for (const l of b.lines) {
        const it = im[l.itemId];
        const onHandBefore = (await stock.bucketsAll(tx, l.itemId)).onHand;
        for (const g of Object.keys(l.alloc)) if (l.alloc[g] > 0) await stock.receive(tx, l.itemId, g, l.alloc[g], id, req.user!.name, l.batchNo ?? null, l.expiry ? new Date(l.expiry) : l.batchNo ? new Date(Date.now() + 365 * 864e5) : null);
        const share = gross > 0 ? (b.freight * (l.qty * l.rate)) / gross : 0;
        const newCost = recomputeLandedCost(D(it.landedCost), onHandBefore, l.qty, l.rate, share);
        await tx.item.update({ where: { id: it.id }, data: { landedCost: newCost } });
        await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Purchase invoice posted", entityType: "Purchase", entityId: b.invNo, newValue: "₹" + Math.round(l.qty * l.rate + share), reason: `Landed cost ₹${D(it.landedCost)} → ₹${newCost}` });
        await notify(tx, { text: `Goods receipt ${b.invNo} posted — ${l.qty} ${it.uom} of ${it.sku}`, kind: "OK", role: "PURCHASE_MANAGER" });
      }
    } else {
      await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Purchase order raised (in transit)", entityType: "Purchase", entityId: id, newValue: b.invNo });
    }
    return po;
  });
  res.status(201).json(po);
}));

// Receive an in-transit PO: allocate to godowns → stock lands, cost recomputed.
router.post("/:id/receive", requirePerm("purchase.create"), asyncHandler(async (req, res) => {
  const b = z.object({ lines: z.array(z.object({ itemId: z.string(), alloc: z.record(z.number().int().min(0)), batchNo: z.string().optional(), mfrCode: z.string().optional() })) }).parse(req.body);
  const po = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: { lines: { include: { item: true } } } });
  if (!po) throw notFound("Purchase not found");
  if (po.status !== "IN_TRANSIT") throw badRequest("Already received");
  const gross = po.lines.reduce((s, l) => s + l.qty * D(l.rate), 0);
  await prisma.$transaction(async (tx) => {
    for (const l of po.lines) {
      const inp = b.lines.find((x) => x.itemId === l.itemId); if (!inp) throw badRequest("Missing allocation for " + l.item.sku);
      const sum = Object.values(inp.alloc).reduce((s, v) => s + v, 0); if (sum !== l.qty) throw badRequest(`${l.item.sku}: allocation must sum to ${l.qty}`);
      if (l.item.batchTracked && !inp.batchNo) throw badRequest(`${l.item.sku} is batch-tracked — batch number required`);
      const onHandBefore = (await stock.bucketsAll(tx, l.itemId)).onHand;
      for (const g of Object.keys(inp.alloc)) if (inp.alloc[g] > 0) await stock.receive(tx, l.itemId, g, inp.alloc[g], po.id, req.user!.name, inp.batchNo ?? null, inp.batchNo ? new Date(Date.now() + 365 * 864e5) : null);
      const share = gross > 0 ? (D(po.freight) * (l.qty * D(l.rate))) / gross : 0;
      const newCost = recomputeLandedCost(D(l.item.landedCost), onHandBefore, l.qty, D(l.rate), share);
      await tx.item.update({ where: { id: l.itemId }, data: { landedCost: newCost } });
      const mfr = inp.mfrCode?.trim() || l.mfrCode || null;
      await tx.purchaseLine.update({ where: { id: l.id }, data: { alloc: inp.alloc, batchNo: inp.batchNo ?? null, mfrCode: mfr } });
      if (mfr) await registerMfrCode(tx, l.itemId, mfr, po.vendorId, req.user!.name);
    }
    await tx.purchase.update({ where: { id: po.id }, data: { status: "POSTED" } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Goods received against PO", entityType: "Purchase", entityId: po.id, oldValue: "In Transit", newValue: "Posted" });
  });
  res.json({ ok: true });
}));

router.post("/vendor-payments", requirePerm("purchase.create"), asyncHandler(async (req, res) => {
  const b = z.object({ vendorId: z.string(), amount: z.number().positive(), ref: z.string().default(""), date: z.string().optional() }).parse(req.body);
  const p = await prisma.vendorPayment.create({ data: { vendorId: b.vendorId, amount: b.amount, ref: b.ref, date: b.date ? new Date(b.date) : new Date() } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Vendor payment recorded", entityType: "Vendor", entityId: b.vendorId, newValue: "₹" + b.amount });
  res.status(201).json(p);
}));

export default router;
