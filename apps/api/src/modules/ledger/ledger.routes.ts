import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, D } from "../../db";
import { fyCode } from "../../services/sequence";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { gatesForAll, customerFinance } from "../../services/credit";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextReceiptNo, nextSettlementNo } from "../../services/sequence";
import { outstanding, invoiceTotals, marginFloor } from "@vivaha/shared";
import { ledgerLines } from "../../services/credit";
import { getHomeState, getMinMargin } from "../../services/settings";
import { storeImage } from "../../services/uploads";
import { badRequest, forbidden, notFound } from "../../utils/httpError";

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
    include: { customer: { select: { name: true, gstin: true, firmType: true, tehsil: true } }, line: { select: { id: true, name: true } }, shares: { orderBy: { at: "desc" } }, amendments: { orderBy: { at: "desc" } } },
    orderBy: { date: "desc" },
  });
  res.json(rows.map((i) => ({
    ...i, taxable: D(i.taxable), cgst: D(i.cgst), sgst: D(i.sgst), igst: D(i.igst), total: D(i.total), tax: D(i.cgst) + D(i.sgst) + D(i.igst),
    // The last time this bill went out, and how many times in all. Named
    // "sent from here" rather than "delivered" — see InvoiceShare.
    lastSent: i.shares[0] ?? null,
    sentCount: i.shares.length,
    // A corrected bill says so on the register rather than quietly reading as
    // if it had always said this.
    amendCount: i.amendments.length,
    lastAmend: i.amendments[0] ? { at: i.amendments[0].at, by: i.amendments[0].by, reason: i.amendments[0].reason, oldTotal: D(i.amendments[0].oldTotal), newTotal: D(i.amendments[0].newTotal) } : null,
    amendments: undefined,
  })));
}));

// ── Correcting a bill ───────────────────────────────────────────────────────
// A tax invoice is not an ordinary record. The number is filed, the ledger is
// posted from it and the GST return is built out of it — so this is an
// amendment, not an edit:
//
//   * the number never changes and is never reused;
//   * what the bill said before is kept, with who changed it and why;
//   * the ledger is put right with a fresh entry, never by rewriting the debit
//     that is already there. A reduction posts a credit, an increase posts a
//     further debit, and outstanding recomputes off the ledger as it always has.
//
// What it will not do is bill more than left the godown. Quantity is checked
// against what the order actually shipped, across every bill raised on that
// order, because the one thing a bill must agree with is the stock.
router.post("/invoices/:no/amend", requirePerm("invoice.amend"), asyncHandler(async (req, res) => {
  const b = z.object({
    lines: z.array(z.object({ id: z.string(), qty: z.number().int().min(1, "A line has to be at least one unit — to take it off the bill entirely, raise a return"), rate: z.number().min(0) })).min(1),
    date: z.string().optional(),
    reason: z.string().trim().min(4, "Say why the bill is being corrected — it goes on the record with the change"),
  }).parse(req.body);

  const inv = await prisma.invoice.findUnique({
    where: { no: req.params.no },
    include: {
      lines: true,
      customer: { select: { id: true, name: true, gstin: true } },
      order: { include: { lines: { select: { itemId: true, shipped: true, item: { select: { sku: true, landedCost: true } } } } } },
    },
  });
  if (!inv) throw notFound("Invoice not found");
  if (inv.status !== "Posted") throw badRequest(`${inv.no} is ${inv.status.toLowerCase()} — a bill that is not posted cannot be corrected`);

  const byId = new Map(inv.lines.map((l) => [l.id, l]));
  for (const x of b.lines) if (!byId.has(x.id)) throw badRequest("One of the lines is not on this bill");
  // Anything the caller did not send keeps what it said.
  const next = inv.lines.map((l) => {
    const x = b.lines.find((y) => y.id === l.id);
    return { line: l, qty: x ? x.qty : l.qty, rate: x ? x.rate : D(l.rate) };
  });

  // Never bill more than the godown shipped — counted across every posted bill
  // on this order, with this one's new figures standing in for its old ones.
  const others = await prisma.invoiceLine.findMany({
    where: { invoice: { orderId: inv.orderId, status: "Posted", no: { not: inv.no } } },
    select: { itemId: true, qty: true },
  });
  const billedElsewhere = new Map<string, number>();
  for (const o of others) billedElsewhere.set(o.itemId, (billedElsewhere.get(o.itemId) ?? 0) + o.qty);
  const wantByItem = new Map<string, number>();
  for (const n of next) wantByItem.set(n.line.itemId, (wantByItem.get(n.line.itemId) ?? 0) + n.qty);
  for (const [itemId, want] of wantByItem) {
    const ol = inv.order.lines.find((x) => x.itemId === itemId);
    const shipped = ol?.shipped ?? 0;
    const already = billedElsewhere.get(itemId) ?? 0;
    if (want + already > shipped) {
      throw badRequest(`${ol?.item.sku ?? itemId}: only ${shipped} left the godown on this order${already ? ` and ${already} is already billed elsewhere` : ""} — a bill cannot say more went out than did. Dispatch the rest first, or reduce this line.`);
    }
  }

  // The same margin floor the pricing engine holds. Going under it is somebody's
  // decision to make, not a side effect of a correction.
  const minMargin = await getMinMargin();
  const under = next
    .map((n) => ({ n, floor: marginFloor(D(inv.order.lines.find((x) => x.itemId === n.line.itemId)?.item.landedCost ?? 0), minMargin) }))
    .filter((x) => x.n.rate < x.floor);
  if (under.length && !req.user!.perms.includes("margin.override")) {
    const w = under[0];
    throw forbidden(`${w.n.line.sku} at ${w.n.rate.toFixed(2)} is below the margin floor of ${w.floor.toFixed(2)}. That needs margin.override.`);
  }

  const homeState = await getHomeState();
  const t = invoiceTotals(next.map((n) => ({ amount: n.qty * n.rate, gstPct: n.line.gstPct })), inv.customer.gstin, homeState);
  const oldTotal = D(inv.total);
  const delta = Math.round((t.total - oldTotal) * 100) / 100;
  const changed = next.filter((n) => n.qty !== n.line.qty || n.rate !== D(n.line.rate));
  if (!changed.length && !b.date) throw badRequest("Nothing on the bill is different — change a quantity, a rate or the date");

  const out = await prisma.$transaction(async (tx) => {
    for (const n of changed) {
      await tx.invoiceLine.update({ where: { id: n.line.id }, data: { qty: n.qty, rate: n.rate, amount: Math.round(n.qty * n.rate * 100) / 100 } });
    }
    await tx.invoice.update({
      where: { no: inv.no },
      data: {
        taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total,
        blocks: t.blocks as unknown as Prisma.InputJsonValue,
        ...(b.date ? { date: new Date(b.date) } : {}),
      },
    });
    // The original debit stays exactly as it was posted. The difference is its
    // own entry, so the statement reads as what happened rather than as what we
    // wish had happened.
    if (delta !== 0) {
      await tx.ledgerEntry.create({ data: {
        customerId: inv.customerId, date: new Date(),
        type: delta > 0 ? "INVOICE" : "CREDIT",
        ref: inv.no,
        particular: `Correction to ${inv.no} — ${b.reason}`,
        debit: delta > 0 ? delta : 0,
        credit: delta < 0 ? -delta : 0,
      } });
    }
    const amendment = await tx.invoiceAmendment.create({ data: {
      invoiceNo: inv.no, reason: b.reason, oldTotal, newTotal: t.total, by: req.user!.name,
      detail: changed.map((n) => ({ sku: n.line.sku, was: { qty: n.line.qty, rate: D(n.line.rate) }, now: { qty: n.qty, rate: n.rate } })) as unknown as Prisma.InputJsonValue,
    } });
    await audit(tx, {
      userId: req.user!.id, actor: req.user!.name, action: "Tax invoice corrected",
      entityType: "Invoice", entityId: inv.no,
      oldValue: `₹${oldTotal.toFixed(2)} · ` + inv.lines.map((l) => `${l.sku} ${l.qty}×${D(l.rate)}`).join(", "),
      newValue: `₹${t.total.toFixed(2)} · ` + next.map((n) => `${n.line.sku} ${n.qty}×${n.rate}`).join(", "),
      reason: b.reason,
    });
    return amendment;
  });

  await notify(prisma, {
    text: `${inv.no} corrected by ${req.user!.name} — ${inv.customer.name}, ₹${oldTotal.toFixed(0)} → ₹${t.total.toFixed(0)}`,
    kind: "WARN", role: "ACCOUNTS_MANAGER",
  });
  res.json({
    ok: true, no: inv.no, oldTotal, total: t.total, delta,
    amendmentId: out.id,
    belowFloor: under.map((x) => ({ sku: x.n.line.sku, rate: x.n.rate, floor: x.floor })),
    // Said plainly rather than left for somebody to work out: the money moved,
    // the stock did not.
    stockUnchanged: changed.some((n) => n.qty !== n.line.qty),
  });
}));

// Records that a bill was sent from here, to a chosen number. Written when the
// office opens the ready-addressed message, which is the moment we know about;
// WhatsApp's own delivery is not visible to us and is not claimed.
router.post("/invoices/:no/share", requirePerm("ledger.view"), asyncHandler(async (req, res) => {
  const b = z.object({ channel: z.string().default("WHATSAPP"), toName: z.string().default(""), toPhone: z.string().min(4) }).parse(req.body);
  const inv = await prisma.invoice.findUnique({ where: { no: req.params.no } });
  if (!inv) throw notFound("Invoice not found");
  const share = await prisma.invoiceShare.create({ data: { invoiceNo: inv.no, channel: b.channel, toName: b.toName, toPhone: b.toPhone, by: req.user!.name } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Invoice sent", entityType: "Invoice", entityId: inv.no, newValue: `${b.channel} · ${b.toName || b.toPhone}` });
  res.status(201).json(share);
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
  const b = z.object({
    customerId: z.string(), amount: z.number().positive("Enter a valid amount"),
    method: z.string().min(1), ref: z.string().default(""),
    // A full timestamp, not a day. Two transfers of the same amount from the
    // same firm on one afternoon are told apart by the clock and nothing else.
    date: z.string().optional(),
    // The screenshot the customer sent, as a data URL — the same road an item
    // photograph takes.
    proof: z.string().optional(),
    // When the money never passed through our account: the firm was given a
    // supplier's QR and paid them directly, against his own bill with us.
    toVendorId: z.string().optional(),
    settlementNote: z.string().max(200).default(""),
  }).parse(req.body);
  const c = await prisma.customer.findUnique({ where: { id: b.customerId } });
  if (!c) throw notFound("Customer not found");
  const vendor = b.toVendorId
    ? await prisma.vendor.findUnique({ where: { id: b.toVendorId }, include: { purchases: { select: { total: true, freight: true } }, payments: { select: { amount: true } } } })
    : null;
  if (b.toVendorId && !vendor) throw notFound("Supplier not found");
  if (vendor) {
    // A settlement can only discharge a debt that exists. Paying a supplier we
    // owe nothing would leave them holding our money with no invoice behind it,
    // which is a loan and not a settlement — and nobody meant to make one.
    const invoiced = vendor.purchases.reduce((t, p) => t + D(p.total) + D(p.freight), 0);
    const paid = vendor.payments.reduce((t, p) => t + D(p.amount), 0);
    const owed = Math.round((invoiced - paid) * 100) / 100;
    if (owed <= 0) throw badRequest(`We do not owe ${vendor.name} anything, so there is nothing for this payment to settle against`);
    if (b.amount > owed) throw badRequest(`We owe ${vendor.name} ₹${owed.toFixed(2)} — a settlement cannot be larger than the debt it discharges. Take ₹${owed.toFixed(2)} this way and the rest another.`);
  }

  // Stored before the transaction: an upload is a network call and has no
  // business inside the transaction that moves two ledgers.
  const proofUrl = b.proof?.startsWith("data:")
    ? (await storeImage("payments", `${c.id}-${Date.now()}`, b.proof)).url
    : b.proof || null;

  const out = await prisma.$transaction(async (tx) => {
    const id = await nextReceiptNo(tx);
    const date = b.date ? new Date(b.date) : new Date();

    // The direct-settlement leg, when there is one. Our reference is the only
    // thing the two halves have in common, and it names neither party — so the
    // firm's statement and the supplier's payment can be put back together a
    // year from now without either of them ever appearing on the other's paper.
    let settlementId: string | null = null;
    if (vendor) {
      settlementId = await nextSettlementNo(tx);
      await tx.settlement.create({ data: { id: settlementId, customerId: c.id, vendorId: vendor.id, amount: b.amount, at: date, note: b.settlementNote, by: req.user!.name } });
      await tx.vendorPayment.create({ data: { vendorId: vendor.id, date, amount: b.amount, ref: settlementId, settlementId } });
    }

    await tx.payment.create({ data: { id, customerId: c.id, date, amount: b.amount, method: b.method, ref: b.ref, proofUrl, settlementId, by: req.user!.name } });
    // What the firm sees on its own statement. Deliberately says nothing about
    // where the money went — that is our arrangement, not theirs.
    const particular = settlementId
      ? `Payment received · ${b.method} ${b.ref} · Ref ${settlementId}`.replace(/\s+/g, " ").trim()
      : `Payment received · ${b.method} ${b.ref}`.trim();
    await tx.ledgerEntry.create({ data: { customerId: c.id, date, type: "PAYMENT", ref: id, particular, debit: 0, credit: b.amount } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: settlementId ? "Payment settled direct to a supplier" : "Payment recorded", entityType: "Customer", entityId: c.name, newValue: `₹${b.amount} via ${b.method}`, reason: settlementId ? `${settlementId} — paid straight to ${vendor!.name}${b.settlementNote ? " · " + b.settlementNote : ""}` : "" });
    await notify(tx, { text: settlementId ? `₹${b.amount.toLocaleString("en-IN")} from ${c.name} settled direct to a supplier — ${settlementId}` : `Payment ₹${b.amount.toLocaleString("en-IN")} received from ${c.name}`, kind: "OK", role: "ACCOUNTS_MANAGER" });
    const out = outstanding(await ledgerLines(c.id));
    let autoLifted = false;
    if (c.blockReason && out <= D(c.creditLimit)) {
      await tx.customer.update({ where: { id: c.id }, data: { blockReason: null, blockedBy: null, blockedAt: null, blockUntil: null } });
      await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Temporary block lifted", entityType: "Customer", entityId: c.name, oldValue: "Blocked", newValue: "Active", reason: "Outstanding cleared below limit — auto-lifted on receipt" });
      autoLifted = true;
    }
    return { receiptNo: id, outstanding: out, autoLifted, settlementId, proofUrl };
  });
  res.status(201).json(out);
}));

// The reconciliation view, and the only place in the system where both halves
// of a settlement appear together. It is behind ledger.view because that is
// what it is: our books, not either party's.
router.get("/settlements", requirePerm("ledger.view"), asyncHandler(async (_req, res) => {
  const rows = await prisma.settlement.findMany({
    include: {
      customer: { select: { id: true, name: true, code: true } },
      vendor: { select: { id: true, name: true } },
      payment: { select: { id: true, method: true, ref: true, proofUrl: true } },
    },
    orderBy: { at: "desc" },
  });
  res.json(rows.map((r) => ({ ...r, amount: D(r.amount) })));
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
