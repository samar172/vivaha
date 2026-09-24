import { Router } from "express";
import { z } from "zod";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { loadItemViews } from "../../services/items";
import * as stock from "../../services/stock";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextTransferNo } from "../../services/sequence";
import { badRequest, notFound } from "../../utils/httpError";
import { ageDays, available, splitLocation } from "@vivaha/shared";

const router = Router();

router.get("/position", requirePerm("stock.view"), asyncHandler(async (req, res) => {
  const q = z.object({ line: z.string().optional(), q: z.string().optional(), godown: z.string().optional() }).parse(req.query);
  const lines = await prisma.businessLine.findMany({ where: { workflow: "FULFIL" } });
  const where = { lineId: q.line && q.line !== "ALL" ? q.line : { in: lines.map((l) => l.id) }, ...(q.q ? { OR: [{ sku: { contains: q.q, mode: "insensitive" as const } }, { name: { contains: q.q, mode: "insensitive" as const } }] } : {}) };
  const rows = await loadItemViews(where, q.godown);
  res.json(rows.map((i) => ({ ...i, valueAtCost: (i.onHand - i.damaged - i.quarantined) * i.landedCost })));
}));

router.get("/transfers", requirePerm("stock.view"), asyncHandler(async (_req, res) => {
  const t = await prisma.transfer.findMany({ orderBy: { at: "desc" }, include: { item: { select: { sku: true, name: true, uom: true } } } });
  res.json(t);
}));

router.post("/transfers", requirePerm("stock.transfer"), asyncHandler(async (req, res) => {
  const b = z.object({ itemId: z.string(), fromId: z.string(), toId: z.string(), qty: z.number().int().positive() }).parse(req.body);
  if (b.fromId === b.toId) throw badRequest("Source and destination must differ");
  const item = await prisma.item.findUnique({ where: { id: b.itemId } });
  if (!item) throw notFound("Item not found");
  const t = await prisma.$transaction(async (tx) => {
    const id = await nextTransferNo(tx);
    const batch = await stock.issue(tx, b.itemId, b.fromId, b.qty, id, req.user!.name, "TRANSFER_OUT");
    const t = await tx.transfer.create({ data: { id, itemId: b.itemId, fromId: b.fromId, toId: b.toId, qty: b.qty, batchNo: batch, by: req.user!.name } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Stock transfer raised", entityType: "Transfer", entityId: id, oldValue: b.fromId, newValue: b.toId, reason: `${b.qty} ${item.uom}` });
    await notify(tx, { text: `${id} pending receipt at ${b.toId} — ${b.qty} ${item.uom.toLowerCase()} in transit`, kind: "INFO", role: "GODOWN_MANAGER" });
    return t;
  });
  res.status(201).json(t);
}));

router.post("/transfers/:id/receive", requirePerm("stock.transfer"), asyncHandler(async (req, res) => {
  // Which shelf it was put on at the far end. Optional: a godown that does not
  // run racks receives exactly as it always did.
  const { rack } = z.object({ rack: z.string().default("") }).parse(req.body ?? {});
  const t = await prisma.transfer.findUnique({ where: { id: req.params.id } });
  if (!t) throw notFound("Transfer not found");
  if (t.status !== "IN_TRANSIT") throw badRequest("Already received");
  const out = await prisma.$transaction(async (tx) => {
    // A rack written down here is remembered, the same as at a goods receipt.
    const loc = stock.rackOf(rack);
    if (loc && loc !== stock.RACK_NONE) {
      const { rack: code, sub } = splitLocation(loc);
      let row = await tx.rack.findUnique({ where: { godownId_code: { godownId: t.toId, code } } });
      if (!row) row = await tx.rack.create({ data: { godownId: t.toId, code } });
      else if (!row.isActive) row = await tx.rack.update({ where: { id: row.id }, data: { isActive: true } });
      if (sub) {
        const shelf = await tx.subRack.findUnique({ where: { rackId_code: { rackId: row.id, code: sub } } });
        if (!shelf) await tx.subRack.create({ data: { rackId: row.id, code: sub } });
        else if (!shelf.isActive) await tx.subRack.update({ where: { id: shelf.id }, data: { isActive: true } });
      }
    }
    await stock.receive(tx, t.itemId, t.toId, t.qty, t.id, req.user!.name, t.batchNo === "-" ? null : t.batchNo, null, "TRANSFER_IN", rack);
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Stock transfer received", entityType: "Transfer", entityId: t.id, oldValue: "In Transit", newValue: rack ? `Received · rack ${rack}` : "Received" });
    return tx.transfer.update({ where: { id: t.id }, data: { status: "RECEIVED", receivedAt: new Date() } });
  });
  res.json(out);
}));

router.post("/adjust", requirePerm("stock.adjust"), asyncHandler(async (req, res) => {
  const b = z.object({ itemId: z.string(), godownId: z.string(), qty: z.number().int().positive(), dir: z.enum(["damage", "quarantine", "recover", "writeoff"]), reason: z.string().min(3, "A reason is mandatory for every stock adjustment") }).parse(req.body);
  const item = await prisma.item.findUnique({ where: { id: b.itemId } });
  if (!item) throw notFound("Item not found");
  await prisma.$transaction(async (tx) => {
    await stock.adjust(tx, b.itemId, b.godownId, b.qty, b.dir, b.reason, req.user!.name);
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Stock " + b.dir, entityType: "Item", entityId: item.sku, newValue: `${b.qty} ${item.uom} · ${b.godownId}`, reason: b.reason });
  });
  res.json({ ok: true });
}));

router.get("/ageing", requirePerm("stock.view"), asyncHandler(async (req, res) => {
  const line = String(req.query.line || "ALL");
  const B = [[0, 30], [31, 90], [91, 180], [181, 365], [366, 1e5]];
  const q = [0, 0, 0, 0, 0], v = [0, 0, 0, 0, 0];
  const ps = await prisma.purchase.findMany({ include: { lines: { include: { item: { select: { lineId: true } } } } } });
  for (const p of ps) {
    const a = ageDays(p.date); let bi = B.findIndex((x) => a >= x[0] && a <= x[1]); if (bi < 0) bi = 4;
    for (const l of p.lines) { if (line !== "ALL" && l.item.lineId !== line) continue; q[bi] += l.qty; v[bi] += l.qty * D(l.rate); }
  }
  res.json({ labels: ["0–30 d", "31–90 d", "91–180 d", "181–365 d", "365+ d"], qty: q, value: v });
}));

router.get("/dead", requirePerm("stock.view"), asyncHandler(async (req, res) => {
  const line = String(req.query.line || "ALL");
  const days = Number(req.query.days || 45);
  const items = await loadItemViews({ line: { workflow: "FULFIL" }, ...(line !== "ALL" ? { lineId: line } : {}) });
  const shipped = await prisma.stockTxn.groupBy({ by: ["itemId"], where: { type: "DISPATCH" }, _sum: { qty: true }, _max: { at: true } });
  const sm = Object.fromEntries(shipped.map((s) => [s.itemId, s]));
  const rows = items.map((i) => { const s = sm[i.id]; const sold = s?._sum.qty ?? 0; const idle = s?._max.at ? ageDays(s._max.at) : 999; return { item: i, sold, daysIdle: idle, capital: i.available * i.landedCost }; })
    .filter((r) => r.sold === 0 || r.daysIdle > days).sort((a, b) => b.capital - a.capital);
  res.json({ days, rows, capital: rows.reduce((s, r) => s + r.capital, 0) });
}));

router.get("/expiry", requirePerm("stock.view"), asyncHandler(async (req, res) => {
  const line = String(req.query.line || "ALL");
  const rows = await prisma.stockBalance.findMany({ where: { expiry: { not: null }, onHand: { gt: 0 }, ...(line !== "ALL" ? { item: { lineId: line } } : {}) }, include: { item: { select: { sku: true, name: true, lineId: true } } }, orderBy: { expiry: "asc" } });
  res.json(rows.map((b) => ({ id: b.id, sku: b.item.sku, name: b.item.name, batchNo: b.batchNo, godownId: b.godownId, onHand: b.onHand, available: available(b), expiry: b.expiry, daysLeft: Math.round((b.expiry!.getTime() - Date.now()) / 864e5) })));
}));

router.get("/txns", requirePerm("stock.view"), asyncHandler(async (req, res) => {
  const q = z.object({ itemId: z.string().optional(), ref: z.string().optional(), take: z.coerce.number().default(50) }).parse(req.query);
  res.json(await prisma.stockTxn.findMany({ where: { itemId: q.itemId, ref: q.ref }, orderBy: { at: "desc" }, take: q.take }));
}));

export default router;
