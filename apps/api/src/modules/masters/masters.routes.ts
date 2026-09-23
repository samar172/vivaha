import { M, RACK_SUB_SEP, locationCode } from "@vivaha/shared";
import { Router } from "express";
import { z } from "zod";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { audit } from "../../services/audit";
import { storeImage, removeImage } from "../../services/uploads";
import { badRequest, notFound } from "../../utils/httpError";
import { fyCode } from "../../services/sequence";

const router = Router();

router.get("/lines", asyncHandler(async (_req, res) => {
  const lines = await prisma.businessLine.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { items: true } } } });
  res.json(lines.map((l) => ({ ...l, itemCount: l._count.items })));
}));

const lineSchema = z.object({
  name: z.string().min(1).optional(), nameHi: z.string().optional(), icon: z.string().optional(), minSetQty: z.number().int().min(0).optional(),
  holdMins: z.number().int().min(0).optional(), gstPct: z.number().int().min(0).max(28).optional(), packUoms: z.array(z.string()).optional(),
  facets: z.array(z.string()).optional(), isActive: z.boolean().optional(),
  allowCustomPricing: z.boolean().optional(),
  priceListAnnual: z.boolean().optional(),
  // The invoice series for this line. The prefix is letters only — it becomes
  // part of a tax invoice number, which is printed and filed.
  invoicePrefix: z.string().regex(/^[A-Za-z]{1,6}$/, "Use one to six letters, e.g. VC or VFX").optional(),
  invoiceStart: z.number().int().min(1, "An invoice series starts at 1 or above").optional(),
});
router.patch("/lines/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const body = lineSchema.parse(req.body);
  const before = await prisma.businessLine.findUniqueOrThrow({ where: { id: req.params.id } });
  // The starting number only governs a series that has not begun. Once an
  // invoice has been raised on it, moving the start would re-issue numbers that
  // are already on documents, so it is refused rather than silently ignored.
  if (body.invoiceStart != null && body.invoiceStart !== before.invoiceStart) {
    const started = await prisma.sequence.findUnique({ where: { name: `INV-${before.id}-${fyCode()}` } });
    if (started) throw badRequest(M.seriesInUse(before.name, before.invoicePrefix, fyCode()));
  }
  const line = await prisma.businessLine.update({ where: { id: req.params.id }, data: { ...body, invoicePrefix: body.invoicePrefix?.toUpperCase() } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Business line updated", entityType: "Line", entityId: line.name, oldValue: JSON.stringify({ minSetQty: before.minSetQty, holdMins: before.holdMins, gstPct: before.gstPct }), newValue: JSON.stringify(body) });
  res.json(line);
}));

const newLineSchema = z.object({
  code: z.string().min(2), name: z.string().min(1), nameHi: z.string().default(""), icon: z.string().default("▦"), uom: z.string().min(1),
  packUoms: z.array(z.string()).default([]), minSetQty: z.number().int().min(0).default(0), holdMins: z.number().int().min(0).default(30),
  gstPct: z.number().int().min(0).max(28), batchTracked: z.boolean().default(false), pricingModel: z.enum(["SLAB", "AREA", "QUOTE"]).default("SLAB"),
  workflow: z.enum(["FULFIL", "JOBWORK"]).default("FULFIL"), facets: z.array(z.string()).default([]),
});
router.post("/lines", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = newLineSchema.parse(req.body);
  const n = await prisma.businessLine.count();
  const colors = [["#A81F52", "#FCEEF3"], ["#0E7490", "#ECFAFD"], ["#4338CA", "#EEF0FE"], ["#15803D", "#ECFDF3"], ["#B45309", "#FFFAEB"], ["#7C3AED", "#F3EEFF"]];
  const [color, bg] = colors[n % colors.length];
  const line = await prisma.businessLine.create({ data: { id: `L${n + 1}`, ...b, color, bg, stockDims: b.workflow === "JOBWORK" ? [] : b.batchTracked ? ["batch"] : ["design"], sortOrder: n + 1 } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Business line added", entityType: "Line", entityId: line.name, newValue: b.uom + " · " + b.pricingModel });
  res.status(201).json(line);
}));

router.get("/godowns", asyncHandler(async (_req, res) => res.json(await prisma.godown.findMany({
  where: { isActive: true },
  orderBy: { id: "asc" },
  include: { racks: {
    where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, subRacks: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true } } },
  } },
}))));

// ── Racks inside a godown ───────────────────────────────────────────────────
// A godown is a building and a rack is a shelf in it. They were the same thing
// until now — a "godown" per rack — which let the transfer screen move goods
// between two shelves of the same room as if they were separate premises. The
// rack list is the firm's own and is kept here, next to the godowns.
const rackSchema = z.object({
  code: z.string().trim().min(1, "A rack needs a number or a code").max(20),
  name: z.string().trim().max(60).default(""),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

router.post("/godowns/:id/racks", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = rackSchema.parse(req.body);
  const g = await prisma.godown.findUnique({ where: { id: req.params.id } });
  if (!g) throw notFound("Godown not found");
  const clash = await prisma.rack.findUnique({ where: { godownId_code: { godownId: g.id, code: b.code } } });
  if (clash) throw badRequest(`${g.short} already has a rack ${b.code}`);
  const rack = await prisma.rack.create({ data: { godownId: g.id, code: b.code, name: b.name, sortOrder: b.sortOrder ?? 0 } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Rack added", entityType: "Godown", entityId: g.name, newValue: `${b.code}${b.name ? " · " + b.name : ""}` });
  res.status(201).json(rack);
}));

router.patch("/racks/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = rackSchema.partial().parse(req.body);
  const before = await prisma.rack.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound("Rack not found");
  if (b.code && b.code !== before.code) {
    const clash = await prisma.rack.findUnique({ where: { godownId_code: { godownId: before.godownId, code: b.code } } });
    if (clash) throw badRequest(`That godown already has a rack ${b.code}`);
  }
  const rack = await prisma.rack.update({ where: { id: before.id }, data: b });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Rack changed", entityType: "Godown", entityId: before.godownId, oldValue: `${before.code}${before.name ? " · " + before.name : ""}${before.isActive ? "" : " · retired"}`, newValue: `${rack.code}${rack.name ? " · " + rack.name : ""}${rack.isActive ? "" : " · retired"}` });
  res.json(rack);
}));

// Retired rather than deleted: stock rows and the movement log name the rack by
// its code, and a shelf that held goods last season should still read back.
router.delete("/racks/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const before = await prisma.rack.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound("Rack not found");
  // The rack itself and every shelf on it: stock sits under "R-1" or "R-1/A".
  const held = await prisma.stockBalance.aggregate({
    where: { godownId: before.godownId, OR: [{ rack: before.code }, { rack: { startsWith: before.code + RACK_SUB_SEP } }] },
    _sum: { onHand: true },
  });
  if ((held._sum.onHand ?? 0) > 0) throw badRequest(`Rack ${before.code} still holds ${held._sum.onHand} units across itself and its shelves — move them off it first`);
  await prisma.rack.update({ where: { id: before.id }, data: { isActive: false } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Rack retired", entityType: "Godown", entityId: before.godownId, oldValue: before.code });
  res.json({ ok: true });
}));

// ── Shelves inside a rack ───────────────────────────────────────────────────
// One rack holds several, and the numbering is the firm's own — A/B/C on one
// rack, 1/2/3 on the next. It is a master rather than a free-typed box because
// typing it by hand at every receipt is how one shelf ends up written four ways.
router.post("/racks/:id/subracks", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = rackSchema.parse(req.body);
  if (b.code.includes(RACK_SUB_SEP)) throw badRequest(`A shelf code cannot contain "${RACK_SUB_SEP}" — that is what separates it from the rack`);
  const rack = await prisma.rack.findUnique({ where: { id: req.params.id } });
  if (!rack) throw notFound("Rack not found");
  const clash = await prisma.subRack.findUnique({ where: { rackId_code: { rackId: rack.id, code: b.code } } });
  if (clash) throw badRequest(`Rack ${rack.code} already has a shelf ${b.code}`);
  const sub = await prisma.subRack.create({ data: { rackId: rack.id, code: b.code, name: b.name, sortOrder: b.sortOrder ?? 0 } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Shelf added to a rack", entityType: "Godown", entityId: rack.godownId, newValue: `${locationCode(rack.code, b.code)}${b.name ? " · " + b.name : ""}` });
  res.status(201).json(sub);
}));

router.patch("/subracks/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = rackSchema.partial().parse(req.body);
  if (b.code?.includes(RACK_SUB_SEP)) throw badRequest(`A shelf code cannot contain "${RACK_SUB_SEP}"`);
  const before = await prisma.subRack.findUnique({ where: { id: req.params.id }, include: { rack: true } });
  if (!before) throw notFound("Shelf not found");
  if (b.code && b.code !== before.code) {
    const clash = await prisma.subRack.findUnique({ where: { rackId_code: { rackId: before.rackId, code: b.code } } });
    if (clash) throw badRequest(`Rack ${before.rack.code} already has a shelf ${b.code}`);
    // Renumbering a shelf that holds goods would leave the stock pointing at a
    // location nobody can walk to. Move the goods, then renumber it.
    const held = await prisma.stockBalance.aggregate({ where: { godownId: before.rack.godownId, rack: locationCode(before.rack.code, before.code) }, _sum: { onHand: true } });
    if ((held._sum.onHand ?? 0) > 0) throw badRequest(`Shelf ${locationCode(before.rack.code, before.code)} holds ${held._sum.onHand} units — move them off before renumbering it`);
  }
  const sub = await prisma.subRack.update({ where: { id: before.id }, data: b });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Shelf changed", entityType: "Godown", entityId: before.rack.godownId, oldValue: `${locationCode(before.rack.code, before.code)}${before.name ? " · " + before.name : ""}`, newValue: `${locationCode(before.rack.code, sub.code)}${sub.name ? " · " + sub.name : ""}` });
  res.json(sub);
}));

router.delete("/subracks/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const before = await prisma.subRack.findUnique({ where: { id: req.params.id }, include: { rack: true } });
  if (!before) throw notFound("Shelf not found");
  const code = locationCode(before.rack.code, before.code);
  const held = await prisma.stockBalance.aggregate({ where: { godownId: before.rack.godownId, rack: code }, _sum: { onHand: true } });
  if ((held._sum.onHand ?? 0) > 0) throw badRequest(`Shelf ${code} still holds ${held._sum.onHand} units — move them off it first`);
  await prisma.subRack.update({ where: { id: before.id }, data: { isActive: false } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Shelf retired", entityType: "Godown", entityId: before.rack.godownId, oldValue: code });
  res.json({ ok: true });
}));

router.get("/vendors", asyncHandler(async (_req, res) => {
  const vendors = await prisma.vendor.findMany({ orderBy: { id: "asc" }, include: { purchases: { select: { total: true, freight: true, date: true } }, payments: { select: { amount: true } } } });
  res.json(vendors.map((v) => {
    const invoiced = v.purchases.reduce((s, p) => s + D(p.total) + D(p.freight), 0);
    const paid = v.payments.reduce((s, p) => s + D(p.amount), 0);
    const oldest = v.purchases.length ? Math.max(...v.purchases.map((p) => Math.floor((Date.now() - p.date.getTime()) / 864e5))) : 0;
    return { id: v.id, name: v.name, gstin: v.gstin, terms: v.terms, city: v.city, phone: v.phone, documents: v.purchases.length, purchased: v.purchases.reduce((s, p) => s + D(p.total), 0), invoiced, paid, outstanding: invoiced - paid, oldestDays: oldest };
  }));
}));
const vendorSchema = z.object({ name: z.string().min(1), gstin: z.string().optional(), terms: z.string().default("Net 30"), city: z.string().default(""), phone: z.string().default("") });
router.post("/vendors", requirePerm("purchase.create"), asyncHandler(async (req, res) => {
  const b = vendorSchema.parse(req.body);
  const n = await prisma.vendor.count();
  const v = await prisma.vendor.create({ data: { id: `VND-${String(n + 1).padStart(2, "0")}`, ...b } });
  res.status(201).json(v);
}));

// A vendor's terms change, a GSTIN is corrected, a number moves. Editing one
// leaves every purchase document that names it alone: the documents carry their
// own figures, so correcting the vendor record never rewrites history.
router.patch("/vendors/:id", requirePerm("purchase.create"), asyncHandler(async (req, res) => {
  const b = vendorSchema.partial().parse(req.body);
  const before = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound("Vendor not found");
  if (b.name && b.name.trim() !== before.name) {
    const clash = await prisma.vendor.findFirst({ where: { name: { equals: b.name.trim(), mode: "insensitive" }, id: { not: before.id } } });
    if (clash) throw badRequest(`${clash.name} is already on file`);
  }
  const v = await prisma.vendor.update({ where: { id: before.id }, data: { ...b, ...(b.name ? { name: b.name.trim() } : {}) } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Vendor updated", entityType: "Vendor", entityId: v.id,
                        oldValue: `${before.name} · ${before.terms} · ${before.gstin ?? "no GSTIN"}`,
                        newValue: `${v.name} · ${v.terms} · ${v.gstin ?? "no GSTIN"}` });
  res.json(v);
}));

router.get("/pricing-groups", asyncHandler(async (_req, res) => {
  const g = await prisma.pricingGroup.findMany();
  res.json(g.map((x) => ({ name: x.name, multiplier: D(x.multiplier) })));
}));
router.put("/pricing-groups/:name", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const { multiplier } = z.object({ multiplier: z.number().min(0.5).max(3) }).parse(req.body);
  const before = await prisma.pricingGroup.findUnique({ where: { name: req.params.name } });
  const g = await prisma.pricingGroup.upsert({ where: { name: req.params.name }, create: { name: req.params.name, multiplier }, update: { multiplier } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Pricing multiplier updated", entityType: "Settings", entityId: req.params.name, oldValue: before ? "×" + D(before.multiplier) : "—", newValue: "×" + multiplier, reason: "Future orders only — historical orders keep their snapshot" });
  res.json({ name: g.name, multiplier: D(g.multiplier) });
}));

// How many records actually carry a value under this attribute.
//
// It is the question every edit here turns on: a key can be renamed while
// nothing uses it and not after, a value can be dropped from the list while no
// item is sitting on it and not after, and an attribute can be deleted while it
// is empty and not after. Counted rather than guessed, because "are you sure?"
// is not an answer when the machine can simply look.
async function attrUsage(a: { lineId: string | null; key: string }) {
  const items = await prisma.item.findMany({
    where: { ...(a.lineId ? { lineId: a.lineId } : {}) },
    select: { id: true, sku: true, attrs: true },
  });
  const used = items.filter((i) => {
    const v = (i.attrs as Record<string, unknown>)?.[a.key];
    return v !== undefined && v !== null && v !== "";
  });
  const byValue: Record<string, number> = {};
  for (const i of used) {
    const raw = (i.attrs as Record<string, unknown>)[a.key];
    for (const v of Array.isArray(raw) ? raw : [raw]) byValue[String(v)] = (byValue[String(v)] ?? 0) + 1;
  }
  return { count: used.length, byValue, examples: used.slice(0, 5).map((i) => i.sku) };
}

router.get("/attributes", asyncHandler(async (_req, res) => {
  const rows = await prisma.attributeDef.findMany({ orderBy: [{ lineId: "asc" }, { sortOrder: "asc" }] });
  // The screen needs the usage to know what it may offer; it is a handful of
  // rows against the item table, on a settings screen nobody opens in a loop.
  res.json(await Promise.all(rows.map(async (a) => ({ ...a, usage: await attrUsage(a) }))));
}));
const attrSchema = z.object({ lineId: z.string().nullable().optional(), key: z.string().min(1), label: z.string().min(1), values: z.array(z.string()).default([]), multiSelect: z.boolean().default(false), portalFacet: z.boolean().default(false) });
router.post("/attributes", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = attrSchema.parse(req.body);
  const a = await prisma.attributeDef.create({ data: { ...b, lineId: b.lineId ?? null } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Attribute added", entityType: "Attribute", entityId: a.label, newValue: b.values.join(", ") });
  res.status(201).json(a);
}));
// The whole attribute, not just its values.
//
// The label, the list, whether it takes more than one and whether the shop
// filters on it are all free to change — they are presentation, and nothing
// stored depends on them. The key and the line are different: every item that
// carries a value is filed under that key, on that line. They can be corrected
// while nothing uses the attribute, and are refused once something does, with
// the count and a few SKUs so the answer is checkable rather than a flat no.
router.patch("/attributes/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = attrSchema.partial().parse(req.body);
  const before = await prisma.attributeDef.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound("Attribute not found");
  const usage = await attrUsage(before);

  const movingKey = b.key !== undefined && b.key !== before.key;
  const movingLine = b.lineId !== undefined && (b.lineId ?? null) !== before.lineId;
  if ((movingKey || movingLine) && usage.count > 0) {
    throw badRequest(`${usage.count} item${usage.count === 1 ? " is" : "s are"} already filed under "${before.key}"${usage.examples.length ? ` (${usage.examples.join(", ")}${usage.count > usage.examples.length ? "…" : ""})` : ""}. The ${movingKey ? "key" : "line"} is what they are filed by, so it cannot move while they are. Clear those values, or add a new attribute alongside this one.`);
  }
  if (movingKey || movingLine) {
    const clash = await prisma.attributeDef.findFirst({
      where: { lineId: movingLine ? (b.lineId ?? null) : before.lineId, key: b.key ?? before.key, NOT: { id: before.id } },
    });
    if (clash) throw badRequest(`"${clash.label}" already uses the key ${b.key ?? before.key} on that line`);
  }

  // A value cannot be taken off the list while an item is sitting on it — the
  // item would keep a value the master no longer offers, which is how a
  // catalogue filter quietly stops matching its own stock.
  if (b.values) {
    const dropped = (before.values as string[]).filter((v) => !b.values!.includes(v));
    const stillUsed = dropped.filter((v) => (usage.byValue[v] ?? 0) > 0);
    if (stillUsed.length) {
      throw badRequest(`${stillUsed.map((v) => `${v} (${usage.byValue[v]})`).join(", ")} ${stillUsed.length === 1 ? "is" : "are"} still set on items. Change those items first, then remove the value.`);
    }
  }

  const a = await prisma.attributeDef.update({
    where: { id: before.id },
    data: { ...b, lineId: b.lineId === undefined ? undefined : (b.lineId || null) },
  });
  const show = (x: { key: string; label: string; values: unknown; multiSelect: boolean; portalFacet: boolean }) =>
    `${x.label} (${x.key}) · ${(x.values as string[]).join(", ")}${x.multiSelect ? " · multi" : ""}${x.portalFacet ? " · facet" : ""}`;
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Attribute changed", entityType: "Attribute", entityId: a.label, oldValue: show(before), newValue: show(a) });
  res.json({ ...a, usage: await attrUsage(a) });
}));

// Deleted only while nothing is filed under it. An attribute that items carry
// values for is not a spare row — removing it would leave those values
// unreadable on every screen that renders the master's label.
router.delete("/attributes/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const before = await prisma.attributeDef.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound("Attribute not found");
  if (before.key === "tehsil" && !before.lineId) throw badRequest("Tehsil is the list every customer's address is picked from — it cannot be removed, only edited");
  const usage = await attrUsage(before);
  if (usage.count > 0) throw badRequest(`${usage.count} item${usage.count === 1 ? " carries" : "s carry"} a value under "${before.key}"${usage.examples.length ? ` (${usage.examples.join(", ")}${usage.count > usage.examples.length ? "…" : ""})` : ""} — clear those first.`);
  await prisma.attributeDef.delete({ where: { id: before.id } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Attribute removed", entityType: "Attribute", entityId: before.label, oldValue: `${before.label} (${before.key})` });
  res.json({ ok: true });
}));

router.get("/tehsils", asyncHandler(async (_req, res) => {
  const a = await prisma.attributeDef.findFirst({ where: { key: "tehsil", lineId: null } });
  res.json((a?.values as string[]) ?? []);
}));

router.get("/sales-execs", asyncHandler(async (_req, res) => {
  res.json(await prisma.user.findMany({ where: { role: { in: ["SALES_EXECUTIVE", "SUPER_ADMIN"] }, isActive: true }, select: { id: true, name: true, role: true } }));
}));

export default router;

// ── Portal banners ──────────────────────────────────────────────────────────
// What the firm sees above the catalogue. The Ad row has always existed and the
// portal has always rendered one; it was seeded-only and text-only. The office
// writes them now, with a picture, because a retailer buys a card by looking at
// it. Same model, same slot — a picture and a few controls added to it.

const adSchema = z.object({
  title: z.string().min(1, "A banner needs a line of text"),
  sub: z.string().default(""),
  lineId: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  target: z.record(z.string()).optional(),
});

router.get("/ads", requirePerm("settings.manage"), asyncHandler(async (_req, res) => {
  const rows = await prisma.ad.findMany({
    include: { line: { select: { id: true, name: true } }, item: { select: { id: true, sku: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  res.json(rows);
}));

router.post("/ads", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = adSchema.parse(req.body);
  const ad = await prisma.ad.create({ data: {
    title: b.title, sub: b.sub, lineId: b.lineId || null, itemId: b.itemId || null,
    startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null,
    isActive: b.isActive, sortOrder: b.sortOrder, target: b.target ?? {},
  } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Banner created", entityType: "Ad", entityId: ad.title });
  res.status(201).json(ad);
}));

router.patch("/ads/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = adSchema.partial().parse(req.body);
  const before = await prisma.ad.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound("Banner not found");
  const ad = await prisma.ad.update({ where: { id: before.id }, data: {
    ...b,
    lineId: b.lineId === undefined ? undefined : b.lineId || null,
    itemId: b.itemId === undefined ? undefined : b.itemId || null,
    startsAt: b.startsAt === undefined ? undefined : b.startsAt ? new Date(b.startsAt) : null,
    endsAt: b.endsAt === undefined ? undefined : b.endsAt ? new Date(b.endsAt) : null,
  } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Banner updated", entityType: "Ad", entityId: ad.title, oldValue: before.isActive ? "live" : "off", newValue: ad.isActive ? "live" : "off" });
  res.json(ad);
}));

// The picture, on the same path item photographs take: a data URL on a JSON
// body, Cloudinary when it is configured and local disk when it is not.
router.post("/ads/:id/image", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const { data } = z.object({ data: z.string().min(1) }).parse(req.body);
  const ad = await prisma.ad.findUnique({ where: { id: req.params.id } });
  if (!ad) throw notFound("Banner not found");
  const img = await storeImage("banners", ad.id, data);
  if (ad.imageUrl && ad.imageUrl !== img.url) await removeImage(ad.imageUrl);
  const updated = await prisma.ad.update({ where: { id: ad.id }, data: { imageUrl: img.url } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: ad.imageUrl ? "Banner image replaced" : "Banner image added", entityType: "Ad", entityId: ad.title });
  res.status(201).json({ imageUrl: updated.imageUrl, bytes: img.bytes });
}));

router.delete("/ads/:id/image", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const ad = await prisma.ad.findUnique({ where: { id: req.params.id } });
  if (!ad) throw notFound("Banner not found");
  if (!ad.imageUrl) throw badRequest("This banner has no picture");
  await prisma.ad.update({ where: { id: ad.id }, data: { imageUrl: null } });
  await removeImage(ad.imageUrl);
  res.status(204).send();
}));

router.delete("/ads/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const ad = await prisma.ad.findUnique({ where: { id: req.params.id } });
  if (!ad) throw notFound("Banner not found");
  await prisma.ad.delete({ where: { id: ad.id } });
  await removeImage(ad.imageUrl);
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Banner removed", entityType: "Ad", entityId: ad.title, oldValue: `${ad.impressions} shown · ${ad.taps} tapped` });
  res.status(204).send();
}));
