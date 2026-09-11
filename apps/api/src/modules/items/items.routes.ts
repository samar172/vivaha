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
import { storeItemImage, removeItemImage } from "../../services/uploads";

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

// Price movements for one item, newest first — previous, current, the change
// and who made it. Read straight off ItemPriceHistory; nothing is estimated.
router.get("/:id/price-history", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const rows = await prisma.itemPriceHistory.findMany({ where: { itemId: req.params.id }, orderBy: { at: "desc" }, take: 50 });
  res.json(rows.map((r) => {
    const oldV = D(r.oldValue), newV = D(r.newValue);
    return { id: r.id, field: r.field, oldValue: oldV, newValue: newV, change: newV - oldV, pct: oldV ? ((newV - oldV) / oldV) * 100 : 0, by: r.by, reason: r.reason, at: r.at };
  }));
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
  const beforeSlabs = await prisma.priceSlab.findMany({ where: { itemId: before.id }, orderBy: { fromQty: "asc" } });
  await prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id: before.id }, data: { ...rest, vendorId: rest.vendorId === undefined ? undefined : rest.vendorId } });
    if (slabs) { await tx.priceSlab.deleteMany({ where: { itemId: before.id } }); await tx.priceSlab.createMany({ data: slabs.map((s) => ({ ...s, itemId: before.id })) }); }

    // "Why is this dearer than last season" needs an answer with a name and a
    // date on it. The audit log carries the same facts as prose; this is the
    // shape a screen can chart. Only actual movements are written.
    const hist: { field: string; oldValue: number; newValue: number }[] = [];
    const oldBase = beforeSlabs[0] ? D(beforeSlabs[0].rate) : null;
    const newBase = slabs?.[0]?.rate ?? null;
    if (oldBase != null && newBase != null && oldBase !== newBase) hist.push({ field: "slab1", oldValue: oldBase, newValue: newBase });
    if (rest.landedCost != null && D(before.landedCost) !== rest.landedCost) hist.push({ field: "landedCost", oldValue: D(before.landedCost), newValue: rest.landedCost });
    if (hist.length) await tx.itemPriceHistory.createMany({ data: hist.map((h) => ({ ...h, itemId: before.id, by: req.user!.name, reason: (req.body as { reason?: string }).reason ?? "" })) });

    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: b.status && b.status !== before.status ? "Item " + b.status.toLowerCase() : "Item updated", entityType: "Item", entityId: before.sku, oldValue: b.landedCost != null ? "cost " + D(before.landedCost) : before.status, newValue: b.landedCost != null ? "cost " + b.landedCost : b.status ?? "edited" });
  });
  res.json(await loadItemView(before.id));
}));

// A card is bought by its picture. Item.imageUrl has always existed and
// thumb() has always preferred a real photograph over the generated artwork —
// nothing ever wrote to the field. Setting it here lights the picture up
// everywhere at once: the item table, the drawer, the portal catalogue, the
// order screen.
router.post("/:id/image", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const { data } = z.object({ data: z.string().min(1) }).parse(req.body);
  const it = await prisma.item.findUnique({ where: { id: req.params.id } });
  if (!it) throw notFound("Item not found");
  const img = await storeItemImage(it.id, data);
  // Replacing: the old picture goes only once the new one is safely stored.
  if (it.imageUrl && it.imageUrl !== img.url) await removeItemImage(it.imageUrl);
  const updated = await prisma.item.update({ where: { id: it.id }, data: { imageUrl: img.url } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: it.imageUrl ? "Item photo replaced" : "Item photo added", entityType: "Item", entityId: it.sku, oldValue: it.imageUrl ?? "generated artwork", newValue: img.url });
  res.status(201).json({ imageUrl: updated.imageUrl, bytes: img.bytes });
}));

router.delete("/:id/image", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const it = await prisma.item.findUnique({ where: { id: req.params.id } });
  if (!it) throw notFound("Item not found");
  if (!it.imageUrl) throw badRequest("This item has no photograph — it is showing generated artwork");
  await prisma.item.update({ where: { id: it.id }, data: { imageUrl: null } });
  await removeItemImage(it.imageUrl);
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Item photo removed", entityType: "Item", entityId: it.sku, oldValue: it.imageUrl, newValue: "generated artwork" });
  res.status(204).send();
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
