import { Prisma } from "@prisma/client";
import { invoiceTotals, ORDER_FLOW, type OrderStatus, M } from "@vivaha/shared";
import { prisma, D, type Db } from "../../db";
import * as stock from "../../services/stock";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextInvoiceNo, nextOrderNo } from "../../services/sequence";
import { gateFor } from "../../services/credit";
import { loadItemViews } from "../../services/items";
import { pricerFor } from "../../services/pricing";
import { getHomeState } from "../../services/settings";
import { badRequest, notFound, forbidden } from "../../utils/httpError";

export const orderInclude = {
  customer: { select: { id: true, name: true, contactName: true, tehsil: true, group: true, gstin: true, address: true, creditLimit: true, creditDays: true, gateMode: true, salesExecId: true, blockReason: true } },
  lines: { include: { item: { select: { id: true, sku: true, name: true, nameHi: true, uom: true, designNo: true, artSeed: true, lineId: true, imageUrl: true, landedCost: true } } } },
  events: { orderBy: { at: "asc" as const } },
  dispatches: { orderBy: { at: "asc" as const } },
  invoices: { include: { lines: { orderBy: { id: "asc" as const } } }, orderBy: { date: "asc" as const } },
} satisfies Prisma.OrderInclude;
export type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function serializeOrder(o: OrderFull) {
  return {
    ...o, subtotal: D(o.subtotal), tax: D(o.tax), total: D(o.total),
    customer: { ...o.customer, creditLimit: D(o.customer.creditLimit) },
    lines: o.lines.map((l) => ({ ...l, rate: D(l.rate), slabRate: D(l.slabRate), mult: D(l.mult), amount: D(l.amount), alloc: (l.alloc as Record<string, number>) || {}, item: { ...l.item, landedCost: undefined } })),
    dispatches: o.dispatches.map((d) => ({ ...d, freight: D(d.freight) })),
    invoices: o.invoices.map((i) => ({ ...i, taxable: D(i.taxable), cgst: D(i.cgst), sgst: D(i.sgst), igst: D(i.igst), total: D(i.total), lines: i.lines.map((l) => ({ ...l, rate: D(l.rate), amount: D(l.amount) })) })),
    backorder: o.lines.reduce((s, l) => s + (l.qty - l.shipped), 0),
  };
}

export async function getOrder(db: Db, id: string): Promise<OrderFull> {
  const o = await db.order.findUnique({ where: { id }, include: orderInclude });
  if (!o) throw notFound("Order not found");
  return o;
}

export async function transition(db: Db, o: { id: string; status: OrderStatus }, to: OrderStatus, by: string, why: string) {
  await db.order.update({ where: { id: o.id }, data: { status: to, ...(to !== "BOOKED" ? { holdUntil: null } : {}) } });
  await db.orderEvent.create({ data: { orderId: o.id, from: o.status, to, by, why } });
}

export interface Actor { id: string; name: string; role: string; perms: string[] }

export async function approve(o: OrderFull, actor: Actor, overrideReason: string | null) {
  if (o.status !== "BOOKED") throw badRequest("Only a Booked order can be approved");
  const g = await gateFor(o.customer, D(o.total));
  if (g.restricted) {
    if (o.customer.gateMode === "BLOCK" && !actor.perms.includes("credit.override")) throw forbidden(`Your role (${actor.role}) cannot override a BLOCK gate. An Accounts Manager or Super Admin must approve this order.`);
    if (!overrideReason || !overrideReason.trim()) throw badRequest("A reason is required to override the credit gate");
  }
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: o.id }, data: { approvedAt: new Date() } });
    await transition(tx, o, "APPROVED", actor.name, g.restricted ? "Credit gate overridden: " + overrideReason : "Credit and stock verified");
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Order approved", entityType: "Order", entityId: o.id, oldValue: "Booked", newValue: "Approved", reason: overrideReason ?? "" });
    if (g.restricted) await audit(tx, { userId: actor.id, actor: actor.name, action: "Credit gate overridden", entityType: "Customer", entityId: o.customer.name, oldValue: "Restricted", newValue: "Approved", reason: overrideReason! });
    await notify(tx, { text: `Order ${o.id} approved for ${o.customer.name}`, kind: "OK", role: "GODOWN_MANAGER", link: `/orders/${o.id}` });
  });
}

export async function reject(o: OrderFull, actor: Actor, reason: string) {
  if (o.status !== "BOOKED") throw badRequest("Only a Booked order can be rejected");
  await prisma.$transaction(async (tx) => {
    for (const l of o.lines) await stock.releaseHold(tx, l.itemId, l.alloc as stock.GodownMap, o.id, reason, actor.name);
    await transition(tx, o, "REJECTED", actor.name, reason);
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Order rejected", entityType: "Order", entityId: o.id, oldValue: "Booked", newValue: "Rejected", reason });
  });
}

export async function reserve(o: OrderFull, actor: Actor) {
  if (o.status !== "APPROVED") throw badRequest("Order must be Approved first");
  await prisma.$transaction(async (tx) => {
    for (const l of o.lines) {
      const map = l.alloc as stock.GodownMap;
      const held = Object.values(map).reduce((s, v) => s + v, 0);
      if (held < l.qty) {
        // Hold was partial/absent (e.g. office-assisted booking) — take what's needed now.
        const need = l.qty - held;
        const gds = await tx.godown.findMany({ where: { isActive: true } });
        const avail = await Promise.all(gds.map(async (g) => ({ g: g.id, a: await stock.availGodown(tx, l.itemId, g.id) })));
        avail.sort((a, b) => b.a - a.a);
        let left = need;
        for (const x of avail) { if (left <= 0) break; const take = Math.min(x.a, left); if (take > 0) { map[x.g] = (map[x.g] || 0) + take; left -= take; const r = await stock.tryHold(tx, l.itemId, { [x.g]: take }, o.id, actor.name); if (!r.ok) throw badRequest("Stock changed — re-check availability"); } }
        if (left > 0) throw badRequest(`Only ${l.qty - left} of ${l.qty} available for ${l.item.sku}`);
        await tx.orderLine.update({ where: { id: l.id }, data: { alloc: map } });
      }
      await stock.holdToReserved(tx, l.itemId, map, o.id, actor.name);
    }
    await transition(tx, o, "RESERVED", actor.name, "Temporary hold converted to firm reservation");
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Stock reserved", entityType: "Order", entityId: o.id, oldValue: "Hold", newValue: "Reserved" });
  });
}

export async function allocate(o: OrderFull, actor: Actor, alloc: Record<string, Record<string, number>>) {
  if (!["RESERVED", "ALLOCATED"].includes(o.status)) throw badRequest("Order must be Reserved before allocation");
  await prisma.$transaction(async (tx) => {
    for (const l of o.lines) {
      const nw = alloc[l.itemId] || {};
      const sum = Object.values(nw).reduce((s, v) => s + v, 0);
      if (sum !== l.qty) throw badRequest(`${l.item.sku}: every line must allocate to exactly its ordered quantity`);
      await stock.reallocateReserved(tx, l.itemId, l.alloc as stock.GodownMap, nw, o.id, actor.name);
      await tx.orderLine.update({ where: { id: l.id }, data: { alloc: nw } });
    }
    if (o.status === "RESERVED") await transition(tx, o, "ALLOCATED", actor.name, "Godown allocation confirmed");
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Godown allocation confirmed", entityType: "Order", entityId: o.id, newValue: "Split confirmed" });
  });
}

const STEP: Partial<Record<OrderStatus, { to: OrderStatus; why: string; perm: string }>> = {
  ALLOCATED: { to: "PICKING", why: "Pick list generated", perm: "order.pick" },
  PICKING: { to: "PICKED", why: "All lines picked", perm: "order.pick" },
  PICKED: { to: "PACKED", why: "Packed into boxes", perm: "order.pick" },
  PACKED: { to: "READY_TO_DISPATCH", why: "Staged at dispatch bay", perm: "order.pick" },
  DISPATCHED: { to: "DELIVERED", why: "Delivery confirmed", perm: "order.dispatch" },
};
export async function advance(o: OrderFull, actor: Actor, to: OrderStatus) {
  const s = STEP[o.status as OrderStatus];
  if (!s || s.to !== to) throw badRequest(`Cannot move ${o.status} → ${to}`);
  if (!actor.perms.includes(s.perm)) throw forbidden(`Requires ${s.perm}`);
  await prisma.$transaction(async (tx) => {
    await transition(tx, o, to, actor.name, s.why);
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Order " + to.toLowerCase().replace(/_/g, " "), entityType: "Order", entityId: o.id, oldValue: o.status, newValue: to, reason: s.why });
  });
}

// How the goods actually left.
//
// A transport company issues an LR and the consignment can be traced through
// it. A great deal of this trade does not work that way: the bundle is handed
// to the conductor of the evening bus, and there is no LR, no booking office
// and nobody to ring. What the customer needs then is the bus number, the
// driver's phone, the time it was loaded, and a photograph of the bundle
// actually on the bus — that is the consignment note, and it is recorded here
// rather than left in a WhatsApp thread nobody can find a week later.
export interface DispatchInput {
  ship: Record<string, number>;
  mode?: "TRANSPORT" | "BUS";
  transporter: string; lr?: string; tracking?: string; packages?: number; freight?: number; ewb?: string;
  busNo?: string; driverPhone?: string; loadedAt?: string; photos?: string[];
}
export async function dispatch(o: OrderFull, actor: Actor, inp: DispatchInput) {
  if (!["READY_TO_DISPATCH", "PARTIALLY_DISPATCHED"].includes(o.status)) throw badRequest("Order is not staged for dispatch");
  const mode = inp.mode ?? "TRANSPORT";
  // Each way of sending goods has one thing that must not be blank, because it
  // is the only handle anybody has on the consignment afterwards.
  if (mode === "TRANSPORT" && !inp.lr?.trim()) throw badRequest("A transporter consignment needs its LR number — it is the only way to trace it");
  if (mode === "BUS") {
    if (!inp.busNo?.trim()) throw badRequest("A bus consignment needs the bus number — there is no LR to trace it by");
    if (!inp.driverPhone?.trim()) throw badRequest("A bus consignment needs the driver or conductor's phone — the customer rings it to collect");
  }
  const homeState = await getHomeState();
  let any = false;
  for (const l of o.lines) { const q = inp.ship[l.itemId] ?? 0; if (q < 0 || q > l.qty - l.shipped) throw badRequest(`Cannot ship more than the outstanding quantity for ${l.item.sku}`); if (q > 0) any = true; }
  if (!any) throw badRequest("Enter at least one quantity to ship");
  return prisma.$transaction(async (tx) => {
    const shippedLines: { itemId: string; qty: number; godownId: string }[] = [];
    for (const l of o.lines) {
      const q = inp.ship[l.itemId] ?? 0; if (q <= 0) continue;
      const alloc = l.alloc as stock.GodownMap;
      // Ship from the allocated godowns in order, up to q.
      let left = q;
      for (const g of Object.keys(alloc)) { if (left <= 0) break; const take = Math.min(alloc[g], left); await stock.shipReserved(tx, l.itemId, { [g]: take }, o.id, actor.name); alloc[g] -= take; left -= take; shippedLines.push({ itemId: l.itemId, qty: take, godownId: g }); }
      if (left > 0) throw badRequest(`${l.item.sku}: only ${q - left} reserved across godowns`);
      await tx.orderLine.update({ where: { id: l.id }, data: { shipped: l.shipped + q, alloc } });
    }
    const invLines = o.lines.filter((l) => (inp.ship[l.itemId] ?? 0) > 0).map((l) => ({ l, qty: inp.ship[l.itemId], amount: inp.ship[l.itemId] * D(l.rate) }));

    // Printing taken with this order goes on the same bill as the cards.
    //
    // The customer gave the names at the counter when they booked; one bill for
    // the whole visit is what they expect, and two would have to be explained.
    // It is billed at the quote that was agreed, at the process item's own GST
    // rate — printing is a service and is not always taxed as the card is, and
    // invoiceTotals already groups rate-wise, so a mixed bill comes out right.
    //
    // Only jobs not already billed, and only once the customer has accepted
    // the quote.
    const jobs = await tx.jobWork.findMany({
      // An enquiry or a quote has not been agreed to and has no business on a
      // bill; everything from ACCEPTED onwards has.
      where: { orderId: o.id, invoiceNo: null, status: { notIn: ["ENQUIRY", "QUOTED"] } },
      include: { processItem: { select: { id: true, sku: true, name: true, hsn: true, gstPct: true } } },
    });
    const jobLines = jobs.map((j) => ({
      jobId: j.id, itemId: j.processItem.id,
      itemName: `${j.processItem.name} — ${j.id}`,
      sku: j.id, hsn: j.processItem.hsn, qty: j.qty,
      rate: j.qty > 0 ? Math.round((D(j.quote) / j.qty) * 100) / 100 : D(j.quote),
      amount: D(j.quote), gstPct: j.processItem.gstPct,
    }));

    const t = invoiceTotals(
      [...invLines.map((x) => ({ amount: x.amount, gstPct: x.l.gstPct })), ...jobLines.map((x) => ({ amount: x.amount, gstPct: x.gstPct }))],
      o.customer.gstin, homeState,
    );
    // An order is confined to one business line, so the invoice bills on that
    // line's own series and carries the line for the register to filter on.
    const lineId = o.lines[0]?.lineId;
    const series = await tx.businessLine.findUniqueOrThrow({ where: { id: lineId } });
    const no = await nextInvoiceNo(tx, series);
    await tx.invoice.create({ data: { no, lineId, orderId: o.id, customerId: o.customerId, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, blocks: t.blocks as unknown as Prisma.InputJsonValue, lines: { create: [
      ...invLines.map((x) => ({ itemId: x.l.itemId, itemName: x.l.item.name, sku: x.l.item.sku, hsn: x.l.hsn, qty: x.qty, rate: x.l.rate, amount: x.amount, gstPct: x.l.gstPct })),
      ...jobLines,
    ] } } });
    // The job now knows which bill it went on, so it can never be billed twice.
    if (jobs.length) await tx.jobWork.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { invoiceNo: no } });
    await tx.ledgerEntry.create({ data: { customerId: o.customerId, date: new Date(), type: "INVOICE", ref: no, particular: `Tax Invoice ${no} · ${o.id}`, debit: t.total, credit: 0 } });
    const d = await tx.dispatch.create({ data: {
      orderId: o.id, mode, transporter: inp.transporter, lr: inp.lr?.trim() ?? "", tracking: inp.tracking ?? "",
      packages: inp.packages ?? 1, freight: inp.freight ?? 0, ewb: inp.ewb ?? null,
      busNo: inp.busNo?.trim() ?? "", driverPhone: inp.driverPhone?.trim() ?? "",
      loadedAt: inp.loadedAt ? new Date(inp.loadedAt) : mode === "BUS" ? new Date() : null,
      photos: inp.photos ?? [],
      lines: shippedLines, invoiceNo: no, by: actor.name,
    } });
    const fresh = await tx.orderLine.findMany({ where: { orderId: o.id } });
    const full = fresh.every((l) => l.shipped >= l.qty);
    const how = mode === "BUS" ? `on bus ${inp.busNo!.trim()}` : `via ${inp.transporter}, LR ${inp.lr!.trim()}`;
    await transition(tx, o, full ? "DISPATCHED" : "PARTIALLY_DISPATCHED", actor.name, `Dispatched ${how}`);
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Order dispatched", entityType: "Order", entityId: o.id, oldValue: o.status, newValue: full ? "Dispatched" : "Partially Dispatched", reason: `Invoice ${no} for ₹${t.total.toFixed(2)}` });
    await notify(tx, { text: `Order ${o.id} dispatched to ${o.customer.name} — ${how}`, kind: "OK", role: "SALES_EXECUTIVE", link: `/orders/${o.id}` });
    return { invoiceNo: no, total: t.total, full, dispatchId: d.id };
  });
}

export async function revive(o: OrderFull, actor: Actor) {
  if (o.status !== "LAPSED") throw badRequest("Only a Lapsed order can be revived");
  const line = await prisma.businessLine.findUnique({ where: { id: o.lines[0].lineId } });
  await prisma.$transaction(async (tx) => {
    for (const l of o.lines) if ((await stock.availAll(tx, l.itemId)) < l.qty) throw badRequest("Stock no longer available at the original quantity");
    for (const l of o.lines) {
      const map = l.alloc as stock.GodownMap;
      const r = await stock.tryHold(tx, l.itemId, map, o.id, actor.name);
      if (!r.ok) {
        // original godown split no longer works — re-split by availability
        const gds = await tx.godown.findMany({ where: { isActive: true } });
        const avail = await Promise.all(gds.map(async (g) => ({ g: g.id, a: await stock.availGodown(tx, l.itemId, g.id) })));
        avail.sort((a, b) => b.a - a.a);
        const nm: stock.GodownMap = {}; let left = l.qty;
        for (const x of avail) { if (left <= 0) break; const take = Math.min(x.a, left); if (take > 0) { nm[x.g] = take; left -= take; } }
        const r2 = await stock.tryHold(tx, l.itemId, nm, o.id, actor.name); if (!r2.ok) throw badRequest("Stock changed — try again");
        await tx.orderLine.update({ where: { id: l.id }, data: { alloc: nm } });
      }
    }
    await tx.order.update({ where: { id: o.id }, data: { holdUntil: new Date(Date.now() + (line?.holdMins ?? 30) * 60_000) } });
    await transition(tx, o, "BOOKED", actor.name, "Revived by office — original rate snapshot retained");
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Lapsed order revived", entityType: "Order", entityId: o.id, oldValue: "Lapsed", newValue: "Booked", reason: "Stock re-held at original rates" });
  });
}

export async function cancel(o: OrderFull, actor: Actor, reason: string) {
  if (!["BOOKED", "APPROVED", "RESERVED", "ALLOCATED"].includes(o.status)) throw badRequest("Order can no longer be cancelled — it is already in picking or shipped");
  await prisma.$transaction(async (tx) => {
    for (const l of o.lines) {
      const map = l.alloc as stock.GodownMap;
      if (["BOOKED", "APPROVED"].includes(o.status)) await stock.releaseHold(tx, l.itemId, map, o.id, reason, actor.name);
      else await stock.releaseReserved(tx, l.itemId, map, o.id, reason, actor.name);
    }
    await transition(tx, o, "CANCELLED", actor.name, reason);
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Order cancelled", entityType: "Order", entityId: o.id, oldValue: o.status, newValue: "Cancelled", reason });
  });
}

export const flowIndex = (s: OrderStatus) => ORDER_FLOW.indexOf(s);

// ── Office-raised orders ────────────────────────────────────────────────────
// Most bookings arrive from the wholesale portal, but plenty do not: the firm
// telephones, walks in, or hands a list to its sales executive. Those orders are
// keyed here. The pricing, credit gate and stock hold are exactly the portal's —
// only the entry point differs, so an assisted order cannot be priced or gated
// on softer terms than a self-service one.

export interface NewOrderLine { itemId: string; qty: number }
export interface NewOrderInput { customerId: string; lines: NewOrderLine[]; requiredBy?: string; note?: string; overrideReason?: string }

export interface QuoteLine {
  itemId: string; sku: string; designNo: string | null; name: string; nameHi: string; lineId: string; uom: string;
  artSeed: number; imageUrl: string | null; qty: number; moq: number; available: number;
  rate: number; slabRate: number; mult: number; priceSrc: string; amount: number; gstPct: number; hsn: string;
  short: boolean; belowMoq: boolean;
}

// Priced, stock-checked and credit-checked, but nothing is written. The modal
// re-quotes on every change so the operator sees the real number — and the real
// shortfall — before committing.
export async function quoteOrder(input: { customerId: string; lines: NewOrderLine[] }) {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw notFound(M.firmNotFound());
  const wanted = input.lines.filter((l) => l.qty > 0);
  const [price, homeState] = await Promise.all([pricerFor(customer), getHomeState()]);
  const views = wanted.length ? await loadItemViews({ id: { in: wanted.map((l) => l.itemId) } }) : [];

  const lines: QuoteLine[] = [];
  for (const w of wanted) {
    const it = views.find((v) => v.id === w.itemId);
    if (!it) throw badRequest("Item not found");
    const pr = price(it, w.qty);
    lines.push({
      itemId: it.id, sku: it.sku, designNo: it.designNo, name: it.name, nameHi: it.nameHi, lineId: it.lineId, uom: it.uom,
      artSeed: it.artSeed, imageUrl: it.imageUrl, qty: w.qty, moq: it.moq, available: it.available,
      rate: pr.rate, slabRate: pr.slab, mult: pr.mult, priceSrc: pr.src, amount: pr.rate * w.qty, gstPct: it.gstPct, hsn: it.hsn,
      short: w.qty > it.available, belowMoq: w.qty < it.moq,
    });
  }
  const totals = invoiceTotals(lines, customer.gstin, homeState);
  const gate = await gateFor(customer, totals.total);
  const lineIds = [...new Set(lines.map((l) => l.lineId))];
  return {
    customer: { id: customer.id, name: customer.name, contactName: customer.contactName, group: customer.group, gstin: customer.gstin, tehsil: customer.tehsil, blockReason: customer.blockReason, gateMode: customer.gateMode, linesEnabled: customer.linesEnabled as string[] },
    lines, totals, gate, lineIds,
  };
}

export async function createOrder(input: NewOrderInput, actor: Actor): Promise<OrderFull> {
  const q = await quoteOrder(input);
  if (!q.lines.length) throw badRequest(M.addAnItem());
  if (q.customer.blockReason) throw badRequest(M.firmBlocked(q.customer.name, q.customer.blockReason));

  // One business line per order, the way a purchase invoice is one line: the
  // hold window and the dispatch queue are both per line, so a mixed order
  // would inherit whichever line happened to sort first.
  if (q.lineIds.length > 1) throw badRequest(M.oneLinePerOrder());

  // Job work is quoted and produced, not sold off the shelf: it has its own
  // model and screen, carries no stock, and its line is configured with no hold
  // window. Checked before the stock and MOQ guards, which would otherwise
  // report "0 available" and send the operator hunting for stock that will
  // never exist.
  const line = await prisma.businessLine.findUniqueOrThrow({ where: { id: q.lineIds[0] } });
  if (line.workflow === "JOBWORK") throw badRequest(M.jobWorkNotStock(line.name));

  const short = q.lines.find((l) => l.short);
  if (short) throw badRequest(M.onlyAvailable(short.available, short.sku));
  const below = q.lines.find((l) => l.belowMoq);
  if (below) throw badRequest(M.belowMoq(below.sku, below.moq));

  // Same rule the approval screen applies: a BLOCK gate needs credit.override,
  // and any restricted gate needs a reason on the record.
  if (q.gate.restricted) {
    if (q.customer.gateMode === "BLOCK" && !actor.perms.includes("credit.override")) throw forbidden(M.creditBlocked(q.customer.name, actor.role));
    if (!input.overrideReason?.trim()) throw badRequest(M.creditReasonNeeded());
  }

  const bookedBy = `${actor.name} (assisted)`;
  const orderId = await prisma.$transaction(async (tx) => {
    const id = await nextOrderNo(tx);
    const gds = await tx.godown.findMany({ where: { isActive: true } });
    const lineData = [];
    for (const l of q.lines) {
      // Deepest godown first, same split reserve() and the portal both use.
      const avail = await Promise.all(gds.map(async (g) => ({ g: g.id, a: await stock.availGodown(tx, l.itemId, g.id) })));
      avail.sort((a, b) => b.a - a.a);
      const map: stock.GodownMap = {}; let need = l.qty;
      for (const x of avail) { if (need <= 0) break; const take = Math.min(x.a, need); if (take > 0) { map[x.g] = take; need -= take; } }
      if (need > 0) throw badRequest(M.stockMoved(l.sku, need));
      const r = await stock.tryHold(tx, l.itemId, map, id, bookedBy);
      if (!r.ok) throw badRequest(M.stockMovedRecheck(l.sku));
      lineData.push({ itemId: l.itemId, lineId: l.lineId, qty: l.qty, rate: l.rate, slabRate: l.slabRate, mult: l.mult, priceSrc: l.priceSrc, amount: l.amount, gstPct: l.gstPct, hsn: l.hsn, alloc: map });
    }
    const why = input.note?.trim() ? `Booked at the office — ${input.note.trim()}` : "Booked at the office";
    await tx.order.create({ data: {
      id, customerId: q.customer.id, status: "BOOKED",
      subtotal: q.totals.taxable, tax: q.totals.tax, total: q.totals.total,
      requiredBy: input.requiredBy ? new Date(input.requiredBy) : new Date(Date.now() + 14 * 864e5),
      // A zero hold window means the line does not hold stock at all. Writing
      // `now` would leave an order the sweeper lapses on its next pass.
      holdUntil: line.holdMins > 0 ? new Date(Date.now() + line.holdMins * 60_000) : null,
      bookedBy, source: "office",
      lines: { create: lineData },
      events: { create: { from: null, to: "BOOKED", by: bookedBy, why } },
    } });
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Order booked at the office", entityType: "Order", entityId: id, newValue: "₹" + q.totals.total.toFixed(2), reason: input.overrideReason?.trim() || input.note?.trim() || "" });
    if (q.gate.restricted) await audit(tx, { userId: actor.id, actor: actor.name, action: "Order booked past the credit gate", entityType: "Customer", entityId: q.customer.name, oldValue: "Restricted", newValue: "Booked", reason: input.overrideReason!.trim() });
    const text = `Order ${id} booked for ${q.customer.name} by ${actor.name} — ₹${q.totals.total.toLocaleString("en-IN")}${q.gate.restricted ? " · credit warning" : ""}`;
    await notify(tx, { text, kind: q.gate.restricted ? "WARN" : "OK", role: "SALES_EXECUTIVE", link: `/orders/${id}` });
    return id;
  });
  return getOrder(prisma, orderId);
}

// The item list the office picks from, priced for the firm that is buying —
// the same rate the firm would have seen in its own portal, so a phoned-in
// order and a self-service one quote alike.
// Abandoned carts are the portal's own Cart rows, which nobody in the office
// could see. A firm that filled a basket and stopped is the warmest lead there
// is, so the office gets the same view and can ring them.
export async function abandonedCarts() {
  const carts = await prisma.cart.findMany({
    include: {
      customer: {
        select: {
          id: true, name: true, tehsil: true, phone: true, group: true,
          salesExec: { select: { name: true } },
          contacts: { select: { id: true, name: true, role: true, phone: true } },
          recoveries: { orderBy: { at: "desc" }, take: 5 },
          // Anything ordered since tells us whether chasing worked.
          orders: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true, total: true, status: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const out = [];
  for (const cart of carts) {
    const lines = (cart.lines as { itemId: string; qty: number }[]) || [];
    if (!lines.length) continue;
    const price = await pricerFor(cart.customer as unknown as { id: string; group: string });
    const views = await loadItemViews({ id: { in: lines.map((l) => l.itemId) } });
    let value = 0;
    const rows = lines.map((l) => {
      const it = views.find((v) => v.id === l.itemId);
      const rate = it ? price(it, l.qty).rate : 0;
      value += rate * l.qty;
      return {
        itemId: l.itemId, sku: it?.sku ?? l.itemId, name: it?.name ?? "—", qty: l.qty, rate,
        amount: rate * l.qty, available: it?.available ?? 0,
        short: it ? l.qty > it.available : false,
        // A basket can go stale: an item discontinued, or gone since they filled it.
        gone: !it || it.status !== "ACTIVE",
      };
    });

    const recoveries = cart.customer.recoveries;
    const lastChase = recoveries[0] ?? null;
    const lastOrder = cart.customer.orders[0] ?? null;
    // Chased, and then they ordered: that is a recovery, and it is the only
    // number that says whether any of this is worth doing.
    const recovered = !!(lastChase && lastOrder && lastOrder.createdAt > lastChase.at);

    out.push({
      customer: { ...cart.customer, recoveries: undefined, orders: undefined },
      contacts: cart.customer.contacts,
      updatedAt: cart.updatedAt,
      ageDays: Math.floor((Date.now() - cart.updatedAt.getTime()) / 864e5),
      lines: rows, count: rows.length, value,
      // A basket nobody can actually fulfil should not be chased as if they can.
      issues: rows.filter((r) => r.short || r.gone).length,
      chases: recoveries.length,
      lastChase: lastChase ? { at: lastChase.at, by: lastChase.by, channel: lastChase.channel, toName: lastChase.toName, note: lastChase.note } : null,
      recovered,
      recoveredOrder: recovered ? lastOrder : null,
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

// Records that somebody chased this basket. The message itself goes out through
// WhatsApp the same way a bill does — opened ready-addressed, sent by a person.
// This is the note that stops the next executive ringing the same firm an hour
// later, and the thing a conversion is measured against.
export async function recordChase(
  customerId: string,
  by: string,
  input: { channel?: string; toName?: string; toPhone?: string; note?: string },
) {
  const cart = await prisma.cart.findUnique({ where: { customerId } });
  const lines = ((cart?.lines as { itemId: string; qty: number }[]) || []);
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const price = await pricerFor(customer);
  const views = lines.length ? await loadItemViews({ id: { in: lines.map((l) => l.itemId) } }) : [];
  const value = lines.reduce((s, l) => {
    const it = views.find((v) => v.id === l.itemId);
    return s + (it ? price(it, l.qty).rate * l.qty : 0);
  }, 0);

  const row = await prisma.cartRecovery.create({
    data: {
      customerId, by,
      channel: input.channel ?? "WHATSAPP",
      toName: input.toName ?? "", toPhone: input.toPhone ?? "", note: input.note ?? "",
      cartValue: value, cartCount: lines.length,
    },
  });
  await audit(prisma, { actor: by, action: "Abandoned basket chased", entityType: "Customer", entityId: customer.name, newValue: `${input.channel ?? "WHATSAPP"} · ₹${value.toFixed(2)} in the basket`, reason: input.note ?? "" });
  return row;
}

export async function orderCatalogue(customerId: string, lineId?: string, q?: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw notFound(M.firmNotFound());
  const price = await pricerFor(customer);
  if (lineId && lineId !== "ALL") {
    const l = await prisma.businessLine.findUnique({ where: { id: lineId } });
    if (l?.workflow === "JOBWORK") throw badRequest(M.jobWorkNotStock(l.name));
  }
  const where: Prisma.ItemWhereInput = {
    status: "ACTIVE",
    // Job-work items carry no stock, so they can never satisfy an order.
    line: { workflow: "FULFIL" },
    ...(lineId && lineId !== "ALL" ? { lineId } : {}),
    ...(q ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { designNo: { contains: q, mode: "insensitive" } }, { codes: { some: { code: { contains: q, mode: "insensitive" } } } }] } : {}),
  };
  const items = await loadItemViews(where);
  return {
    linesEnabled: customer.linesEnabled as string[],
    items: items.map((i) => ({
      id: i.id, sku: i.sku, designNo: i.designNo, name: i.name, nameHi: i.nameHi, lineId: i.lineId,
      uom: i.uom, moq: i.moq, available: i.available, band: i.band, gstPct: i.gstPct,
      artSeed: i.artSeed, imageUrl: i.imageUrl, code: i.code,
      rate: price(i, i.moq).rate,
    })),
  };
}
