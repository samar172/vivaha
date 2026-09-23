import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextJobNo } from "../../services/sequence";
import * as stock from "../../services/stock";
import { badRequest, notFound } from "../../utils/httpError";
import { JOB_STATUSES, invoiceTotals } from "@vivaha/shared";
import { getHomeState } from "../../services/settings";

const router = Router();
const inc = {
  customer: { select: { id: true, name: true, code: true, tehsil: true } },
  baseItem: { select: { id: true, sku: true, designNo: true, name: true, landedCost: true, uom: true } },
  processItem: { select: { id: true, sku: true, designNo: true, name: true, wastagePct: true, setupCharge: true, slabs: true } },
  // The card order this printing was taken alongside, and the bill it went on.
  order: { select: { id: true, status: true, total: true, createdAt: true } },
  invoice: { select: { no: true, date: true, total: true } },
};

type Dec = Prisma.Decimal | number | null;
function costing(j: { qty: number; quote: Dec; baseItem: { landedCost: Dec }; processItem: { wastagePct: Dec; setupCharge: Dec; slabs: { rate: Dec }[] } }) {
  const w = D(j.processItem.wastagePct) || 4, waste = Math.ceil((j.qty * w) / 100);
  const base = (j.qty + waste) * D(j.baseItem.landedCost), proc = j.qty * D(j.processItem.slabs[0]?.rate), setup = D(j.processItem.setupCharge);
  const cost = base + proc + setup, quote = D(j.quote);
  return { wastagePct: w, waste, baseCards: j.qty + waste, baseCost: base, processRate: D(j.processItem.slabs[0]?.rate), processCost: proc, setup, cost, margin: quote > 0 ? (1 - cost / quote) : 0 };
}
type Linked = { order?: { total: Prisma.Decimal | number } | null; invoice?: { total: Prisma.Decimal | number } | null };
const ser = (j: Parameters<typeof costing>[0] & Record<string, unknown> & Linked) => ({
  ...j, quote: D(j.quote as number), costing: costing(j),
  order: j.order ? { ...j.order, total: D(j.order.total as number) } : null,
  invoice: j.invoice ? { ...j.invoice, total: D(j.invoice.total as number) } : null,
});

/** An order and a bill can only be tied to a job for the firm that owns them —
 *  otherwise one customer's printing ends up filed against another's invoice,
 *  which is worse than having no link at all. */
async function assertBelongs(customerId: string, orderId: string | null, invoiceNo: string | null) {
  if (orderId) {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
    if (!o) throw notFound("That order is not on file");
    if (o.customerId !== customerId) throw badRequest("That order belongs to a different firm");
  }
  if (invoiceNo) {
    const inv = await prisma.invoice.findUnique({ where: { no: invoiceNo }, select: { customerId: true, orderId: true } });
    if (!inv) throw notFound("That invoice is not on file");
    if (inv.customerId !== customerId) throw badRequest("That bill belongs to a different firm");
    if (orderId && inv.orderId !== orderId) throw badRequest("That bill was not raised on that order");
  }
}

// Tying a job to the order it was taken alongside, or to the bill it went on.
// Separate from the job's own fields because it is usually done later — the
// printing is quoted at the counter and the card order is booked after.
router.patch("/:id/link", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const b = z.object({ orderId: z.string().nullable().optional(), invoiceNo: z.string().nullable().optional() }).parse(req.body);
  const j = await prisma.jobWork.findUnique({ where: { id: req.params.id } });
  if (!j) throw notFound("Job not found");
  const orderId = b.orderId === undefined ? j.orderId : (b.orderId || null);
  const invoiceNo = b.invoiceNo === undefined ? j.invoiceNo : (b.invoiceNo || null);
  await assertBelongs(j.customerId, orderId, invoiceNo);
  const next = await prisma.jobWork.update({ where: { id: j.id }, data: { orderId, invoiceNo }, include: inc });
  await audit(prisma, {
    userId: req.user!.id, actor: req.user!.name,
    action: orderId || invoiceNo ? "Job work linked to a card order" : "Job work unlinked",
    entityType: "Job", entityId: j.id,
    oldValue: [j.orderId, j.invoiceNo].filter(Boolean).join(" · ") || "not linked",
    newValue: [orderId, invoiceNo].filter(Boolean).join(" · ") || "not linked",
  });
  res.json(ser(next as never));
}));

// Putting printing onto a bill that has already gone out.
//
// The ordinary road is the other one: a job linked to an order is billed with
// the cards when the order is dispatched, on one bill, which is what the
// customer expects from one visit. This is for when the cards went first and
// the printing was agreed after — or somebody forgot.
//
// A posted tax invoice is not edited for it. The line is added and the bill is
// **amended**: the number never changes, what it said before is kept with the
// reason, and the difference is posted to the firm's ledger as its own entry.
// Exactly what correcting a bill does, because that is what this is.
router.post("/:id/bill", requirePerm("order.view", "invoice.amend"), asyncHandler(async (req, res) => {
  const j = await prisma.jobWork.findUnique({
    where: { id: req.params.id },
    include: { processItem: { select: { id: true, sku: true, name: true, hsn: true, gstPct: true } }, customer: { select: { id: true, name: true, gstin: true } } },
  });
  if (!j) throw notFound("Job not found");
  if (j.invoiceNo) throw badRequest(`${j.id} is already on bill ${j.invoiceNo}`);
  if (j.status === "ENQUIRY" || j.status === "QUOTED") throw badRequest("This job has not been accepted yet — a quote nobody has agreed to does not belong on a bill");
  if (!j.orderId) throw badRequest("Link this job to a card order first, so there is a bill to put it on");

  const inv = await prisma.invoice.findFirst({
    where: { orderId: j.orderId, status: "Posted" },
    include: { lines: true },
    orderBy: { date: "desc" },
  });
  if (!inv) throw badRequest("That order has no posted bill yet — dispatch it and the printing goes on the same bill automatically");

  const quote = D(j.quote);
  const homeState = await getHomeState();
  const lines = [
    ...inv.lines.map((l) => ({ amount: D(l.amount), gstPct: l.gstPct })),
    { amount: quote, gstPct: j.processItem.gstPct },
  ];
  const t = invoiceTotals(lines, j.customer.gstin, homeState);
  const oldTotal = D(inv.total);
  const delta = Math.round((t.total - oldTotal) * 100) / 100;

  await prisma.$transaction(async (tx) => {
    await tx.invoiceLine.create({ data: {
      invoiceNo: inv.no, itemId: j.processItem.id,
      itemName: `${j.processItem.name} — ${j.id}`,
      sku: j.id, hsn: j.processItem.hsn, qty: j.qty,
      rate: j.qty > 0 ? Math.round((quote / j.qty) * 100) / 100 : quote,
      amount: quote, gstPct: j.processItem.gstPct, jobId: j.id,
    } });
    await tx.invoice.update({ where: { no: inv.no }, data: {
      taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total,
      blocks: t.blocks as unknown as Prisma.InputJsonValue,
    } });
    await tx.jobWork.update({ where: { id: j.id }, data: { invoiceNo: inv.no } });
    // The original debit stays as posted; the printing is its own entry.
    if (delta !== 0) {
      await tx.ledgerEntry.create({ data: {
        customerId: j.customerId, date: new Date(), type: "INVOICE", ref: inv.no,
        particular: `Printing ${j.id} added to ${inv.no}`,
        debit: delta > 0 ? delta : 0, credit: delta < 0 ? -delta : 0,
      } });
    }
    await tx.invoiceAmendment.create({ data: {
      invoiceNo: inv.no, reason: `Printing ${j.id} billed with the cards`,
      oldTotal, newTotal: t.total, by: req.user!.name,
      detail: [{ sku: j.id, was: { qty: 0, rate: 0 }, now: { qty: j.qty, rate: j.qty > 0 ? Math.round((quote / j.qty) * 100) / 100 : quote } }] as unknown as Prisma.InputJsonValue,
    } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Job work added to a bill", entityType: "Invoice", entityId: inv.no,
                      oldValue: `₹${oldTotal.toFixed(2)}`, newValue: `₹${t.total.toFixed(2)}`, reason: `${j.id} · ₹${quote.toFixed(2)}` });
  });
  await notify(prisma, { text: `${j.id} added to bill ${inv.no} for ${j.customer.name} — ₹${quote.toFixed(0)}`, kind: "INFO", role: "ACCOUNTS_MANAGER" });
  res.json({ ok: true, invoiceNo: inv.no, oldTotal, total: t.total, delta });
}));

// What this firm has that a job could be tied to — its orders, and the bills
// raised on them.
router.get("/linkable/:customerId", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.params.customerId },
    select: { id: true, status: true, total: true, createdAt: true, invoices: { select: { no: true, date: true, total: true } } },
    orderBy: { createdAt: "desc" }, take: 40,
  });
  res.json(orders.map((o) => ({ ...o, total: D(o.total), invoices: o.invoices.map((i) => ({ ...i, total: D(i.total) })) })));
}));

router.get("/", requirePerm("order.view"), asyncHandler(async (_req, res) => {
  const rows = await prisma.jobWork.findMany({ include: inc, orderBy: { createdAt: "desc" } });
  res.json(rows.map((j) => ser(j as never)));
}));
router.get("/:id", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const j = await prisma.jobWork.findUnique({ where: { id: req.params.id }, include: inc });
  if (!j) throw notFound();
  res.json(ser(j as never));
}));
router.post("/", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const b = z.object({
    customerId: z.string(), baseItemId: z.string(), processItemId: z.string(),
    qty: z.number().int().positive(), requiredBy: z.string(), text: z.string().min(1),
    quote: z.number().min(0).optional(),
    // Optional on purpose: plenty of job work walks in on its own, with no card
    // order behind it.
    orderId: z.string().nullable().optional(), invoiceNo: z.string().nullable().optional(),
  }).parse(req.body);
  if (b.orderId) await assertBelongs(b.customerId, b.orderId, b.invoiceNo ?? null);
  else if (b.invoiceNo) await assertBelongs(b.customerId, null, b.invoiceNo);
  const [base, proc] = await Promise.all([prisma.item.findUnique({ where: { id: b.baseItemId } }), prisma.item.findUnique({ where: { id: b.processItemId }, include: { slabs: true } })]);
  if (!base || !proc) throw badRequest("Unknown base card or process");
  const c = costing({ qty: b.qty, quote: 0, baseItem: base, processItem: proc });
  const quote = b.quote ?? Math.round(c.cost * 1.3);
  const j = await prisma.$transaction(async (tx) => {
    const id = await nextJobNo(tx);
    const j = await tx.jobWork.create({ data: { id, customerId: b.customerId, baseItemId: b.baseItemId, processItemId: b.processItemId, qty: b.qty, requiredBy: new Date(b.requiredBy), text: b.text, quote, status: "QUOTED", orderId: b.orderId ?? null, invoiceNo: b.invoiceNo ?? null }, include: inc });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Job work quoted", entityType: "Job", entityId: id, newValue: "₹" + quote });
    return j;
  });
  res.status(201).json(ser(j as never));
}));
// Printing cannot start without a recorded proof approval.
router.post("/:id/status", requirePerm("order.view"), asyncHandler(async (req, res) => {
  const { to, godownId } = z.object({ to: z.enum(JOB_STATUSES), godownId: z.string().optional() }).parse(req.body);
  const j = await prisma.jobWork.findUnique({ where: { id: req.params.id }, include: inc });
  if (!j) throw notFound();
  const cur = JOB_STATUSES.indexOf(j.status), nxt = JOB_STATUSES.indexOf(to);
  if (nxt !== cur + 1) throw badRequest(`Cannot move ${j.status} → ${to}`);
  if (to === "PRINTING" && j.status !== "APPROVED_PROOF") throw badRequest("Printing cannot start without a recorded proof approval");
  await prisma.$transaction(async (tx) => {
    if (to === "PRINTING") {
      // Base cards are drawn through a normal outward movement (qty + wastage).
      // A print run routinely needs more than any one godown holds, so draw from
      // the deepest first — the same split reserve() uses — unless the floor
      // names a godown, in which case that one has to cover the whole run.
      const c = costing(j as never);
      if (godownId) {
        await stock.issue(tx, j.baseItemId, godownId, c.baseCards, j.id, req.user!.name, "JOB_ISSUE");
      } else {
        const gds = await tx.godown.findMany({ where: { isActive: true } });
        const avail = await Promise.all(gds.map(async (g) => ({ g: g.id, a: await stock.availGodown(tx, j.baseItemId, g.id) })));
        avail.sort((x, y) => y.a - x.a);
        const total = avail.reduce((s, x) => s + x.a, 0);
        if (total < c.baseCards) throw badRequest(`${j.baseItem.sku}: ${c.baseCards} base cards needed for this run, only ${total} available across all godowns`);
        let left = c.baseCards;
        for (const x of avail) {
          if (left <= 0) break;
          const take = Math.min(x.a, left);
          if (take > 0) { await stock.issue(tx, j.baseItemId, x.g, take, j.id, req.user!.name, "JOB_ISSUE"); left -= take; }
        }
      }
    }
    await tx.jobWork.update({ where: { id: j.id }, data: { status: to, ...(to === "APPROVED_PROOF" ? { approvedAt: new Date() } : {}), ...(to === "PROOF_SENT" ? { proofs: { increment: 1 } } : {}) } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Job " + to.toLowerCase().replace(/_/g, " "), entityType: "Job", entityId: j.id, oldValue: j.status, newValue: to });
    if (to === "PROOF_SENT") await notify(tx, { text: `Proof sent for ${j.id} — waiting on ${j.customer.name}`, kind: "INFO", role: "SALES_EXECUTIVE" });
  });
  res.json({ ok: true });
}));

export default router;
