import { Router } from "express";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { gatesForAll } from "../../services/credit";
import { availAll } from "../../services/stock";

const router = Router();
router.get("/", asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ orders: [], items: [], customers: [] });
  const [orders, items, customers] = await Promise.all([
    prisma.order.findMany({ where: { OR: [{ id: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] }, include: { customer: { select: { name: true } } }, take: 5, orderBy: { createdAt: "desc" } }),
    prisma.item.findMany({ where: { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { designNo: { contains: q, mode: "insensitive" } }] }, take: 5 }),
    prisma.customer.findMany({ where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { contactName: { contains: q, mode: "insensitive" } }, { tehsil: { contains: q, mode: "insensitive" } }] }, take: 5 }),
  ]);
  const g = await gatesForAll(customers);
  res.json({
    orders: orders.map((o) => ({ id: o.id, firm: o.customer.name, status: o.status, total: D(o.total) })),
    items: await Promise.all(items.map(async (i) => ({ id: i.id, sku: i.sku, name: i.name, available: await availAll(prisma, i.id) }))),
    customers: customers.map((c) => ({ id: c.id, name: c.name, tehsil: c.tehsil, outstanding: g[c.id].gate.out })),
  });
}));
export default router;
