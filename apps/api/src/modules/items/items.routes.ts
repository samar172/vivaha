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

// A wedding card is not one picture. It opens — a double fold has a front and
// an inside, a trifold has three panels — and buyers choose on the inside
// artwork as much as the cover. Pages are stored in order; Item.imageUrl is
// kept in step with page one so every list, drawer and catalogue tile that
// already reads it carries on working without knowing the gallery exists.
async function syncCover(tx: typeof prisma, itemId: string) {
  const first = await tx.itemImage.findFirst({ where: { itemId }, orderBy: { sortOrder: "asc" } });
  await tx.item.update({ where: { id: itemId }, data: { imageUrl: first?.url ?? null } });
  return first?.url ?? null;
}

const gallery = (itemId: string) => prisma.itemImage.findMany({ where: { itemId }, orderBy: { sortOrder: "asc" } });

router.get("/:id/images", requirePerm("item.view"), asyncHandler(async (req, res) => {
  res.json(await gallery(req.params.id));
}));

// Adds a page. Kept at POST /:id/image, the path the single-photo upload used,
// so nothing that already calls it has to change.
router.post("/:id/image", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const { data, label } = z.object({ data: z.string().min(1), label: z.string().max(40).default("") }).parse(req.body);
  const it = await prisma.item.findUnique({ where: { id: req.params.id }, include: { images: true } });
  if (!it) throw notFound("Item not found");
  if (it.images.length >= 12) throw badRequest("Twelve pages is already more than any card has — remove one first");
  const img = await storeItemImage(it.id, data);
  if (it.images.some((x) => x.url === img.url)) throw badRequest("That is the same photograph as one already on this item");
  const next = it.images.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1;
  await prisma.itemImage.create({ data: { itemId: it.id, url: img.url, label: label.trim(), sortOrder: next, by: req.user!.name } });
  const cover = await syncCover(prisma, it.id);
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Item photo added", entityType: "Item", entityId: it.sku, oldValue: `${it.images.length} page(s)`, newValue: `${it.images.length + 1} page(s)${label ? " · " + label : ""}` });
  res.status(201).json({ imageUrl: cover, images: await gallery(it.id), bytes: img.bytes });
}));

router.patch("/:id/images/:imageId", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const b = z.object({ label: z.string().max(40).optional(), makeCover: z.boolean().optional() }).parse(req.body);
  const img = await prisma.itemImage.findUnique({ where: { id: req.params.imageId } });
  if (!img || img.itemId !== req.params.id) throw notFound("Photograph not found");
  if (b.label !== undefined) await prisma.itemImage.update({ where: { id: img.id }, data: { label: b.label.trim() } });
  if (b.makeCover) {
    // Promoting a page to the cover pushes it in front and closes the gap it
    // left, rather than leaving two pages claiming the same position.
    const rest = (await gallery(img.itemId)).filter((x) => x.id !== img.id);
    await prisma.$transaction([
      prisma.itemImage.update({ where: { id: img.id }, data: { sortOrder: 0 } }),
      ...rest.map((x, i) => prisma.itemImage.update({ where: { id: x.id }, data: { sortOrder: i + 1 } })),
    ]);
  }
  await syncCover(prisma, img.itemId);
  res.json(await gallery(img.itemId));
}));

router.delete("/:id/images/:imageId", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const img = await prisma.itemImage.findUnique({ where: { id: req.params.imageId }, include: { item: { select: { sku: true } } } });
  if (!img || img.itemId !== req.params.id) throw notFound("Photograph not found");
  await prisma.itemImage.delete({ where: { id: img.id } });
  // Close the gap so the remaining pages stay consecutively ordered.
  const rest = await gallery(img.itemId);
  await prisma.$transaction(rest.map((x, i) => prisma.itemImage.update({ where: { id: x.id }, data: { sortOrder: i } })));
  await syncCover(prisma, img.itemId);
  // Stored filenames carry a hash of the bytes, so two pages photographed from
  // the same image resolve to one file. Only unlink it once nothing else points
  // at it, or removing one page would blank another.
  const stillUsed = await prisma.itemImage.count({ where: { url: img.url } });
  if (stillUsed === 0) await removeItemImage(img.url);
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Item photo removed", entityType: "Item", entityId: img.item.sku, oldValue: img.label || img.url, newValue: `${rest.length} page(s) left` });
  res.json(await gallery(img.itemId));
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
