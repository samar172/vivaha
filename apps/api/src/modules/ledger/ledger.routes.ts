import { Router } from "express";
import { z } from "zod";
import { prisma, D } from "../../db";
import { fyCode } from "../../services/sequence";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { gatesForAll, customerFinance } from "../../services/credit";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextReceiptNo } from "../../services/sequence";
import { outstanding } from "@vivaha/shared";
import { ledgerLines } from "../../services/credit";
import { notFound } from "../../utils/httpError";

const router = Router();

router.get("/outstanding", requirePerm("ledger.view"), asyncHandler(async (_req, res) => {
  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
  const g = await gatesForAll(customers);
  const rows = customers.map((c) => ({ id: c.id, name: c.name, tehsil: c.tehsil, creditDays: c.creditDays, gateMode: c.gateMode, creditLimit: D(c.creditLimit), gate: g[c.id].gate, ageing: g[c.id].ageing }))
    .filter((r) => r.gate.out !== 0 || r.ageing.some((b) => b > 0)).sort((a, b) => b.gate.out - a.gate.out);
  res.json({ rows, total: rows.reduce((s, r) => s + r.gate.out, 0), buckets: [0, 1, 2, 3, 4].map((i) => rows.reduce((s, r) => s + r.ageing[i], 0)) });
}));

router.get("/customers/:id", requirePerm("ledger.view", "cust.view"), asyncHandler(async (req, res) => {
  const c = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!c) throw notFound("Customer not found");
  res.json({ customer: { ...c, creditLimit: D(c.creditLimit) }, ...(await customerFinance(c)) });
}));

// The invoice register. Each line bills on its own series, so the register is
// filtered by line the way every other screen is — the line switcher in the
// topbar is the same control here as on items or orders.
router.get("/invoices", requirePerm("ledger.view"), asyncHandler(async (req, res) => {
  const q = z.object({ line: z.string().optional(), q: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const rows = await prisma.invoice.findMany({
    where: {
      ...(q.line && q.line !== "ALL" ? { lineId: q.line } : {}),
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to + "T23:59:59") } : {}) } } : {}),
      ...(q.q ? { OR: [{ no: { contains: q.q, mode: "insensitive" } }, { customer: { name: { contains: q.q, mode: "insensitive" } } }, { orderId: { contains: q.q, mode: "insensitive" } }] } : {}),
    },
    include: { customer: { select: { name: true, gstin: true, firmType: true, tehsil: true } }, line: { select: { id: true, name: true } } },
    orderBy: { date: "desc" },
  });
  res.json(rows.map((i) => ({ ...i, taxable: D(i.taxable), cgst: D(i.cgst), sgst: D(i.sgst), igst: D(i.igst), total: D(i.total), tax: D(i.cgst) + D(i.sgst) + D(i.igst) })));
}));

// What the next invoice on each line will be numbered — shown in Settings so
// the series and its starting number can be checked before the first one goes
// out, and read-only because changing a number after the fact is not a thing
// you do to a tax invoice.
router.get("/invoice-series", requirePerm("ledger.view"), asyncHandler(async (_req, res) => {
  const lines = await prisma.businessLine.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const fy = fyCode();
  const seqs = await prisma.sequence.findMany({ where: { name: { startsWith: "INV-" } } });
  res.json(lines.map((l) => {
    const cur = seqs.find((s) => s.name === `INV-${l.id}-${fy}`)?.value ?? null;
    const next = cur == null ? l.invoiceStart : cur + 1;
    return {
      lineId: l.id, name: l.name, prefix: l.invoicePrefix, start: l.invoiceStart,
      fy, issued: cur == null ? 0 : Math.max(0, cur - l.invoiceStart + 1),
      nextNo: `${l.invoicePrefix}/${fy}/${String(next).padStart(4, "0")}`,
      started: cur != null,
    };
  }));
}));

router.get("/payments", requirePerm("ledger.view"), asyncHandler(async (_req, res) => {
  const rows = await prisma.payment.findMany({ include: { customer: { select: { name: true } } }, orderBy: { date: "desc" } });
  res.json(rows.map((p) => ({ ...p, amount: D(p.amount) })));
}));

router.post("/payments", requirePerm("payment.create"), asyncHandler(async (req, res) => {
  const b = z.object({ customerId: z.string(), amount: z.number().positive("Enter a valid amount"), method: z.string().min(1), ref: z.string().default(""), date: z.string().optional() }).parse(req.body);
  const c = await prisma.customer.findUnique({ where: { id: b.customerId } });
  if (!c) throw notFound("Customer not found");
  const out = await prisma.$transaction(async (tx) => {
    const id = await nextReceiptNo(tx);
    const date = b.date ? new Date(b.date) : new Date();
    await tx.payment.create({ data: { id, customerId: c.id, date, amount: b.amount, method: b.method, ref: b.ref, by: req.user!.name } });
    await tx.ledgerEntry.create({ data: { customerId: c.id, date, type: "PAYMENT", ref: id, particular: `Payment received · ${b.method} ${b.ref}`.trim(), debit: 0, credit: b.amount } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Payment recorded", entityType: "Customer", entityId: c.name, newValue: `₹${b.amount} via ${b.method}` });
    await notify(tx, { text: `Payment ₹${b.amount.toLocaleString("en-IN")} received from ${c.name}`, kind: "OK", role: "SALES_EXECUTIVE" });
    const out = outstanding(await ledgerLines(c.id));
    let autoLifted = false;
    if (c.blockReason && out <= D(c.creditLimit)) {
      await tx.customer.update({ where: { id: c.id }, data: { blockReason: null, blockedBy: null, blockedAt: null, blockUntil: null } });
      await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Temporary block lifted", entityType: "Customer", entityId: c.name, oldValue: "Blocked", newValue: "Active", reason: "Outstanding cleared below limit — auto-lifted on receipt" });
      autoLifted = true;
    }
    return { receiptNo: id, outstanding: out, autoLifted };
  });
  res.status(201).json(out);
}));

router.get("/gst-summary", requirePerm("ledger.view"), asyncHandler(async (_req, res) => {
  const invs = await prisma.invoice.findMany({ include: { lines: true, customer: { select: { firmType: true } } } });
  const hsn: Record<string, { hsn: string; gstPct: number; qty: number; taxable: number; tax: number }> = {};
  for (const i of invs) for (const l of i.lines) { const k = l.hsn + "|" + l.gstPct; const h = (hsn[k] = hsn[k] || { hsn: l.hsn, gstPct: l.gstPct, qty: 0, taxable: 0, tax: 0 }); h.qty += l.qty; h.taxable += D(l.amount); h.tax += (D(l.amount) * l.gstPct) / 100; }
  res.json({
    invoices: invs.length, taxable: invs.reduce((s, i) => s + D(i.taxable), 0), tax: invs.reduce((s, i) => s + D(i.cgst) + D(i.sgst) + D(i.igst), 0),
    b2b: invs.filter((i) => i.customer.firmType === "Registered").length, b2c: invs.filter((i) => i.customer.firmType !== "Registered").length,
    hsn: Object.values(hsn).sort((a, b) => b.taxable - a.taxable),
  });
}));

export default router;
