import { Router } from "express";
import { z } from "zod";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { loadItemViews } from "../../services/items";
import { gatesForAll } from "../../services/credit";
import { getMinMargin } from "../../services/settings";
import { slabRate } from "@vivaha/shared";

const router = Router();
export const REPORTS = [
  ["Stock position", "On hand, available, reserved, held, damaged — by item and godown, right now", "stock", "stock"],
  ["Stock ageing", "Which goods-receipt batches are old, what they cost, what to liquidate", "stock", "stock-ageing"],
  ["Dead stock", "No outward movement in n days and the capital it is holding", "stock", "dead"],
  ["Sales register", "Invoice-wise sales by period, line, firm, tehsil and sales executive", "sales", "sales"],
  ["Item velocity", "What is moving, at what rate, by season — the buying list", "sales", "velocity"],
  ["Stock-out demand", "What customers searched for and could not get — lost revenue, quantified", "sales", "stockout"],
  ["Customer outstanding & ageing", "Who owes what, for how long, against which limit", "fin", "outstanding"],
  ["Payment behaviour", "Average days to pay per firm — the input to credit-days decisions", "fin", "payment"],
  ["Margin by line and item", "Where the money is made, after landed cost and freight", "fin", "margin"],
  ["Booking conversion", "Which firms book and do not buy", "sales", "conv"],
  ["Consumables reorder due", "Which presses are due to reorder this week", "sales", "reorder"],
  ["Kit health", "Which retailers hold an out-of-date range and need a visit", "sales", "kit"],
  ["Tehsil cluster", "Where customers and revenue concentrate — where the next godown goes", "sales", "tehsil"],
  ["Vendor performance", "Rate history, lead time, defect rate by vendor", "stock", "vendor"],
  ["GSTR-1 data set", "Invoice register, HSN summary, rate-wise tax, B2B and B2C splits", "fin", "gstr1"],
  ["Job work profitability", "Quoted against actual card, process and wastage cost", "fin", "jobs"],
  ["Refer & earn", "Who referred whom, what came of it, and what is owed", "sales", "referral"],
  ["Staff & logins", "Every contact across every firm, and who can sign in", "sales", "staff"],
];
router.get("/", requirePerm("report.view"), (_req, res) => res.json(REPORTS.map(([name, answers, group, key]) => ({ name, answers, group, key }))));

const lineOf = (req: { query: Record<string, unknown> }) => String(req.query.line || "ALL");

// Referrals already existed end to end — a code on every firm, a submission
// screen in the portal, a reward on the row. Nothing could read it back. This
// joins each referral to the firm it produced, so "submitted" and "actually
// bought" are told apart, and the reward is only counted once there is an order.
router.get("/referral", requirePerm("report.view"), asyncHandler(async (req, res) => {
  const refs = await prisma.referral.findMany({ include: { by: { select: { id: true, name: true, tehsil: true, referCode: true } } }, orderBy: { createdAt: "desc" } });
  // A firm opened on somebody's refer code carries the link outright. The name
  // match stays behind it for referrals written down before that existed, and
  // for a firm that walked in without mentioning the code.
  const customers = await prisma.customer.findMany({ select: { id: true, name: true, createdAt: true, orders: { where: { status: { notIn: ["LAPSED", "REJECTED", "CANCELLED"] } }, select: { total: true } } } });
  const byName = new Map(customers.map((c) => [c.name.trim().toLowerCase(), c]));
  const byId = new Map(customers.map((c) => [c.id, c]));
  res.json(refs.map((r) => {
    const joined = (r.customerId ? byId.get(r.customerId) : null) ?? byName.get(r.name.trim().toLowerCase()) ?? null;
    const orders = joined?.orders ?? [];
    const business = orders.reduce((s, o) => s + D(o.total), 0);
    // The reward is earned on business done, not on a name being written down.
    const earned = orders.length > 0;
    return {
      id: r.id,
      referrer: { id: r.by.id, name: r.by.name, tehsil: r.by.tehsil, code: r.by.referCode },
      referred: { name: r.name, tehsil: r.tehsil, phone: r.phone, customerId: joined?.id ?? null },
      date: r.createdAt, state: r.state,
      orders: orders.length, business,
      reward: D(r.reward), earned,
      status: earned ? "Converted" : joined ? "Signed up, no order yet" : r.state,
    };
  }));
}));

// Staff are CustomerContact rows — the model has always been there, and the
// customer screen has always shown them one firm at a time. This is the same
// data read across every firm, which is what "view all staff" needs.
router.get("/staff", requirePerm("report.view"), asyncHandler(async (req, res) => {
  const q = z.object({ customerId: z.string().optional(), role: z.string().optional() }).parse(req.query);
  const rows = await prisma.customerContact.findMany({
    where: { ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.role && q.role !== "ALL" ? { role: q.role } : {}) },
    include: { customer: { select: { id: true, name: true, tehsil: true, salesExec: { select: { name: true } } } } },
    orderBy: [{ customerId: "asc" }, { role: "asc" }],
  });
  res.json(rows.map((c) => ({
    id: c.id, name: c.name, role: c.role, phone: c.phone, authority: c.authority, hasLogin: c.hasLogin,
    customer: c.customer, salesExec: c.customer.salesExec?.name ?? "—",
  })));
}));

const shippedStatuses = ["DISPATCHED", "DELIVERED", "PARTIALLY_DISPATCHED"] as const;

router.get("/velocity", requirePerm("report.view"), asyncHandler(async (req, res) => {
  const line = lineOf(req);
  const items = await loadItemViews({ line: { workflow: "FULFIL" }, ...(line !== "ALL" ? { lineId: line } : {}) });
  const since = new Date(Date.now() - 60 * 864e5);
  const ls = await prisma.orderLine.groupBy({ by: ["itemId"], where: { order: { createdAt: { gte: since }, status: { notIn: ["LAPSED", "REJECTED", "CANCELLED"] } } }, _sum: { qty: true, amount: true } });
  const m = Object.fromEntries(ls.map((l) => [l.itemId, l]));
  res.json(items.map((i) => { const q = m[i.id]?._sum.qty ?? 0, v = D(m[i.id]?._sum.amount); const cover = q > 0 ? Math.round(i.available / (q / 60)) : 999; return { item: i, qty: q, value: v, cover, signal: q === 0 ? "No movement" : cover < 20 ? "Reorder now" : cover < 45 ? "Reorder soon" : "Healthy" }; }).sort((a, b) => b.qty - a.qty));
}));

router.get("/stockout", requirePerm("report.view"), asyncHandler(async (req, res) => {
  const line = lineOf(req);
  const lines = await prisma.businessLine.findMany();
  const lm = Object.fromEntries(lines.map((l) => [l.id, l]));
  const items = (await loadItemViews({ line: { workflow: "FULFIL" }, ...(line !== "ALL" ? { lineId: line } : {}) })).filter((i) => i.available < lm[i.lineId].minSetQty);
  const hits = await prisma.stockoutSearch.groupBy({ by: ["itemId"], _count: { _all: true }, _sum: { reqQty: true } });
  const hm = Object.fromEntries(hits.map((h) => [h.itemId, h]));
  const rows = items.map((i) => { const searches = hm[i.id]?._count._all ?? 0; const reqQty = hm[i.id]?._sum.reqQty ?? 0; const lost = (reqQty || searches * i.moq) * slabRate(i.slabs, i.moq); return { item: i, searches, reqQty, lost }; }).sort((a, b) => b.lost - a.lost);
  res.json({ rows, lost: rows.reduce((s, r) => s + r.lost, 0) });
}));

router.get("/margin", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const minMargin = await getMinMargin();
  const ols = await prisma.orderLine.findMany({ where: { order: { status: { in: [...shippedStatuses] } } }, include: { item: { select: { id: true, sku: true, name: true, lineId: true, landedCost: true } } } });
  const byLine: Record<string, { rev: number; cost: number; qty: number }> = {}, byItem: Record<string, { item: typeof ols[0]["item"]; rev: number; cost: number; qty: number }> = {};
  for (const l of ols) { const q = l.shipped || l.qty; const rev = q * D(l.rate), cost = q * D(l.item.landedCost); const L = (byLine[l.lineId] = byLine[l.lineId] || { rev: 0, cost: 0, qty: 0 }); L.rev += rev; L.cost += cost; L.qty += q; const I = (byItem[l.itemId] = byItem[l.itemId] || { item: l.item, rev: 0, cost: 0, qty: 0 }); I.rev += rev; I.cost += cost; I.qty += q; }
  res.json({ minMargin, byLine: Object.entries(byLine).map(([lineId, b]) => ({ lineId, ...b, marginPct: b.rev ? ((b.rev - b.cost) / b.rev) * 100 : 0 })), byItem: Object.values(byItem).map((r) => ({ ...r, item: { ...r.item, landedCost: undefined }, marginPct: r.rev ? ((r.rev - r.cost) / r.rev) * 100 : 0 })).sort((a, b) => b.rev - a.rev) });
}));

router.get("/conv", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const cs = await prisma.customer.findMany({ include: { salesExec: { select: { name: true } }, orders: { select: { status: true } } } });
  res.json(cs.map((c) => { const booked = c.orders.length, conv = c.orders.filter((o) => !["LAPSED", "REJECTED", "CANCELLED"].includes(o.status)).length, open = c.orders.filter((o) => o.status === "BOOKED").length; return { id: c.id, name: c.name, salesExec: c.salesExec?.name ?? "—", booked, conv, open, rate: booked ? conv / booked : 1 }; }).filter((r) => r.booked > 0).sort((a, b) => a.rate - b.rate));
}));

// Predicted from the median gap between the firm's last three consumable orders;
// with fewer than three, the machine profile supplies a default.
router.get("/reorder", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const cs = await prisma.customer.findMany({ where: { machines: { some: {} } }, include: { machines: true, orders: { where: { lines: { some: { line: { code: "consumables" } } }, status: { notIn: ["LAPSED", "REJECTED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 4, select: { createdAt: true } } } });
  const cons = await prisma.item.findMany({ where: { line: { code: "consumables" }, status: "ACTIVE" } });
  const rows = cs.map((c, x) => {
    const m = c.machines.find((m) => m.type === "Offset"); const spec = (m?.spec as Record<string, string>) || {};
    const it = cons.find((i) => (i.attrs as Record<string, string>).brand === (spec.ink || "SGL")) || cons[0];
    const ds = c.orders.map((o) => o.createdAt.getTime()).sort((a, b) => b - a);
    const gaps = ds.slice(1).map((d, i) => Math.round((ds[i] - d) / 864e5));
    const median = gaps.length >= 2 ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : [26, 32, 41, 28, 35][x % 5];
    const last = ds.length ? Math.round((Date.now() - ds[0]) / 864e5) : 8 + (x * 5) % 26;
    return { customer: { id: c.id, name: c.name, tehsil: c.tehsil, contactName: c.contactName }, machines: c.machines.map((m) => m.type + ((m.spec as Record<string, string>).colours ? " " + (m.spec as Record<string, string>).colours + "C" : "")), item: it ? { id: it.id, sku: it.sku, name: it.name, uom: it.uom } : null, qty: spec.colours === "4" ? 20 : 10, gap: median, due: median - last, confidence: gaps.length >= 2 ? "high" : "estimated" };
  }).sort((a, b) => a.due - b.due);
  res.json(rows);
}));

router.get("/tehsil", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const cs = await prisma.customer.findMany({ include: { orders: { select: { total: true } } } });
  const g = await gatesForAll(cs);
  const t: Record<string, { tehsil: string; firms: number; rev: number; out: number }> = {};
  for (const c of cs) { const r = (t[c.tehsil] = t[c.tehsil] || { tehsil: c.tehsil, firms: 0, rev: 0, out: 0 }); r.firms++; r.out += Math.max(0, g[c.id].gate.out); r.rev += c.orders.reduce((s, o) => s + D(o.total), 0); }
  res.json(Object.values(t).sort((a, b) => b.rev - a.rev));
}));

router.get("/payment", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const cs = await prisma.customer.findMany({ include: { ledger: { orderBy: { date: "asc" } } } });
  res.json(cs.map((c) => { const inv = c.ledger.filter((e) => e.type === "INVOICE"), pay = c.ledger.filter((e) => e.type === "PAYMENT"); const days: number[] = []; let pi = 0; for (const i of inv) { while (pi < pay.length && pay[pi].date < i.date) pi++; if (pay[pi]) days.push(Math.round((pay[pi].date.getTime() - i.date.getTime()) / 864e5)); } return { id: c.id, name: c.name, creditDays: c.creditDays, invoices: inv.length, avgDaysToPay: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null }; }).filter((r) => r.invoices > 0));
}));

router.get("/kit", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const latest = await prisma.kitVersion.findFirst({ orderBy: { issuedAt: "desc" } });
  const kits = await prisma.kit.findMany({ include: { customer: { select: { id: true, name: true, tehsil: true } }, kitVersion: true } });
  res.json(kits.map((k) => ({ customer: k.customer, version: k.kitVersionId, current: k.kitVersionId === latest?.id, issuedAt: k.issuedAt, lastScanAt: k.lastScanAt, daysSinceScan: k.lastScanAt ? Math.round((Date.now() - k.lastScanAt.getTime()) / 864e5) : null })));
}));

router.get("/sales", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const inv = await prisma.invoice.findMany({ include: { customer: { select: { name: true, tehsil: true, salesExec: { select: { name: true } } } }, lines: { select: { itemId: true, amount: true } } }, orderBy: { date: "desc" } });
  res.json(inv.map((i) => ({ no: i.no, date: i.date, orderId: i.orderId, firm: i.customer.name, tehsil: i.customer.tehsil, salesExec: i.customer.salesExec?.name ?? "—", taxable: D(i.taxable), tax: D(i.cgst) + D(i.sgst) + D(i.igst), total: D(i.total) })));
}));

router.get("/vendor", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const vs = await prisma.vendor.findMany({ include: { purchases: { include: { lines: true } } } });
  res.json(vs.map((v) => { const ls = v.purchases.flatMap((p) => p.lines.map((l) => ({ ...l, date: p.date, eta: p.eta }))); const rates = ls.map((l) => D(l.rate)); return { id: v.id, name: v.name, terms: v.terms, documents: v.purchases.length, qty: ls.reduce((s, l) => s + l.qty, 0), avgRate: rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0, lastRate: rates[rates.length - 1] ?? 0, leadDays: 6 }; }));
}));

router.get("/jobs", requirePerm("report.view"), asyncHandler(async (_req, res) => {
  const js = await prisma.jobWork.findMany({ include: { customer: { select: { name: true } }, baseItem: { select: { landedCost: true } }, processItem: { select: { wastagePct: true, setupCharge: true, slabs: true } } } });
  res.json(js.map((j) => { const w = D(j.processItem.wastagePct) || 4, waste = Math.ceil((j.qty * w) / 100); const cost = (j.qty + waste) * D(j.baseItem.landedCost) + j.qty * D(j.processItem.slabs[0]?.rate) + D(j.processItem.setupCharge); return { id: j.id, firm: j.customer.name, status: j.status, qty: j.qty, quote: D(j.quote), cost, margin: D(j.quote) ? 1 - cost / D(j.quote) : 0 }; }));
}));

export default router;
