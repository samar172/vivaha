import { M } from "@vivaha/shared";
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

router.get("/godowns", asyncHandler(async (_req, res) => res.json(await prisma.godown.findMany({ where: { isActive: true }, orderBy: { id: "asc" } }))));

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

router.get("/attributes", asyncHandler(async (_req, res) => res.json(await prisma.attributeDef.findMany({ orderBy: [{ lineId: "asc" }, { sortOrder: "asc" }] }))));
const attrSchema = z.object({ lineId: z.string().nullable().optional(), key: z.string().min(1), label: z.string().min(1), values: z.array(z.string()).default([]), multiSelect: z.boolean().default(false), portalFacet: z.boolean().default(false) });
router.post("/attributes", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = attrSchema.parse(req.body);
  const a = await prisma.attributeDef.create({ data: { ...b, lineId: b.lineId ?? null } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Attribute added", entityType: "Attribute", entityId: a.label, newValue: b.values.join(", ") });
  res.status(201).json(a);
}));
router.patch("/attributes/:id", requirePerm("settings.manage"), asyncHandler(async (req, res) => {
  const b = attrSchema.partial().parse(req.body);
  const before = await prisma.attributeDef.findUniqueOrThrow({ where: { id: req.params.id } });
  const a = await prisma.attributeDef.update({ where: { id: req.params.id }, data: { ...b, lineId: b.lineId === undefined ? undefined : b.lineId } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Attribute values changed", entityType: "Attribute", entityId: a.label, oldValue: (before.values as string[]).join(", "), newValue: (a.values as string[]).join(", ") });
  res.json(a);
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
