import { Prisma } from "@prisma/client";
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

// One purchase document, for its own page. Same shape the list returns, so the
// screen reads the same fields whichever way it arrived at them.
router.get("/:id", requirePerm("purchase.view"), asyncHandler(async (req, res) => {
  const p = await prisma.purchase.findUnique({
    where: { id: req.params.id },
    include: { vendor: true, lines: { include: { item: { select: { id: true, sku: true, name: true, uom: true, lineId: true, landedCost: true } } } } },
  });
  if (!p) throw notFound("Purchase document not found");
  res.json({ ...p, total: D(p.total), freight: D(p.freight), lines: p.lines.map((l) => ({ ...l, rate: D(l.rate), item: { ...l.item, landedCost: D(l.item.landedCost) } })) });
}));

router.get("/", requirePerm("purchase.view"), asyncHandler(async (req, res) => {
  const q = z.object({ line: z.string().optional(), q: z.string().optional() }).parse(req.query);
  const rows = await prisma.purchase.findMany({
    where: { ...(q.line && q.line !== "ALL" ? { lines: { some: { item: { lineId: q.line } } } } : {}), ...(q.q ? { OR: [{ id: { contains: q.q, mode: "insensitive" } }, { invNo: { contains: q.q, mode: "insensitive" } }] } : {}) },
    include: { vendor: true, lines: { include: { item: { select: { sku: true, name: true, uom: true, lineId: true, landedCost: true } } } } },
    orderBy: { date: "desc" },
  });
  res.json(rows.map((p) => ({ ...p, total: D(p.total), freight: D(p.freight), lines: p.lines.map((l) => ({ ...l, rate: D(l.rate), item: { ...l.item, landedCost: D(l.item.landedCost) } })) })));
}));

const placeSchema = z.object({ godownId: z.string().min(1), rack: z.string().default(""), qty: z.number().int().min(0) });
const lineSchema = z.object({
  itemId: z.string(), qty: z.number().int().positive(), rate: z.number().min(0),
  // Where the goods go. `places` names the rack; `alloc` is the godown roll-up
  // and is what every other screen and the stock engine read. A caller may send
  // either — a document raised before racks existed still sends only `alloc` —
  // and the two are reconciled here so they can never drift apart.
  places: z.array(placeSchema).optional(),
  alloc: z.record(z.number().int().min(0)).optional(),
  batchNo: z.string().optional(), expiry: z.string().optional(), mfrCode: z.string().optional(),
});

type Placed = { places: stock.Placement[]; alloc: Record<string, number> };
/** One truth for where a line's goods went, whichever way the caller said it. */
function placementsOf(l: { places?: { godownId: string; rack: string; qty: number }[]; alloc?: Record<string, number> }): Placed {
  const places: stock.Placement[] = l.places?.length
    ? l.places.filter((p) => p.qty > 0).map((p) => ({ godownId: p.godownId, rack: stock.rackOf(p.rack), qty: p.qty }))
    : Object.entries(l.alloc ?? {}).filter(([, q]) => q > 0).map(([godownId, qty]) => ({ godownId, rack: stock.RACK_NONE, qty }));
  return { places, alloc: stock.placementsToMap(places) };
}
const placedQty = (p: Placed) => p.places.reduce((s, x) => s + x.qty, 0);
// Prisma types a Json column as a structural value; a list of placements is one.
const asJson = (v: unknown) => v as Prisma.InputJsonValue;

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

// A receipt moves two prices, and both belong in the item's history.
//
// The history screen answers "why is this dearer than last season", and until
// now it only saw what somebody typed on the item screen — while the commonest
// reason a cost moves is a delivery arriving at a different rate. A landed cost
// that drifts upward across four receipts with nothing recorded is exactly the
// drift nobody can explain afterwards.
async function recordPriceMove(
  tx: Parameters<typeof audit>[0],
  itemId: string, by: string, ref: string,
  moves: { field: "landedCost" | "purchasePrice"; from: number; to: number }[],
) {
  const real = moves.filter((m) => Math.abs(m.to - m.from) > 0.004);
  if (!real.length) return;
  await tx.itemPriceHistory.createMany({
    data: real.map((m) => ({ itemId, field: m.field, oldValue: m.from, newValue: m.to, by, reason: `Goods receipt ${ref}` })),
  });
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
      if (placedQty(placementsOf(l)) !== l.qty) throw badRequest(`${it.sku}: godown allocation must sum to the received quantity`);
      if (it.batchTracked && !l.batchNo) throw badRequest(`${it.sku} is batch-tracked — a batch number is required at receipt`);
    }
  }
  const gross = b.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const po = await prisma.$transaction(async (tx) => {
    const id = await nextPurchaseNo(tx);
    const po = await tx.purchase.create({ data: { id, vendorId: b.vendorId, invNo: b.invNo, date: b.date ? new Date(b.date) : new Date(), eta: b.eta ? new Date(b.eta) : null, freight: b.freight, total: gross, gstPct: im[b.lines[0].itemId].gstPct, status: b.status, by: req.user!.name, lines: { create: b.lines.map((l) => { const pl = placementsOf(l); return { itemId: l.itemId, qty: l.qty, rate: l.rate, alloc: pl.alloc, places: asJson(pl.places), batchNo: l.batchNo ?? null, expiry: l.expiry ? new Date(l.expiry) : null, mfrCode: l.mfrCode?.trim() || null }; }) } } });
    for (const l of b.lines) if (l.mfrCode) await registerMfrCode(tx, l.itemId, l.mfrCode, b.vendorId, req.user!.name);
    if (b.status === "POSTED") {
      for (const l of b.lines) {
        const it = im[l.itemId];
        const onHandBefore = (await stock.bucketsAll(tx, l.itemId)).onHand;
        for (const pl of placementsOf(l).places) await stock.receive(tx, l.itemId, pl.godownId, pl.qty, id, req.user!.name, l.batchNo ?? null, l.expiry ? new Date(l.expiry) : l.batchNo ? new Date(Date.now() + 365 * 864e5) : null, "GRN", pl.rack);
        const share = gross > 0 ? (b.freight * (l.qty * l.rate)) / gross : 0;
        const newCost = recomputeLandedCost(D(it.landedCost), onHandBefore, l.qty, l.rate, share);
        // Landed cost carries freight and is what the margin floor is measured
        // against; purchasePrice is the supplier's own rate, which is what the
        // office prices off. Both move on a receipt, and neither is the other.
        await tx.item.update({ where: { id: it.id }, data: { landedCost: newCost, purchasePrice: l.rate } });
        await recordPriceMove(tx, it.id, req.user!.name, b.invNo, [
          { field: "landedCost", from: D(it.landedCost), to: newCost },
          { field: "purchasePrice", from: it.purchasePrice == null ? 0 : D(it.purchasePrice), to: l.rate },
        ]);
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
// Correcting a document that has not landed yet.
//
// A purchase in transit has moved no stock and touched no landed cost, so its
// lines can be replaced outright. Once it is received that stops being true —
// the goods are in a godown and every item's landed cost has been recomputed
// around them — so a posted receipt is refused here rather than silently
// rewriting what the godown actually holds. That correction is a stock
// adjustment, which is audited as one.
router.patch("/:id", requirePerm("purchase.create"), asyncHandler(async (req, res) => {
  const b = poSchema.partial().parse(req.body);
  const po = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: { lines: true } });
  if (!po) throw notFound("Purchase not found");
  if (po.status === "POSTED") throw badRequest("This receipt is already posted — the goods are in the godown. Correct the quantity with a stock adjustment, which is audited against the item.");

  if (b.lines) {
    const items = await prisma.item.findMany({ where: { id: { in: b.lines.map((l) => l.itemId) } } });
    if (items.length !== new Set(b.lines.map((l) => l.itemId)).size) throw badRequest("Unknown item on one of the lines");
    if (new Set(items.map((i) => i.lineId)).size > 1) throw badRequest("A purchase invoice has to stay within one business line — raise a separate document per line");
  }
  const gross = (b.lines ?? po.lines.map((l) => ({ qty: l.qty, rate: D(l.rate) }))).reduce((s, l) => s + l.qty * l.rate, 0);

  const out = await prisma.$transaction(async (tx) => {
    if (b.lines) {
      await tx.purchaseLine.deleteMany({ where: { purchaseId: po.id } });
      await tx.purchaseLine.createMany({
        data: b.lines.map((l) => { const pl = placementsOf(l); return { purchaseId: po.id, itemId: l.itemId, qty: l.qty, rate: l.rate, alloc: pl.alloc, places: asJson(pl.places), batchNo: l.batchNo ?? null, mfrCode: l.mfrCode ?? null }; }),
      });
    }
    const next = await tx.purchase.update({
      where: { id: po.id },
      data: {
        vendorId: b.vendorId ?? undefined, invNo: b.invNo ?? undefined,
        date: b.date ? new Date(b.date) : undefined,
        eta: b.eta === undefined ? undefined : (b.eta ? new Date(b.eta) : null),
        freight: b.freight ?? undefined, total: gross,
      },
      include: { vendor: true, lines: { include: { item: { select: { id: true, sku: true, name: true, uom: true, lineId: true, landedCost: true } } } } },
    });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Purchase order corrected", entityType: "Purchase", entityId: po.id,
                      oldValue: `${po.lines.length} line(s) · ₹${D(po.total)} + ₹${D(po.freight)} freight`,
                      newValue: `${next.lines.length} line(s) · ₹${D(next.total)} + ₹${D(next.freight)} freight` });
    return next;
  });
  res.json({ ...out, total: D(out.total), freight: D(out.freight), lines: out.lines.map((l) => ({ ...l, rate: D(l.rate), item: { ...l.item, landedCost: D(l.item.landedCost) } })) });
}));

router.post("/:id/receive", requirePerm("purchase.create"), asyncHandler(async (req, res) => {
  const b = z.object({ lines: z.array(z.object({ itemId: z.string(), places: z.array(placeSchema).optional(), alloc: z.record(z.number().int().min(0)).optional(), batchNo: z.string().optional(), mfrCode: z.string().optional() })) }).parse(req.body);
  const po = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: { lines: { include: { item: true } } } });
  if (!po) throw notFound("Purchase not found");
  if (po.status !== "IN_TRANSIT") throw badRequest("Already received");
  const gross = po.lines.reduce((s, l) => s + l.qty * D(l.rate), 0);
  await prisma.$transaction(async (tx) => {
    for (const l of po.lines) {
      const inp = b.lines.find((x) => x.itemId === l.itemId); if (!inp) throw badRequest("Missing allocation for " + l.item.sku);
      const pl = placementsOf(inp); if (placedQty(pl) !== l.qty) throw badRequest(`${l.item.sku}: allocation must sum to ${l.qty}`);
      if (l.item.batchTracked && !inp.batchNo) throw badRequest(`${l.item.sku} is batch-tracked — batch number required`);
      const onHandBefore = (await stock.bucketsAll(tx, l.itemId)).onHand;
      for (const p of pl.places) await stock.receive(tx, l.itemId, p.godownId, p.qty, po.id, req.user!.name, inp.batchNo ?? null, inp.batchNo ? new Date(Date.now() + 365 * 864e5) : null, "GRN", p.rack);
      const share = gross > 0 ? (D(po.freight) * (l.qty * D(l.rate))) / gross : 0;
      const newCost = recomputeLandedCost(D(l.item.landedCost), onHandBefore, l.qty, D(l.rate), share);
      await tx.item.update({ where: { id: l.itemId }, data: { landedCost: newCost, purchasePrice: D(l.rate) } });
      await recordPriceMove(tx, l.itemId, req.user!.name, po.invNo, [
        { field: "landedCost", from: D(l.item.landedCost), to: newCost },
        { field: "purchasePrice", from: l.item.purchasePrice == null ? 0 : D(l.item.purchasePrice), to: D(l.rate) },
      ]);
      const mfr = inp.mfrCode?.trim() || l.mfrCode || null;
      await tx.purchaseLine.update({ where: { id: l.id }, data: { alloc: pl.alloc, places: asJson(pl.places), batchNo: inp.batchNo ?? null, mfrCode: mfr } });
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
