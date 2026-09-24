import { M, marginFloor, paise } from "@vivaha/shared";
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { loadItemViews, loadItemView } from "../../services/items";
import { audit } from "../../services/audit";
import { notFound, badRequest, forbidden } from "../../utils/httpError";
import { getMinMargin } from "../../services/settings";
import { fyCode } from "../../services/sequence";
import { storeItemImage, removeItemImage } from "../../services/uploads";
import { applyDuePriceChanges } from "../../jobs/priceChanges";

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
// ── The price list ──────────────────────────────────────────────────────────
// One screen for what everything sells at, which is a different question from
// what any one item is. The office thinks in a chain: what the supplier charges,
// the markup on top, and the figure that comes out — so that is what this
// returns, per item, with whatever change is already queued against it.
//
// The purchase price is the supplier's own rate before freight. Landed cost is
// not the same number and is not offered here: it carries freight, it moves on
// its own with every receipt, and it exists to hold the margin floor, not to
// price from.
router.get("/price-list", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const q = z.object({ line: z.string().optional(), q: z.string().optional() }).parse(req.query);
  const items = await prisma.item.findMany({
    where: {
      ...(q.line && q.line !== "ALL" ? { lineId: q.line } : {}),
      ...(q.q ? { OR: [
        { name: { contains: q.q, mode: "insensitive" } },
        { designNo: { contains: q.q, mode: "insensitive" } },
        { sku: { contains: q.q, mode: "insensitive" } },
        { codes: { some: { code: { contains: q.q, mode: "insensitive" } } } },
      ] } : {}),
    },
    include: {
      slabs: { orderBy: { fromQty: "asc" } },
      line: { select: { id: true, name: true, uom: true } },
      vendor: { select: { id: true, name: true, code: true } },
      codes: { where: { status: "ACTIVE" }, select: { code: true, kind: true } },
      priceChanges: { where: { status: "PENDING" }, orderBy: { effectiveFrom: "asc" } },
    },
    orderBy: [{ lineId: "asc" }, { name: "asc" }],
  });
  const groups = await prisma.pricingGroup.findMany();
  // What the table illustrates the final figure with when an item has no
  // multiplier of its own. Named on the screen so the number is never unexplained.
  const base = groups.find((g) => g.name === "Regular") ?? groups[0];

  res.json({
    baseGroup: base ? { name: base.name, multiplier: D(base.multiplier) } : { name: "Regular", multiplier: 1.25 },
    items: items.map((i) => {
      const own = i.codes.find((c) => c.kind === "OWN")?.code ?? i.codes[0]?.code ?? null;
      const slabs = i.slabs.map((s) => ({ fromQty: s.fromQty, toQty: s.toQty, rate: D(s.rate) }));
      const pend = i.priceChanges[0];
      return {
        id: i.id, sku: i.sku, ref: (own || i.designNo || "").trim(), name: i.name, status: i.status,
        lineId: i.lineId, lineName: i.line.name, uom: i.uom, moq: i.moq,
        vendor: i.vendor, purchasePrice: i.purchasePrice == null ? null : D(i.purchasePrice),
        landedCost: D(i.landedCost),
        priceBasis: i.priceBasis, manualBase: i.manualBase == null ? null : D(i.manualBase),
        multiplier: i.multiplier == null ? null : D(i.multiplier),
        slabs, sellingPrice: slabs[0]?.rate ?? 0,
        pending: pend ? {
          id: pend.id, effectiveFrom: pend.effectiveFrom, reason: pend.reason, by: pend.by,
          purchasePrice: pend.purchasePrice == null ? null : D(pend.purchasePrice),
          multiplier: pend.multiplier == null ? null : D(pend.multiplier),
          priceBasis: pend.priceBasis, manualBase: pend.manualBase == null ? null : D(pend.manualBase),
          sellingPrice: ((pend.slabs as unknown as { rate: number }[]) ?? [])[0]?.rate ?? null,
        } : null,
      };
    }),
  });
}));

// Saving a price list. One date for the batch, because that is how a list is
// agreed; a date today or in the past is applied on the spot, a future one
// waits for the sweeper.
const priceRow = z.object({
  itemId: z.string(),
  purchasePrice: z.number().min(0).nullable().optional(),
  multiplier: z.number().min(0.1).max(20).nullable().optional(),
  // What the multiplier was applied to, kept so next season starts where this
  // one left off instead of asking again.
  priceBasis: z.enum(["PURCHASE", "LANDED", "CURRENT", "MANUAL"]).optional(),
  manualBase: z.number().min(0).nullable().optional(),
  sellingPrice: z.number().min(0, "A selling price cannot be negative"),
});
router.post("/price-list", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const b = z.object({
    effectiveFrom: z.string(),
    reason: z.string().trim().max(200).default(""),
    rows: z.array(priceRow).min(1, "Nothing to save"),
  }).parse(req.body);
  const from = new Date(b.effectiveFrom);
  if (Number.isNaN(from.getTime())) throw badRequest("That effective date is not a date");

  const items = await prisma.item.findMany({
    where: { id: { in: b.rows.map((r) => r.itemId) } },
    include: { slabs: { orderBy: { fromQty: "asc" } }, line: { select: { priceListAnnual: true, name: true } } },
  });
  if (items.length !== new Set(b.rows.map((r) => r.itemId)).size) throw badRequest("One of the items is not on file");

  const minMargin = await getMinMargin();
  const canOverride = req.user!.perms.includes("margin.override");
  for (const r of b.rows) {
    const it = items.find((x) => x.id === r.itemId)!;
    // The same floor the pricing engine holds. Pricing a whole list under it is
    // exactly the mistake a bulk screen makes easy, so it is checked per row.
    const floor = marginFloor(D(it.landedCost), minMargin);
    if (r.sellingPrice > 0 && r.sellingPrice < floor && !canOverride) {
      throw forbidden(`${it.name} at ₹${r.sellingPrice.toFixed(2)} is below its margin floor of ₹${floor.toFixed(2)}. That needs margin.override.`);
    }
  }

  const immediate = from.getTime() <= Date.now();
  const made = await prisma.$transaction(async (tx) => {
    const out: string[] = [];
    for (const r of b.rows) {
      const it = items.find((x) => x.id === r.itemId)!;
      // Deeper slabs keep the shape this catalogue has always used, derived to
      // the paisa from the figure the office typed.
      const base = r.sellingPrice;
      const slabs = it.slabs.length >= 4
        ? [
          { fromQty: it.slabs[0].fromQty, toQty: it.slabs[0].toQty, rate: paise(base) },
          { fromQty: it.slabs[1].fromQty, toQty: it.slabs[1].toQty, rate: paise(base * 0.89) },
          { fromQty: it.slabs[2].fromQty, toQty: it.slabs[2].toQty, rate: paise(base * 0.8) },
          { fromQty: it.slabs[3].fromQty, toQty: it.slabs[3].toQty, rate: paise(base * 0.74) },
        ]
        : [{ fromQty: 1, toQty: 499, rate: paise(base) }, { fromQty: 500, toQty: 1999, rate: paise(base * 0.89) },
          { fromQty: 2000, toQty: 4999, rate: paise(base * 0.8) }, { fromQty: 5000, toQty: 1e9, rate: paise(base * 0.74) }];

      // A second change queued for the same item and date replaces the first,
      // rather than both landing and the later one silently winning.
      await tx.priceChange.updateMany({
        where: { itemId: r.itemId, status: "PENDING", effectiveFrom: from },
        data: { status: "CANCELLED" },
      });
      const ch = await tx.priceChange.create({ data: {
        itemId: r.itemId, effectiveFrom: from,
        purchasePrice: r.purchasePrice ?? null,
        multiplier: r.multiplier ?? null,
        priceBasis: r.priceBasis ?? null,
        manualBase: r.manualBase ?? null,
        slabs: slabs as unknown as Prisma.InputJsonValue,
        reason: b.reason, by: req.user!.name,
      } });
      out.push(ch.id);
    }
    await audit(tx, {
      userId: req.user!.id, actor: req.user!.name,
      action: immediate ? "Price list updated" : "Price list scheduled",
      entityType: "Item", entityId: `${b.rows.length} item${b.rows.length === 1 ? "" : "s"}`,
      newValue: `effective ${from.toISOString().slice(0, 10)}`, reason: b.reason,
    });
    return out;
  });

  // A list dated today takes effect now rather than on the sweeper's next pass:
  // somebody pressed save and expects the catalogue to read differently.
  const applied = immediate ? await applyDuePriceChanges() : 0;
  res.status(201).json({ scheduled: made.length, applied, effectiveFrom: from, immediate });
}));

// A change that has not landed yet can simply be called off.
router.delete("/price-changes/:id", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const ch = await prisma.priceChange.findUnique({ where: { id: req.params.id }, include: { item: { select: { sku: true, name: true } } } });
  if (!ch) throw notFound("That price change is not on file");
  if (ch.status !== "PENDING") throw badRequest(`This change has already been ${ch.status.toLowerCase()} — a price that is in force is changed by setting a new one.`);
  await prisma.priceChange.update({ where: { id: ch.id }, data: { status: "CANCELLED" } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Scheduled price change cancelled", entityType: "Item", entityId: ch.item.sku, oldValue: `effective ${ch.effectiveFrom.toISOString().slice(0, 10)}` });
  res.json({ ok: true });
}));

router.get("/:id/price-history", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const rows = await prisma.itemPriceHistory.findMany({ where: { itemId: req.params.id }, orderBy: { at: "desc" }, take: 50 });
  res.json(rows.map((r) => {
    const oldV = D(r.oldValue), newV = D(r.newValue);
    return { id: r.id, field: r.field, oldValue: oldV, newValue: newV, change: newV - oldV, pct: oldV ? ((newV - oldV) / oldV) * 100 : 0, by: r.by, reason: r.reason, at: r.at };
  }));
}));

// Everything that ever happened to one item, the way a Tally ledger reads.
//
// The item screen shows the last dozen stock movements, which answers "what
// happened recently" and not "when did we last buy this, from whom, at what,
// and who has been buying it". That is the question somebody standing at the
// counter with a customer actually has, so it is one page: bought and sold,
// oldest first, with a running quantity.
//
// Everything is read from records that already exist — goods receipts, invoice
// lines, the movement log — so nothing here can disagree with the documents.
router.get("/:id/ledger", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const q = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const item = await prisma.item.findUnique({ where: { id: req.params.id }, select: { id: true, sku: true, name: true, uom: true, designNo: true, landedCost: true, purchasePrice: true } });
  if (!item) throw notFound(M.itemNotFound());
  const since = q.from ? new Date(q.from) : undefined;
  const until = q.to ? new Date(q.to + "T23:59:59") : undefined;
  const window = since || until ? { gte: since, lte: until } : undefined;

  const [purchases, sales, moves] = await Promise.all([
    prisma.purchaseLine.findMany({
      where: { itemId: item.id, purchase: { ...(window ? { date: window } : {}) } },
      include: { purchase: { select: { id: true, invNo: true, date: true, status: true, vendor: { select: { id: true, name: true, code: true } } } } },
    }),
    prisma.invoiceLine.findMany({
      where: { itemId: item.id, jobId: null, invoice: { ...(window ? { date: window } : {}) } },
      include: { invoice: { select: { no: true, date: true, status: true, customer: { select: { id: true, name: true, code: true } } } } },
    }),
    // Everything that was not a sale or a purchase — damage, transfers, job
    // work drawing base cards — so the quantity column actually reconciles.
    prisma.stockTxn.findMany({
      where: { itemId: item.id, type: { notIn: ["GRN", "DISPATCH", "HOLD", "HOLD_RELEASE", "RESERVE", "RESERVE_RELEASE"] }, ...(window ? { at: window } : {}) },
      orderBy: { at: "asc" },
    }),
  ]);

  type Row = {
    kind: "PURCHASE" | "SALE" | "MOVE"; at: Date; ref: string; doc: string;
    party: { id: string; name: string; code: string | null } | null;
    inQty: number; outQty: number; rate: number | null; value: number | null; note: string;
  };
  const rows: Row[] = [
    ...purchases.map((l) => ({
      kind: "PURCHASE" as const, at: l.purchase.date, ref: l.purchase.invNo, doc: l.purchase.id,
      party: l.purchase.vendor, inQty: l.qty, outQty: 0, rate: D(l.rate), value: Math.round(l.qty * D(l.rate) * 100) / 100,
      note: l.purchase.status === "IN_TRANSIT" ? "in transit — not landed yet" : "",
    })),
    ...sales.map((l) => ({
      kind: "SALE" as const, at: l.invoice.date, ref: l.invoice.no, doc: l.invoice.no,
      party: l.invoice.customer, inQty: 0, outQty: l.qty, rate: D(l.rate), value: D(l.amount),
      note: l.invoice.status === "Posted" ? "" : l.invoice.status.toLowerCase(),
    })),
    ...moves.map((m) => ({
      kind: "MOVE" as const, at: m.at, ref: m.ref ?? m.type, doc: m.ref ?? "",
      party: null,
      inQty: ["TRANSFER_IN", "RETURN_IN", "RECOVER"].includes(m.type) ? m.qty : 0,
      outQty: ["TRANSFER_OUT", "DAMAGE", "WRITE_OFF", "QUARANTINE"].includes(m.type) ? m.qty : 0,
      rate: null, value: null,
      note: `${m.type.toLowerCase().replace(/_/g, " ")}${m.godownId ? " · " + m.godownId : ""}${m.rack && m.rack !== "-" ? "/" + m.rack : ""}${m.reason ? " · " + m.reason : ""}`,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  let bal = 0;
  const ledger = rows.map((r) => { bal += r.inQty - r.outQty; return { ...r, balance: bal }; });

  const bought = purchases.reduce((t, l) => t + l.qty, 0);
  const sold = sales.reduce((t, l) => t + l.qty, 0);
  const spend = purchases.reduce((t, l) => t + l.qty * D(l.rate), 0);
  const take = sales.reduce((t, l) => t + D(l.amount), 0);
  res.json({
    item: { ...item, landedCost: D(item.landedCost), purchasePrice: item.purchasePrice == null ? null : D(item.purchasePrice) },
    ledger,
    summary: {
      bought, sold, spend: Math.round(spend * 100) / 100, take: Math.round(take * 100) / 100,
      avgBuy: bought ? Math.round((spend / bought) * 100) / 100 : null,
      avgSell: sold ? Math.round((take / sold) * 100) / 100 : null,
      vendors: [...new Map(purchases.filter((l) => l.purchase.vendor).map((l) => [l.purchase.vendor.id, l.purchase.vendor])).values()],
      customers: [...new Map(sales.map((l) => [l.invoice.customer.id, l.invoice.customer])).values()].length,
    },
  });
}));

router.get("/:id", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const v = await loadItemView(req.params.id);
  if (!v) throw notFound(M.itemNotFound());
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
  // The item's own markup, replacing the buying firm's group multiplier. Null
  // or absent means the group decides, which is the normal case.
  multiplier: z.number().min(0.1, "A multiplier below 0.1 would price the item at a tenth of its slab").max(20, "That is not a multiplier").nullable().optional(),
  batchTracked: z.boolean().default(false), wastagePct: z.number().optional(), setupCharge: z.number().optional(), slabs: z.array(slab).min(1), status: z.enum(["ACTIVE", "DISCONTINUED"]).default("ACTIVE"),
});

router.post("/", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const b = itemSchema.parse(req.body);
  const line = await prisma.businessLine.findUnique({ where: { id: b.lineId } });
  if (!line) throw badRequest("Unknown business line");
  const prefix = { cards: "WC", consumables: "CN", signage: "SG", acp: "AC", jobwork: "JW" }[line.code] ?? line.code.slice(0, 2).toUpperCase();
  const count = await prisma.item.count({ where: { lineId: line.id } });
  // The number is spaced out so codes do not read as a strict serial — but it
  // used to be spaced out with a random jump of 0 to 2, which collides with an
  // already-issued code often enough that creating an item on a well-stocked
  // line failed outright. SKU is unique, so a clash was a 500 and the office
  // lost the form. Now the first free number from that point is taken.
  const taken = new Set((await prisma.item.findMany({ where: { sku: { startsWith: prefix + "-" } }, select: { sku: true } })).map((x) => x.sku));
  let sku = "";
  for (let n = 1000 + count * 3; !sku; n++) if (!taken.has(`${prefix}-${n}`)) sku = `${prefix}-${n}`;
  const id = `ITM-${Date.now().toString(36).toUpperCase()}`;
  const item = await prisma.item.create({
    data: { id, sku, designNo: b.designNo || null, name: b.name, nameHi: b.nameHi, lineId: b.lineId, attrs: b.attrs, uom: b.uom, packUom: b.packUom, perPack: b.perPack, moq: b.moq, landedCost: b.landedCost, multiplier: b.multiplier ?? null, hsn: b.hsn, gstPct: b.gstPct, vendorId: b.vendorId ?? null, season: b.season ?? null, batchTracked: b.batchTracked, wastagePct: b.wastagePct ?? null, setupCharge: b.setupCharge ?? null, artSeed: count, status: b.status, slabs: { create: b.slabs } },
  });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Item created", entityType: "Item", entityId: item.sku, newValue: b.name });
  res.status(201).json(await loadItemView(item.id));
}));

router.patch("/:id", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const b = itemSchema.partial().parse(req.body);
  const before = await prisma.item.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound(M.itemNotFound());
  const { slabs, ...rest } = b;
  const beforeSlabs = await prisma.priceSlab.findMany({ where: { itemId: before.id }, orderBy: { fromQty: "asc" } });

  // Cards run on the manufacturer's list, published once and standing for the
  // whole financial year. Changing a rate inside that year is a revision of a
  // published list — retailers have been quoting it since April — so it is
  // allowed, because costs do move, but never silently: it needs a reason and
  // it is marked as a revision. A first edit in a new financial year is simply
  // the new list and needs nothing.
  const fy = fyCode();
  const reason = (req.body as { reason?: string }).reason?.trim() ?? "";
  const line = await prisma.businessLine.findUniqueOrThrow({ where: { id: before.lineId } });
  const slabsChanged = !!slabs && JSON.stringify(slabs.map((x) => [x.fromQty, x.toQty, x.rate])) !== JSON.stringify(beforeSlabs.map((x) => [x.fromQty, x.toQty, D(x.rate)]));
  const midYearRevision = slabsChanged && line.priceListAnnual && before.priceListFy === fy;
  if (midYearRevision && !reason) throw badRequest(M.annualListRevision(line.name, fy));
  await prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id: before.id }, data: { ...rest, vendorId: rest.vendorId === undefined ? undefined : rest.vendorId, ...(slabsChanged ? { priceListFy: fy } : {}) } });
    if (slabs) { await tx.priceSlab.deleteMany({ where: { itemId: before.id } }); await tx.priceSlab.createMany({ data: slabs.map((s) => ({ ...s, itemId: before.id })) }); }

    // "Why is this dearer than last season" needs an answer with a name and a
    // date on it. The audit log carries the same facts as prose; this is the
    // shape a screen can chart. Only actual movements are written.
    const hist: { field: string; oldValue: number; newValue: number }[] = [];
    const oldBase = beforeSlabs[0] ? D(beforeSlabs[0].rate) : null;
    const newBase = slabs?.[0]?.rate ?? null;
    if (oldBase != null && newBase != null && oldBase !== newBase) hist.push({ field: "slab1", oldValue: oldBase, newValue: newBase });
    if (rest.landedCost != null && D(before.landedCost) !== rest.landedCost) hist.push({ field: "landedCost", oldValue: D(before.landedCost), newValue: rest.landedCost });
    if (hist.length) await tx.itemPriceHistory.createMany({ data: hist.map((h) => ({ ...h, itemId: before.id, by: req.user!.name, reason: midYearRevision ? `Mid-year revision of the ${fy} list — ${reason}` : reason })) });

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
  if (!it) throw notFound(M.itemNotFound());
  if (it.images.length >= 12) throw badRequest(M.tooManyPages());
  const img = await storeItemImage(it.id, data);
  if (it.images.some((x) => x.url === img.url)) throw badRequest(M.samePhoto());
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
