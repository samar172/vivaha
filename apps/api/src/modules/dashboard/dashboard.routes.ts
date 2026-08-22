import { Router } from "express";
import { ORDER_FLOW, ageDays } from "@vivaha/shared";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { loadItemViews } from "../../services/items";
import { gatesForAll } from "../../services/credit";

const router = Router();
router.get("/", requirePerm("dash.view"), asyncHandler(async (req, res) => {
  const line = String(req.query.line || "ALL");
  const lineFilter = line !== "ALL" ? { lines: { some: { lineId: line } } } : {};
  const [orders, items, customers, invoices, notifs] = await Promise.all([
    prisma.order.findMany({ where: lineFilter, include: { customer: true, lines: { select: { itemId: true, qty: true } } } }),
    loadItemViews(line !== "ALL" ? { lineId: line } : {}),
    prisma.customer.findMany(),
    prisma.invoice.findMany({ select: { date: true, taxable: true } }),
    prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
  ]);
  const gates = await gatesForAll(customers);
  const booked = orders.filter((o) => o.status === "BOOKED");
  const soon = booked.filter((o) => o.holdUntil && o.holdUntil.getTime() - Date.now() < 6e5).length;
  const disp = orders.filter((o) => ["ALLOCATED", "PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH"].includes(o.status)).length;
  const recv = customers.reduce((s, c) => s + Math.max(0, gates[c.id].gate.out), 0);
  const over = customers.filter((c) => gates[c.id].gate.restricted).length;
  const mtd = invoices.filter((i) => ageDays(i.date) <= 30).reduce((s, i) => s + D(i.taxable), 0);
  const stock = items.reduce((s, i) => ({ onHand: s.onHand + i.onHand, available: s.available + i.available, reserved: s.reserved + i.reserved, damaged: s.damaged + i.damaged, value: s.value + (i.onHand - i.damaged - i.quarantined) * i.landedCost }), { onHand: 0, available: 0, reserved: 0, damaged: 0, value: 0 });
  const pipeline = [...ORDER_FLOW, "PARTIALLY_DISPATCHED", "LAPSED", "REJECTED", "CANCELLED"].map((s) => ({ status: s, count: orders.filter((o) => o.status === s).length }));
  const qtyByItem: Record<string, number> = {};
  for (const o of orders) for (const l of o.lines) qtyByItem[l.itemId] = (qtyByItem[l.itemId] || 0) + l.qty;
  const fastest = items.map((i) => ({ item: i, qty: qtyByItem[i.id] || 0 })).filter((x) => x.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 6);
  const ageing = [0, 0, 0, 0, 0]; for (const c of customers) gates[c.id].ageing.forEach((v, i) => (ageing[i] += v));
  res.json({
    kpis: { awaiting: booked.length, expiringSoon: soon, toDispatch: disp, receivables: recv, pastGate: over, billed30d: mtd, available: stock.available, reserved: stock.reserved, stockValue: stock.value, damaged: stock.damaged },
    holds: booked.sort((a, b) => (a.holdUntil?.getTime() ?? 0) - (b.holdUntil?.getTime() ?? 0)).map((o) => ({ id: o.id, firm: o.customer.name, tehsil: o.customer.tehsil, group: o.customer.group, total: D(o.total), requiredBy: o.requiredBy, holdUntil: o.holdUntil, gate: gates[o.customerId].gate })),
    pipeline, fastest, ageing, notifs, totalOrders: orders.length,
  });
}));
export default router;
