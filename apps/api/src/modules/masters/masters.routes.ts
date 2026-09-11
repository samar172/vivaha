import { Router } from "express";
import { z } from "zod";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { audit } from "../../services/audit";
import { badRequest } from "../../utils/httpError";
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
    if (started) throw badRequest(`${before.name} has already billed on ${before.invoicePrefix}/${fyCode()} — the starting number cannot move once a series is in use. It applies to the next financial year.`);
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
