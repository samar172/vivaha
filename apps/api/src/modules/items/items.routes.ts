import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { loadItemViews, loadItemView } from "../../services/items";
import { audit } from "../../services/audit";
import { notFound, badRequest } from "../../utils/httpError";
import { getMinMargin } from "../../services/settings";

const router = Router();

router.get("/", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const q = z.object({ line: z.string().optional(), q: z.string().optional(), status: z.string().optional(), godown: z.string().optional(), filter: z.string().optional() }).parse(req.query);
  const where: Prisma.ItemWhereInput = {};
  if (q.line && q.line !== "ALL") where.lineId = q.line;
  if (q.status) where.status = q.status as "ACTIVE" | "DISCONTINUED";
  if (q.q) where.OR = [{ sku: { contains: q.q, mode: "insensitive" } }, { name: { contains: q.q, mode: "insensitive" } }, { designNo: { contains: q.q, mode: "insensitive" } }, { nameHi: { contains: q.q } }];
  let rows = await loadItemViews(where, q.godown);
  const lines = await prisma.businessLine.findMany();
  const lineMap = Object.fromEntries(lines.map((l) => [l.id, l]));
  const filters = (q.filter || "").split(",").filter(Boolean);
  if (filters.includes("low")) rows = rows.filter((i) => lineMap[i.lineId]?.workflow !== "JOBWORK" && i.available < (lineMap[i.lineId]?.minSetQty ?? 0));
  if (filters.includes("disc")) rows = rows.filter((i) => i.status === "DISCONTINUED");
  res.json({ items: rows, minMargin: await getMinMargin() });
}));

router.get("/:id", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const v = await loadItemView(req.params.id);
  if (!v) throw notFound("Item not found");
  const [txns, minMargin, vendor] = await Promise.all([
    prisma.stockTxn.findMany({ where: { itemId: v.id }, orderBy: { at: "desc" }, take: 12 }),
    getMinMargin(),
    v.vendorId ? prisma.vendor.findUnique({ where: { id: v.vendorId } }) : null,
  ]);
  res.json({ ...v, txns, minMargin, vendor });
}));

const slab = z.object({ fromQty: z.number().int().min(1), toQty: z.number().int().min(1), rate: z.number().min(0) });
const itemSchema = z.object({
  lineId: z.string(), name: z.string().min(1), nameHi: z.string().default(""), designNo: z.string().optional(), attrs: z.record(z.string()).default({}),
  uom: z.string().min(1), packUom: z.string().default(""), perPack: z.number().int().min(1).default(1), moq: z.number().int().min(1).default(1),
  landedCost: z.number().min(0), hsn: z.string().min(1), gstPct: z.number().int(), vendorId: z.string().nullable().optional(), season: z.string().optional(),
  batchTracked: z.boolean().default(false), wastagePct: z.number().optional(), setupCharge: z.number().optional(), slabs: z.array(slab).min(1), status: z.enum(["ACTIVE", "DISCONTINUED"]).default("ACTIVE"),
});

router.post("/", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const b = itemSchema.parse(req.body);
  const line = await prisma.businessLine.findUnique({ where: { id: b.lineId } });
  if (!line) throw badRequest("Unknown business line");
  const prefix = { cards: "WC", consumables: "CN", signage: "SG", acp: "AC", jobwork: "JW" }[line.code] ?? line.code.slice(0, 2).toUpperCase();
  const count = await prisma.item.count({ where: { lineId: line.id } });
  const sku = `${prefix}-${1000 + count * 3 + Math.floor(Math.random() * 3)}`;
  const id = `ITM-${Date.now().toString(36).toUpperCase()}`;
  const item = await prisma.item.create({
    data: { id, sku, designNo: b.designNo || null, name: b.name, nameHi: b.nameHi, lineId: b.lineId, attrs: b.attrs, uom: b.uom, packUom: b.packUom, perPack: b.perPack, moq: b.moq, landedCost: b.landedCost, hsn: b.hsn, gstPct: b.gstPct, vendorId: b.vendorId ?? null, season: b.season ?? null, batchTracked: b.batchTracked, wastagePct: b.wastagePct ?? null, setupCharge: b.setupCharge ?? null, artSeed: count, status: b.status, slabs: { create: b.slabs } },
  });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Item created", entityType: "Item", entityId: item.sku, newValue: b.name });
  res.status(201).json(await loadItemView(item.id));
}));

router.patch("/:id", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const b = itemSchema.partial().parse(req.body);
  const before = await prisma.item.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound("Item not found");
  const { slabs, ...rest } = b;
  await prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id: before.id }, data: { ...rest, vendorId: rest.vendorId === undefined ? undefined : rest.vendorId } });
    if (slabs) { await tx.priceSlab.deleteMany({ where: { itemId: before.id } }); await tx.priceSlab.createMany({ data: slabs.map((s) => ({ ...s, itemId: before.id })) }); }
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: b.status && b.status !== before.status ? "Item " + b.status.toLowerCase() : "Item updated", entityType: "Item", entityId: before.sku, oldValue: b.landedCost != null ? "cost " + D(before.landedCost) : before.status, newValue: b.landedCost != null ? "cost " + b.landedCost : b.status ?? "edited" });
  });
  res.json(await loadItemView(before.id));
}));

router.post("/bulk", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const { ids, action, pct } = z.object({ ids: z.array(z.string()).min(1), action: z.enum(["discontinue", "revise"]), pct: z.number().optional() }).parse(req.body);
  await prisma.$transaction(async (tx) => {
    if (action === "discontinue") {
      await tx.item.updateMany({ where: { id: { in: ids } }, data: { status: "DISCONTINUED" } });
      await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Items discontinued", entityType: "Item", entityId: ids.length + " items", newValue: ids.join(", ") });
    } else {
      const f = 1 + (pct ?? 0) / 100;
      const slabs = await tx.priceSlab.findMany({ where: { itemId: { in: ids } } });
      for (const s of slabs) await tx.priceSlab.update({ where: { id: s.id }, data: { rate: Math.round(D(s.rate) * f) } });
      await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Bulk rate revision", entityType: "Item", entityId: ids.length + " items", newValue: (pct ?? 0) + "%" });
    }
  });
  res.json({ ok: true, count: ids.length });
}));

export default router;
