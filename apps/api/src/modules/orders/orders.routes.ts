import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ORDER_ACTIVE, ORDER_CLOSED, ORDER_SHIPPED, ORDER_DISPATCH_QUEUE, type OrderStatus } from "@vivaha/shared";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { gatesForAll, gateFor } from "../../services/credit";
import { audit } from "../../services/audit";
import { getCompany, getSetting } from "../../services/settings";
import * as svc from "./orders.service";

const router = Router();
const actor = (req: { user?: { id: string; name: string; role: string; perms: string[] } }) => req.user!;
const TABS: Record<string, OrderStatus[] | null> = { all: null, approve: ["BOOKED"], active: ORDER_ACTIVE, shipped: ORDER_SHIPPED, closed: ORDER_CLOSED, dispatch: ORDER_DISPATCH_QUEUE };

router.get("/", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const q = z.object({ tab: z.string().default("all"), line: z.string().optional(), q: z.string().optional(), customerId: z.string().optional() }).parse(req.query);
  const set = TABS[q.tab] ?? null;
  const where: Prisma.OrderWhereInput = {
    ...(set ? { status: { in: set } } : {}),
    ...(q.line && q.line !== "ALL" ? { lines: { some: { lineId: q.line } } } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.q ? { OR: [{ id: { contains: q.q, mode: "insensitive" } }, { customer: { name: { contains: q.q, mode: "insensitive" } } }] } : {}),
  };
  const rows = await prisma.order.findMany({ where, include: svc.orderInclude, orderBy: q.tab === "approve" ? [{ holdUntil: "asc" }, { createdAt: "asc" }] : { createdAt: "desc" } });
  const gates = await gatesForAll([...new Map(rows.map((r) => [r.customer.id, r.customer])).values()]);
  const counts: Record<string, number> = {};
  for (const k of Object.keys(TABS)) counts[k] = await prisma.order.count({ where: { ...(TABS[k] ? { status: { in: TABS[k]! } } : {}), ...(q.line && q.line !== "ALL" ? { lines: { some: { lineId: q.line } } } : {}) } });
  res.json({ orders: rows.map((o) => ({ ...svc.serializeOrder(o), gate: gates[o.customer.id].gate })), counts });
}));

const newOrderBody = z.object({
  customerId: z.string(),
  lines: z.array(z.object({ itemId: z.string(), qty: z.number().int() })).default([]),
  requiredBy: z.string().optional(),
  note: z.string().optional(),
  overrideReason: z.string().optional(),
});

// Priced preview for the office booking screen. Writes nothing — the modal
// calls it on every change so the rate, the credit gate and any shortfall are
// the server's answer, not the browser's guess.
router.post("/quote", requirePerm("order.create"), asyncHandler(async (req, res) => {
  const b = newOrderBody.parse(req.body);
  res.json(await svc.quoteOrder({ customerId: b.customerId, lines: b.lines }));
}));

// The catalogue the office picks from, priced for the firm that is buying.
router.get("/catalogue", requirePerm("order.create"), asyncHandler(async (req, res) => {
  const q = z.object({ customerId: z.string(), line: z.string().optional(), q: z.string().optional() }).parse(req.query);
  res.json(await svc.orderCatalogue(q.customerId, q.line, q.q));
}));

// The office sees what firms left in their baskets — same Cart rows the portal
// writes, nothing new stored.
router.get("/abandoned-carts", requirePerm("order.create"), asyncHandler(async (_req, res) => {
  res.json(await svc.abandonedCarts());
}));

router.post("/", requirePerm("order.create"), asyncHandler(async (req, res) => {
  const b = newOrderBody.parse(req.body);
  const o = await svc.createOrder(b, actor(req));
  res.status(201).json(svc.serializeOrder(o));
}));

router.get("/:id", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const o = await svc.getOrder(prisma, req.params.id);
  const [gate, company] = await Promise.all([gateFor(o.customer, D(o.total)), getCompany()]);
  res.json({ ...svc.serializeOrder(o), gate, company });
}));

router.post("/:id/approve", requirePerm("order.approve"), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
  await svc.approve(await svc.getOrder(prisma, req.params.id), actor(req), reason ?? null);
  res.json(svc.serializeOrder(await svc.getOrder(prisma, req.params.id)));
}));
router.post("/bulk-approve", requirePerm("order.approve"), asyncHandler(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body);
  let n = 0, skip = 0;
  for (const id of ids) {
    const o = await prisma.order.findUnique({ where: { id }, include: svc.orderInclude });
    if (!o || o.status !== "BOOKED") continue;
    const g = await gateFor(o.customer, D(o.total));
    if (g.restricted) { skip++; continue; }
    await svc.approve(o, actor(req), null); n++;
  }
  res.json({ approved: n, skipped: skip });
}));
router.post("/:id/reject", requirePerm("order.approve"), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3, "A reason is required") }).parse(req.body);
  await svc.reject(await svc.getOrder(prisma, req.params.id), actor(req), reason);
  res.json({ ok: true });
}));
router.post("/:id/reserve", requirePerm("order.approve", "order.allocate"), asyncHandler(async (req, res) => {
  await svc.reserve(await svc.getOrder(prisma, req.params.id), actor(req));
  res.json(svc.serializeOrder(await svc.getOrder(prisma, req.params.id)));
}));
router.post("/:id/allocate", requirePerm("order.allocate"), asyncHandler(async (req, res) => {
  const { alloc } = z.object({ alloc: z.record(z.record(z.number().int().min(0))) }).parse(req.body);
  await svc.allocate(await svc.getOrder(prisma, req.params.id), actor(req), alloc);
  res.json(svc.serializeOrder(await svc.getOrder(prisma, req.params.id)));
}));
router.post("/:id/status", requirePerm("order.pick", "order.dispatch"), asyncHandler(async (req, res) => {
  const { to } = z.object({ to: z.enum(["PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH", "DELIVERED"]) }).parse(req.body);
  await svc.advance(await svc.getOrder(prisma, req.params.id), actor(req), to);
  res.json(svc.serializeOrder(await svc.getOrder(prisma, req.params.id)));
}));
router.post("/:id/dispatch", requirePerm("order.dispatch"), asyncHandler(async (req, res) => {
  const b = z.object({ ship: z.record(z.number().int().min(0)), transporter: z.string().min(1), lr: z.string().min(1), tracking: z.string().optional(), packages: z.number().int().min(1).optional(), freight: z.number().min(0).optional(), ewb: z.string().optional() }).parse(req.body);
  const r = await svc.dispatch(await svc.getOrder(prisma, req.params.id), actor(req), b);
  res.json(r);
}));
router.post("/:id/revive", requirePerm("order.approve"), asyncHandler(async (req, res) => {
  await svc.revive(await svc.getOrder(prisma, req.params.id), actor(req));
  res.json(svc.serializeOrder(await svc.getOrder(prisma, req.params.id)));
}));
router.post("/:id/cancel", requirePerm("order.approve"), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);
  await svc.cancel(await svc.getOrder(prisma, req.params.id), actor(req), reason);
  res.json({ ok: true });
}));

router.get("/:id/invoice/:no", requirePerm("order.view", "ledger.view"), asyncHandler(async (req, res) => {
  // Contacts come with the bill so Share can offer the firm's actual numbers
  // rather than only the one on the customer record.
  const inv = await prisma.invoice.findUnique({ where: { no: req.params.no }, include: { lines: true, customer: { include: { contacts: true } }, order: { select: { id: true, dispatches: true } } } });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Invoice viewed", entityType: "Invoice", entityId: inv.no });
  res.json({ ...inv, taxable: D(inv.taxable), cgst: D(inv.cgst), sgst: D(inv.sgst), igst: D(inv.igst), total: D(inv.total), customer: { ...inv.customer, creditLimit: D(inv.customer.creditLimit) }, lines: inv.lines.map((l) => ({ ...l, rate: D(l.rate), amount: D(l.amount) })), company: await getCompany(), whatsappFrom: await getSetting<string>("WHATSAPP_FROM", "") });
}));

export default router;
