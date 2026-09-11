import { Router } from "express";
import { z } from "zod";
import { invoiceTotals, rankAlternates, nextSlab, ledgerWithBalance, ageing, creditGate, ORDER_STATUS_HI, type OrderStatus } from "@vivaha/shared";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { loadItemViews, loadItemView, type ItemView } from "../../services/items";
import { pricerFor } from "../../services/pricing";
import { ledgerLines } from "../../services/credit";
import * as stock from "../../services/stock";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextOrderNo, nextReturnNo, nextReferralNo } from "../../services/sequence";
import { getHomeState } from "../../services/settings";
import { badRequest, notFound } from "../../utils/httpError";
import { recordFix, validFix } from "../../services/geo";

const router = Router();

async function me(req: { user?: { customerId: string | null } }) {
  const c = await prisma.customer.findUnique({ where: { id: req.user!.customerId! }, include: { machines: true, salesExec: { select: { id: true, name: true } } } });
  if (!c) throw notFound("Firm not found");
  return c;
}
type Cust = Awaited<ReturnType<typeof me>>;
async function gate(c: Cust, orderValue = 0) {
  return creditGate({ creditLimit: D(c.creditLimit), creditDays: c.creditDays, gateMode: c.gateMode }, await ledgerLines(c.id), orderValue);
}
const pub = (i: ItemView, rate: number) => ({ id: i.id, sku: i.sku, designNo: i.designNo, name: i.name, nameHi: i.nameHi, lineId: i.lineId, attrs: i.attrs, uom: i.uom, packUom: i.packUom, perPack: i.perPack, moq: i.moq, gstPct: i.gstPct, artSeed: i.artSeed, imageUrl: i.imageUrl, images: i.images, band: i.band, rate, status: i.status });

// Job work is quoted with the office, not bought off the shelf, and the portal
// has no flow for it — offering it in the line switcher only leads to a
// catalogue where every item reads "0 available".
router.get("/me", asyncHandler(async (req, res) => {
  const c = await me(req);
  const [g, lines, cart, kit] = await Promise.all([gate(c), prisma.businessLine.findMany({ where: { id: { in: c.linesEnabled as string[] }, isActive: true, workflow: "FULFIL" }, orderBy: { sortOrder: "asc" } }), prisma.cart.findUnique({ where: { customerId: c.id } }), prisma.kit.findUnique({ where: { customerId: c.id } })]);
  res.json({ firm: { ...c, creditLimit: D(c.creditLimit), machines: c.machines }, gate: g, lines, cartCount: ((cart?.lines as unknown[]) || []).length, kit });
}));

// The firm checking in. Sent once when the portal is opened, if the browser
// grants permission — one fix on a press, never a watch, and a refusal is an
// ordinary outcome that changes nothing. It answers the office's question of
// where a firm actually was when it last ordered.
// A tap on a banner. The only signal these carry, and the office can see it
// against the impressions on the Banners screen.
router.post("/ads/:id/tap", asyncHandler(async (req, res) => {
  await me(req);
  await prisma.ad.updateMany({ where: { id: req.params.id }, data: { taps: { increment: 1 } } });
  res.status(204).send();
}));

router.post("/checkin", asyncHandler(async (req, res) => {
  const c = await me(req);
  const b = z.object({ lat: z.number(), lng: z.number(), accuracy: z.number().nonnegative().optional() }).parse(req.body);
  if (!validFix(b)) throw badRequest("That is not a usable location");
  await recordFix(prisma, c.id, { lat: b.lat, lng: b.lng, accuracy: b.accuracy ?? null }, "PORTAL_CHECKIN", c.contactName);
  res.status(201).json({ ok: true });
}));

router.get("/home", asyncHandler(async (req, res) => {
  const c = await me(req);
  const lineId = String(req.query.line || (c.linesEnabled as string[])[0]);
  const price = await pricerFor(c);
  const [items, last, ads, hits] = await Promise.all([
    loadItemViews({ lineId, status: "ACTIVE" }),
    prisma.order.findFirst({ where: { customerId: c.id }, orderBy: { createdAt: "desc" }, include: { lines: { include: { item: true } } } }),
    prisma.ad.findMany({
      where: {
        isActive: true,
        // A banner targeted at a line is only for firms reading that line, and
        // a seasonal one only runs inside its dates. Both sides optional.
        OR: [{ lineId: null }, { lineId }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: { item: { select: { id: true, sku: true } } },
    }),
    districtHits(c, 3),
  ]);
  const machineTypes = c.machines.map((m) => m.type);
  // The office's own ordering decides, because it is the office that knows what
  // this season needs pushed. Machine targeting only breaks a tie within the
  // same position — otherwise a banner seeded years ago with a machine rule
  // would quietly outrank whatever the office just put first.
  const machineMatch = (a: (typeof ads)[number]) => {
    const t = a.target as { machine?: string; noMachine?: string };
    return (t.noMachine && !machineTypes.includes(t.noMachine)) || (t.machine && machineTypes.includes(t.machine)) ? 1 : 0;
  };
  const ad = [...ads].sort((a, b) => a.sortOrder - b.sortOrder || machineMatch(b) - machineMatch(a) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  if (ad) await prisma.ad.update({ where: { id: ad.id }, data: { impressions: { increment: 1 } } });
  let nudge: unknown = null;
  if ((c.linesEnabled as string[]).includes("L2") && c.machines.length) {
    const m = c.machines.find((x) => x.type === "Offset"); const spec = (m?.spec as Record<string, string>) || {};
    const cons = await loadItemViews({ line: { code: "consumables" }, status: "ACTIVE" });
    const it = cons.find((i) => i.attrs.brand === (spec.ink || "SGL")) || cons[0];
    if (it) { const q = spec.colours === "4" ? 20 : 10; nudge = { item: pub(it, price(it, q).rate), qty: q, amount: price(it, q).rate * q, machine: m ? `${spec.company} · ${spec.colours} colour` : null }; }
  }
  res.json({
    reorder: last ? { orderId: last.id, lines: last.lines.map((l) => ({ item: { id: l.item.id, sku: l.item.sku, designNo: l.item.designNo, name: l.item.name, uom: l.item.uom, artSeed: l.item.artSeed, lineId: l.item.lineId, imageUrl: l.item.imageUrl }, qty: l.qty })) } : null,
    nudge, ad, newItems: items.slice(0, 6).map((i) => pub(i, price(i, i.moq).rate)), hits,
  });
}));

router.get("/catalogue", asyncHandler(async (req, res) => {
  const c = await me(req);
  const q = z.object({ line: z.string(), q: z.string().optional(), facet: z.string().optional(), value: z.string().optional() }).parse(req.query);
  if (!(c.linesEnabled as string[]).includes(q.line)) throw badRequest("Line not enabled for this firm");
  const [line, price] = await Promise.all([prisma.businessLine.findUniqueOrThrow({ where: { id: q.line } }), pricerFor(c)]);
  let items = await loadItemViews({ lineId: q.line, status: "ACTIVE" });
  const facet = (line.facets as string[])[0];
  const values = [...new Set(items.map((i) => i.attrs[facet]).filter(Boolean))];
  if (q.value && q.value !== "ALL") items = items.filter((i) => i.attrs[facet] === q.value);
  if (q.q) { const s = q.q.toLowerCase(); items = items.filter((i) => (i.sku + (i.designNo || "") + i.name + i.nameHi).toLowerCase().includes(s)); }
  res.json({ facet, values, items: items.map((i) => pub(i, price(i, i.moq).rate)) });
}));

router.get("/scan", asyncHandler(async (req, res) => {
  const c = await me(req);
  const q = String(req.query.q || "").trim().toLowerCase();
  const price = await pricerFor(c);
  let items = await loadItemViews({ status: "ACTIVE", lineId: { in: c.linesEnabled as string[] } });
  if (q === "__random__") { const lineId = String(req.query.line || (c.linesEnabled as string[])[0]); const pool = items.filter((i) => i.lineId === lineId); items = pool.length ? [pool[Math.floor(Math.random() * pool.length)]] : []; }
  else if (q.length < 2) items = [];
  else {
    // A retailer scanning a carton may read either label — the code we print or
    // the manufacturer's, which we keep on file precisely so this still works.
    const byCode = await prisma.itemCode.findMany({ where: { code: { contains: q, mode: "insensitive" } }, select: { itemId: true } });
    const codeHits = new Set(byCode.map((x) => x.itemId));
    items = items.filter((i) => codeHits.has(i.id) || (i.sku + (i.designNo || "") + i.name + i.nameHi).toLowerCase().includes(q)).slice(0, 5);
  }
  res.json(items.map((i) => pub(i, price(i, i.moq).rate)));
}));

// "Tell me when it's back." Marks the short search the firm just made, so the
// sweeper can raise a callback the moment there is enough stock to cover what
// they actually asked for.
router.post("/notify-me", asyncHandler(async (req, res) => {
  const c = await me(req);
  const b = z.object({ itemId: z.string(), qty: z.number().int().positive() }).parse(req.body);
  const it = await loadItemView(b.itemId);
  if (!it || !(c.linesEnabled as string[]).includes(it.lineId)) throw notFound("Item not found");
  // The short search is already on record from the sheet; mark the most recent
  // one rather than writing a second row that would double-count the demand.
  const last = await prisma.stockoutSearch.findFirst({
    where: { customerId: c.id, itemId: b.itemId, notifiedAt: null },
    orderBy: { at: "desc" },
  });
  if (last) await prisma.stockoutSearch.update({ where: { id: last.id }, data: { notifyWanted: true, reqQty: Math.max(last.reqQty, b.qty) } });
  else await prisma.stockoutSearch.create({ data: { itemId: b.itemId, customerId: c.id, reqQty: b.qty, availQty: it.available, notifyWanted: true } });
  res.status(201).json({ ok: true, reqQty: b.qty });
}));

// What this firm is waiting on, and what has already come back for them.
router.get("/waiting", asyncHandler(async (req, res) => {
  const c = await me(req);
  const rows = await prisma.stockoutSearch.findMany({
    where: { customerId: c.id, notifyWanted: true },
    include: { item: { select: { id: true, sku: true, designNo: true, name: true, nameHi: true, uom: true, artSeed: true, lineId: true, imageUrl: true } } },
    orderBy: { at: "desc" }, take: 20,
  });
  const out = [];
  for (const r of rows) {
    const avail = await stock.availAll(prisma, r.itemId);
    out.push({ id: r.id, item: r.item, reqQty: r.reqQty, available: avail, back: avail >= r.reqQty, askedAt: r.at, notifiedAt: r.notifiedAt });
  }
  res.json(out);
}));

router.get("/items/:id", asyncHandler(async (req, res) => {
  const c = await me(req);
  const qty = Number(req.query.qty || 0);
  const it = await loadItemView(req.params.id);
  if (!it || !(c.linesEnabled as string[]).includes(it.lineId)) throw notFound("Item not found");
  const price = await pricerFor(c);
  const pr = price(it, Math.max(qty, it.moq));
  const open = await prisma.order.findMany({ where: { customerId: c.id, status: "BOOKED", lines: { some: { itemId: it.id } } }, include: { lines: { where: { itemId: it.id } } } });
  let alternates: unknown[] = [];
  const short = qty > it.band.qty;
  if (short && qty > 0) {
    await prisma.stockoutSearch.create({ data: { itemId: it.id, customerId: c.id, reqQty: qty, availQty: it.band.qty } });
    const returned = (await prisma.returnRequest.findMany({ where: { customerId: c.id }, select: { itemId: true } })).map((r) => r.itemId);
    const cands = (await loadItemViews({ lineId: it.lineId, status: "ACTIVE" })).filter((x) => x.id !== it.id);
    const ranked = rankAlternates({ id: it.id, lineId: it.lineId, attrs: it.attrs, uom: it.uom, landedCost: it.landedCost, available: it.available, rate: pr.rate }, cands.map((x) => ({ id: x.id, lineId: x.lineId, attrs: x.attrs, uom: x.uom, landedCost: x.landedCost, available: x.available, rate: price(x, Math.min(qty, x.available)).rate })), qty, returned);
    alternates = ranked.map((r) => { const x = cands.find((y) => y.id === r.id)!; return { item: pub(x, r.rate), avail: r.avail, rate: r.rate, score: r.score }; });
  }
  const ns = nextSlab(it.slabs, qty);
  res.json({
    item: pub(it, pr.rate), price: { rate: pr.rate, src: pr.src, mult: pr.mult }, slabs: it.slabs.map((s) => ({ ...s, customerRate: Math.round(s.rate * pr.mult) })),
    nextSlab: ns && qty > 0 ? { addQty: ns.fromQty - qty, rate: Math.round(ns.rate * pr.mult), save: (pr.rate - Math.round(ns.rate * pr.mult)) * ns.fromQty } : null,
    openBookings: open.map((o) => ({ orderId: o.id, qty: o.lines[0]?.qty ?? 0, createdAt: o.createdAt, holdUntil: o.holdUntil })),
    alternates, short, available: it.band.qty,
  });
}));

async function loadCart(c: Cust) {
  const cart = await prisma.cart.findUnique({ where: { customerId: c.id } });
  return ((cart?.lines as { itemId: string; qty: number }[]) || []);
}
async function saveCart(c: Cust, lines: { itemId: string; qty: number }[]) {
  await prisma.cart.upsert({ where: { customerId: c.id }, create: { customerId: c.id, lines }, update: { lines } });
}
async function cartView(c: Cust) {
  const ls = await loadCart(c);
  const ids = ls.map((l) => l.itemId);
  const [items, price, homeState] = await Promise.all([loadItemViews({ id: { in: ids } }), pricerFor(c), getHomeState()]);
  const im = Object.fromEntries(items.map((i) => [i.id, i]));
  const lines = ls.filter((l) => im[l.itemId]).map((l) => { const it = im[l.itemId]; const pr = price(it, l.qty); return { item: pub(it, pr.rate), qty: l.qty, rate: pr.rate, amount: pr.rate * l.qty, gstPct: it.gstPct, available: it.available }; });
  const t = invoiceTotals(lines, c.gstin, homeState);
  const g = await gate(c, t.total);
  const byLine: Record<string, { sub: number; gstPct: number }> = {};
  for (const l of lines) { const b = (byLine[l.item.lineId] = byLine[l.item.lineId] || { sub: 0, gstPct: l.gstPct }); b.sub += l.amount; }
  return { lines, totals: t, gate: g, byLine, count: lines.length };
}
router.get("/cart", asyncHandler(async (req, res) => res.json(await cartView(await me(req)))));
router.post("/cart", asyncHandler(async (req, res) => {
  const c = await me(req);
  const b = z.object({ itemId: z.string(), qty: z.number().int(), mode: z.enum(["add", "set"]).default("add") }).parse(req.body);
  const it = await loadItemView(b.itemId); if (!it) throw notFound("Item not found");
  const ls = await loadCart(c); const ex = ls.find((l) => l.itemId === b.itemId);
  const nq = b.mode === "add" ? (ex?.qty ?? 0) + b.qty : b.qty;
  // "Out of stock" ends the conversation; "only 60 left" continues it. The
  // shortfall carries the number so the cart can offer to take what there is,
  // the way the item sheet already does.
  if (nq > it.available) throw badRequest(`सिर्फ़ ${it.available.toLocaleString("en-IN")} उपलब्ध`, { available: it.available, requested: nq, moq: it.moq });
  if (nq < it.moq) { await saveCart(c, ls.filter((l) => l.itemId !== b.itemId)); }
  else { if (ex) ex.qty = nq; else ls.push({ itemId: b.itemId, qty: nq }); await saveCart(c, ls); }
  res.json(await cartView(c));
}));
router.delete("/cart/:itemId", asyncHandler(async (req, res) => { const c = await me(req); await saveCart(c, (await loadCart(c)).filter((l) => l.itemId !== req.params.itemId)); res.json(await cartView(c)); }));
router.post("/cart/reorder/:orderId", asyncHandler(async (req, res) => {
  const c = await me(req);
  const o = await prisma.order.findFirst({ where: { id: req.params.orderId, customerId: c.id }, include: { lines: true } });
  if (!o) throw notFound();
  const ls = await loadCart(c); let added = 0, short = 0;
  for (const l of o.lines) { const av = await stock.availAll(prisma, l.itemId); if (av >= l.qty) { const ex = ls.find((x) => x.itemId === l.itemId); if (ex) ex.qty += l.qty; else ls.push({ itemId: l.itemId, qty: l.qty }); added++; } else short++; }
  await saveCart(c, ls);
  res.json({ added, short, cart: await cartView(c) });
}));

// Atomic hold across every line, split across godowns by availability.
router.post("/book", asyncHandler(async (req, res) => {
  const c = await me(req);
  const { requiredBy } = z.object({ requiredBy: z.string().optional() }).parse(req.body ?? {});
  if (c.blockReason) throw badRequest("खाता रोका गया है — बकाया चुकाएं");
  const cv = await cartView(c);
  if (!cv.lines.length) throw badRequest("कार्ट खाली है");
  for (const l of cv.lines) if (l.available < l.qty) throw badRequest(`स्टॉक बदल गया — ${l.item.sku} के सिर्फ़ ${l.available} बचे हैं`);
  if (cv.gate.restricted && c.gateMode === "BLOCK") throw badRequest("क्रेडिट सीमा पार — ऑफ़िस से बात करें");
  const line = await prisma.businessLine.findUniqueOrThrow({ where: { id: cv.lines[0].item.lineId } });
  const order = await prisma.$transaction(async (tx) => {
    const id = await nextOrderNo(tx);
    const gds = await tx.godown.findMany({ where: { isActive: true } });
    const lineData = [];
    for (const l of cv.lines) {
      const avail = await Promise.all(gds.map(async (g) => ({ g: g.id, a: await stock.availGodown(tx, l.item.id, g.id) })));
      avail.sort((a, b) => b.a - a.a);
      const map: stock.GodownMap = {}; let need = l.qty;
      for (const x of avail) { if (need <= 0) break; const take = Math.min(x.a, need); if (take > 0) { map[x.g] = take; need -= take; } }
      if (need > 0) throw badRequest("स्टॉक अभी-अभी बदल गया — दोबारा कोशिश करें");
      const r = await stock.tryHold(tx, l.item.id, map, id, c.contactName);
      if (!r.ok) throw badRequest("स्टॉक अभी-अभी बुक हो गया — दोबारा कोशिश करें");
      const price = await pricerFor(c); const it = (await loadItemView(l.item.id))!; const pr = price(it, l.qty);
      lineData.push({ itemId: l.item.id, lineId: l.item.lineId, qty: l.qty, rate: pr.rate, slabRate: pr.slab, mult: pr.mult, priceSrc: pr.src, amount: pr.rate * l.qty, gstPct: it.gstPct, hsn: it.hsn, alloc: map });
    }
    const o = await tx.order.create({ data: { id, customerId: c.id, status: "BOOKED", subtotal: cv.totals.taxable, tax: cv.totals.tax, total: cv.totals.total, requiredBy: requiredBy ? new Date(requiredBy) : new Date(Date.now() + 14 * 864e5), holdUntil: line.holdMins > 0 ? new Date(Date.now() + line.holdMins * 60_000) : null, bookedBy: req.user!.name, source: "portal", lines: { create: lineData }, events: { create: { from: null, to: "BOOKED", by: req.user!.name, why: "Booked via wholesale portal" } } } });
    await tx.cart.deleteMany({ where: { customerId: c.id } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Customer booking submitted", entityType: "Order", entityId: id, newValue: "₹" + cv.totals.total.toFixed(2) });
    const text = `New booking ${id} from ${c.name} — ₹${cv.totals.total.toLocaleString("en-IN")}${cv.gate.restricted ? " · credit warning" : ""}`;
    await notify(tx, { text, kind: "WARN", role: "SALES_EXECUTIVE", link: `/orders?open=${id}` });
    if (c.salesExecId) await notify(tx, { text, kind: "WARN", userId: c.salesExecId, link: `/orders?open=${id}` });
    return o;
  });
  res.status(201).json({ orderId: order.id, holdMins: line.holdMins, holdUntil: order.holdUntil });
}));

router.get("/orders", asyncHandler(async (req, res) => {
  const c = await me(req);
  const os = await prisma.order.findMany({ where: { customerId: c.id }, include: { lines: { include: { item: { select: { name: true, sku: true } } } }, dispatches: true, invoices: { select: { no: true } }, events: { orderBy: { at: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } });
  res.json(os.map((o) => ({ id: o.id, status: o.status, statusHi: ORDER_STATUS_HI[o.status as OrderStatus], createdAt: o.createdAt, total: D(o.total), holdUntil: o.holdUntil, lines: o.lines.map((l) => ({ name: l.item.name, sku: l.item.sku, qty: l.qty, shipped: l.shipped })), backorder: o.lines.reduce((s, l) => s + l.qty - l.shipped, 0), dispatch: o.dispatches[0] ? { lr: o.dispatches[0].lr, transporter: o.dispatches[0].transporter } : null, invoiceNo: o.invoices[0]?.no ?? null, lastWhy: o.events[0]?.why ?? "" })));
}));
router.get("/invoices/:no", asyncHandler(async (req, res) => {
  const c = await me(req);
  const inv = await prisma.invoice.findFirst({ where: { no: req.params.no, customerId: c.id }, include: { lines: true, order: { include: { dispatches: true } } } });
  if (!inv) throw notFound();
  res.json({ ...inv, taxable: D(inv.taxable), cgst: D(inv.cgst), sgst: D(inv.sgst), igst: D(inv.igst), total: D(inv.total), lines: inv.lines.map((l) => ({ ...l, rate: D(l.rate), amount: D(l.amount) })), dispatch: inv.order.dispatches.find((d) => d.invoiceNo === inv.no) ?? null });
}));
router.post("/returns", asyncHandler(async (req, res) => {
  const c = await me(req);
  const b = z.object({ orderId: z.string(), itemId: z.string(), qty: z.number().int().positive(), reason: z.string().min(2), hasPhoto: z.boolean().default(false) }).parse(req.body);
  const o = await prisma.order.findFirst({ where: { id: b.orderId, customerId: c.id }, include: { lines: true } });
  if (!o || o.status !== "DELIVERED") throw badRequest("Only a delivered order can be returned");
  const l = o.lines.find((x) => x.itemId === b.itemId); if (!l) throw badRequest("Item not on this order");
  if (b.qty > l.shipped) throw badRequest(`सिर्फ़ ${l.shipped} भेजे गए थे`);
  const r = await prisma.$transaction(async (tx) => {
    const id = await nextReturnNo(tx);
    const r = await tx.returnRequest.create({ data: { id, orderId: o.id, customerId: c.id, itemId: b.itemId, qty: b.qty, reason: b.reason, hasPhoto: b.hasPhoto } });
    await notify(tx, { text: `Return request ${id} raised by ${c.name}`, kind: "INFO", role: "GODOWN_MANAGER" });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Return requested", entityType: "Return", entityId: id, reason: b.reason });
    return r;
  });
  res.status(201).json(r);
}));

// ── Kit correction ──
async function kitState(c: Cust) {
  const latest = await prisma.kitVersion.findFirst({ orderBy: { issuedAt: "desc" }, include: { items: true } });
  let kit = await prisma.kit.findUnique({ where: { customerId: c.id }, include: { kitVersion: { include: { items: true } } } });
  if (!kit && latest) kit = await prisma.kit.create({ data: { customerId: c.id, kitVersionId: latest.id, issuedAt: new Date() }, include: { kitVersion: { include: { items: true } } } });
  if (!kit) throw badRequest("No kit issued");
  const expected = kit.kitVersion.items.map((i) => i.itemId);
  const s = kit.session as { scans: string[]; last: string | null; startedAt: string; pending: number; offline: boolean } | null;
  const items = await loadItemViews({ id: { in: [...new Set([...expected, ...(s?.scans ?? [])])] } });
  const im = Object.fromEntries(items.map((i) => [i.id, i]));
  const scans = s?.scans ?? [];
  const buckets = s ? { matched: scans.filter((x) => expected.includes(x)), missing: expected.filter((x) => !scans.includes(x)), retired: scans.filter((x) => im[x]?.status === "DISCONTINUED"), unlisted: scans.filter((x) => !expected.includes(x) && im[x]?.status !== "DISCONTINUED") } : null;
  const lite = (id: string) => im[id] ? { id, sku: im[id].sku, designNo: im[id].designNo, name: im[id].name, artSeed: im[id].artSeed, lineId: im[id].lineId, imageUrl: im[id].imageUrl } : null;
  return { version: kit.kitVersionId, versionName: kit.kitVersion.name, isLatest: kit.kitVersionId === latest?.id, issuedAt: kit.issuedAt, lastScanAt: kit.lastScanAt, expectedCount: expected.length, session: s ? { ...s, scanned: scans.length, lastItem: s.last ? lite(s.last) : null } : null, buckets: buckets ? Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.map(lite).filter(Boolean)])) : null };
}
router.get("/kit", asyncHandler(async (req, res) => res.json(await kitState(await me(req)))));
router.post("/kit/start", asyncHandler(async (req, res) => { const c = await me(req); await kitState(c); await prisma.kit.update({ where: { customerId: c.id }, data: { session: { scans: [], last: null, startedAt: new Date().toISOString(), pending: 0, offline: false } } }); res.json(await kitState(c)); }));
router.post("/kit/scan", asyncHandler(async (req, res) => {
  const c = await me(req);
  const { itemId, offline } = z.object({ itemId: z.string().optional(), offline: z.boolean().optional() }).parse(req.body ?? {});
  const kit = await prisma.kit.findUnique({ where: { customerId: c.id }, include: { kitVersion: { include: { items: true } } } });
  if (!kit?.session) throw badRequest("No scan session");
  const s = kit.session as { scans: string[]; last: string | null; startedAt: string; pending: number; offline: boolean };
  let pick = itemId;
  if (!pick) { // simulated camera: mostly expected cards, sometimes a retired one or a card from no kit
    const expected = kit.kitVersion.items.map((i) => i.itemId);
    const all = await prisma.item.findMany({ where: { line: { code: "cards" } }, select: { id: true, status: true } });
    const roll = Math.random();
    if (roll < 0.08) pick = all.find((i) => i.status === "DISCONTINUED")?.id;
    else if (roll < 0.14) pick = all.filter((i) => !expected.includes(i.id) && i.status === "ACTIVE").pop()?.id;
    if (!pick) { const rem = expected.filter((x) => !s.scans.includes(x)); pick = rem.length ? rem[Math.floor(Math.random() * rem.length)] : expected[0]; }
  }
  if (s.scans.includes(pick)) return res.status(409).json({ error: "पहले से स्कैन हो चुका" });
  s.scans.push(pick); s.last = pick;
  if (offline) { s.offline = true; s.pending += 1; } else { s.offline = false; s.pending = 0; }
  await prisma.kit.update({ where: { customerId: c.id }, data: { session: s } });
  res.json(await kitState(c));
}));
router.post("/kit/pause", asyncHandler(async (req, res) => { const c = await me(req); await prisma.kit.update({ where: { customerId: c.id }, data: { lastScanAt: new Date() } }); res.json(await kitState(c)); }));
router.post("/kit/finish", asyncHandler(async (req, res) => {
  const c = await me(req);
  const st = await kitState(c);
  if (!st.session || !st.buckets) throw badRequest("No scan session");
  const latest = await prisma.kitVersion.findFirstOrThrow({ orderBy: { issuedAt: "desc" } });
  const ls = await loadCart(c); let added = 0;
  const add = async (id: string) => { const it = await loadItemView(id); if (it && it.available >= it.moq) { const ex = ls.find((x) => x.itemId === id); if (ex) ex.qty += it.moq; else ls.push({ itemId: id, qty: it.moq }); added++; } };
  for (const m of (st.buckets.missing as { id: string }[]).slice(0, 8)) await add(m.id);
  const price = await pricerFor(c);
  for (const r of st.buckets.retired as { id: string }[]) {
    const src = await loadItemView(r.id); if (!src) continue;
    const cands = (await loadItemViews({ lineId: src.lineId, status: "ACTIVE" })).filter((x) => x.id !== src.id);
    const alt = rankAlternates({ id: src.id, lineId: src.lineId, attrs: src.attrs, uom: src.uom, landedCost: src.landedCost, available: src.available, rate: price(src, src.moq).rate }, cands.map((x) => ({ id: x.id, lineId: x.lineId, attrs: x.attrs, uom: x.uom, landedCost: x.landedCost, available: x.available, rate: price(x, x.moq).rate })), src.moq)[0];
    if (alt) await add(alt.id);
  }
  await saveCart(c, ls);
  await prisma.kit.update({ where: { customerId: c.id }, data: { session: null as never, lastScanAt: new Date(), kitVersionId: latest.id } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Kit correction completed", entityType: "Kit", entityId: c.name, oldValue: st.session.scanned + " scanned", newValue: `${(st.buckets.missing as unknown[]).length} missing · ${(st.buckets.retired as unknown[]).length} retired` });
  await notify(prisma, { text: `Kit correction by ${c.name} — ${(st.buckets.missing as unknown[]).length} missing, ${(st.buckets.retired as unknown[]).length} to remove`, kind: "INFO", role: "SALES_EXECUTIVE" });
  res.json({ added, kit: await kitState(c) });
}));

// ── Hits (district ranking) ──
async function districtHits(c: Cust, n: number) {
  const price = await pricerFor(c);
  const items = await loadItemViews({ line: { code: "cards" }, status: "ACTIVE" });
  const [mine, district] = await Promise.all([
    prisma.orderLine.groupBy({ by: ["itemId"], where: { order: { customerId: c.id } }, _sum: { qty: true } }),
    prisma.orderLine.groupBy({ by: ["itemId"], where: { order: { customer: { tehsil: c.tehsil } } }, _sum: { qty: true } }),
  ]);
  const mm = Object.fromEntries(mine.map((x) => [x.itemId, x._sum.qty ?? 0])), dm = Object.fromEntries(district.map((x) => [x.itemId, x._sum.qty ?? 0]));
  return items.map((i) => ({ item: pub(i, price(i, i.moq).rate), sold: mm[i.id] ?? 0, district: dm[i.id] ?? 0 })).sort((a, b) => b.district - a.district || b.sold - a.sold).slice(0, n);
}
router.get("/hits", asyncHandler(async (req, res) => { const c = await me(req); res.json({ tehsil: c.tehsil, rows: await districtHits(c, 10) }); }));
router.post("/hits/competitor", asyncHandler(async (req, res) => {
  const c = await me(req); const { text } = z.object({ text: z.string().min(2) }).parse(req.body);
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Competitor design reported", entityType: "Customer", entityId: c.name, newValue: text, reason: "50 points" });
  res.json({ points: 50 });
}));

// ── Refer & earn ──
router.get("/referrals", asyncHandler(async (req, res) => { const c = await me(req); res.json({ code: c.referCode, rows: (await prisma.referral.findMany({ where: { byId: c.id }, orderBy: { createdAt: "desc" } })).map((r) => ({ ...r, reward: D(r.reward) })) }); }));
router.post("/referrals", asyncHandler(async (req, res) => {
  const c = await me(req);
  const b = z.object({ name: z.string().min(1), phone: z.string().min(5), tehsil: z.string().min(1), address: z.string().default("") }).parse(req.body);
  if (await prisma.customer.findFirst({ where: { phone: b.phone } }) || await prisma.referral.findFirst({ where: { phone: b.phone } })) throw badRequest("ये नंबर पहले से दर्ज है");
  const r = await prisma.$transaction(async (tx) => { const id = await nextReferralNo(tx); const r = await tx.referral.create({ data: { id, byId: c.id, ...b } }); await notify(tx, { text: `New referral from ${c.name} — ${b.name}`, kind: "INFO", role: "SALES_EXECUTIVE" }); return r; });
  res.status(201).json(r);
}));

router.get("/account", asyncHandler(async (req, res) => {
  const c = await me(req);
  const lines = await ledgerLines(c.id);
  res.json({ firm: { ...c, creditLimit: D(c.creditLimit) }, gate: creditGate({ creditLimit: D(c.creditLimit), creditDays: c.creditDays, gateMode: c.gateMode }, lines), ageing: ageing(lines), statement: ledgerWithBalance(lines).reverse() });
}));

export default router;
