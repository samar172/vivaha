import { Prisma } from "@prisma/client";
import { invoiceTotals, ORDER_FLOW, type OrderStatus } from "@vivaha/shared";
import { prisma, D, type Db } from "../../db";
import * as stock from "../../services/stock";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextInvoiceNo } from "../../services/sequence";
import { gateFor } from "../../services/credit";
import { getHomeState } from "../../services/settings";
import { badRequest, notFound, forbidden } from "../../utils/httpError";

export const orderInclude = {
  customer: { select: { id: true, name: true, contactName: true, tehsil: true, group: true, gstin: true, address: true, creditLimit: true, creditDays: true, gateMode: true, salesExecId: true, blockReason: true } },
  lines: { include: { item: { select: { id: true, sku: true, name: true, nameHi: true, uom: true, designNo: true, artSeed: true, lineId: true, imageUrl: true, landedCost: true } } } },
  events: { orderBy: { at: "asc" as const } },
  dispatches: { orderBy: { at: "asc" as const } },
  invoices: { include: { lines: true }, orderBy: { date: "asc" as const } },
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
    await notify(tx, { text: `Order ${o.id} approved for ${o.customer.name}`, kind: "OK", role: "GODOWN_MANAGER", link: `/orders?open=${o.id}` });
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

export interface DispatchInput { ship: Record<string, number>; transporter: string; lr: string; tracking?: string; packages?: number; freight?: number; ewb?: string }
export async function dispatch(o: OrderFull, actor: Actor, inp: DispatchInput) {
  if (!["READY_TO_DISPATCH", "PARTIALLY_DISPATCHED"].includes(o.status)) throw badRequest("Order is not staged for dispatch");
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
    const t = invoiceTotals(invLines.map((x) => ({ amount: x.amount, gstPct: x.l.gstPct })), o.customer.gstin, homeState);
    const no = await nextInvoiceNo(tx);
    await tx.invoice.create({ data: { no, orderId: o.id, customerId: o.customerId, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, blocks: t.blocks as unknown as Prisma.InputJsonValue, lines: { create: invLines.map((x) => ({ itemId: x.l.itemId, itemName: x.l.item.name, sku: x.l.item.sku, hsn: x.l.hsn, qty: x.qty, rate: x.l.rate, amount: x.amount, gstPct: x.l.gstPct })) } } });
    await tx.ledgerEntry.create({ data: { customerId: o.customerId, date: new Date(), type: "INVOICE", ref: no, particular: `Tax Invoice ${no} · ${o.id}`, debit: t.total, credit: 0 } });
    const d = await tx.dispatch.create({ data: { orderId: o.id, transporter: inp.transporter, lr: inp.lr, tracking: inp.tracking ?? "", packages: inp.packages ?? 1, freight: inp.freight ?? 0, ewb: inp.ewb ?? null, lines: shippedLines, invoiceNo: no, by: actor.name } });
    const fresh = await tx.orderLine.findMany({ where: { orderId: o.id } });
    const full = fresh.every((l) => l.shipped >= l.qty);
    await transition(tx, o, full ? "DISPATCHED" : "PARTIALLY_DISPATCHED", actor.name, `Dispatched via ${inp.transporter}, LR ${inp.lr}`);
    await audit(tx, { userId: actor.id, actor: actor.name, action: "Order dispatched", entityType: "Order", entityId: o.id, oldValue: o.status, newValue: full ? "Dispatched" : "Partially Dispatched", reason: `Invoice ${no} for ₹${t.total.toFixed(2)}` });
    await notify(tx, { text: `Order ${o.id} dispatched to ${o.customer.name} — LR ${inp.lr}`, kind: "OK", role: "SALES_EXECUTIVE", link: `/orders?open=${o.id}` });
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
