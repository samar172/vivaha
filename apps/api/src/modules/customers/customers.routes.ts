import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma, D } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm, can } from "../../middleware/auth";
import { gatesForAll, customerFinance } from "../../services/credit";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { nextCustomerNo } from "../../services/sequence";
import { groupMultiplier } from "../../services/pricing";
import { getMinMargin } from "../../services/settings";
import { badRequest, notFound, forbidden } from "../../utils/httpError";
import { marginFloor, slabRate } from "@vivaha/shared";

const router = Router();
const custInclude = { contacts: true, machines: true, salesExec: { select: { id: true, name: true } }, users: { select: { username: true, isActive: true } } } as const;

function serialize<T extends { creditLimit: unknown }>(c: T): Omit<T, "creditLimit"> & { creditLimit: number } {
  return { ...c, creditLimit: D(c.creditLimit as number) };
}

router.get("/", requirePerm("cust.view"), asyncHandler(async (req, res) => {
  const q = z.object({ line: z.string().optional(), q: z.string().optional(), filter: z.string().optional() }).parse(req.query);
  let rows = await prisma.customer.findMany({ include: custInclude, orderBy: { id: "asc" } });
  if (q.line && q.line !== "ALL") rows = rows.filter((c) => (c.linesEnabled as string[]).includes(q.line!));
  if (q.q) { const s = q.q.toLowerCase(); rows = rows.filter((c) => (c.name + c.contactName + c.tehsil + (c.gstin || "")).toLowerCase().includes(s)); }
  const gates = await gatesForAll(rows);
  const filters = (q.filter || "").split(",").filter(Boolean);
  let out = rows.map((c) => ({ ...serialize(c), gate: gates[c.id].gate, ageing: gates[c.id].ageing, hasLogin: c.users.some((u) => u.isActive) }));
  if (filters.includes("gate")) out = out.filter((c) => c.gate.restricted);
  if (filters.includes("blocked")) out = out.filter((c) => !!c.blockReason);
  if (filters.includes("machines")) out = out.filter((c) => c.machines.length > 0);
  res.json(out);
}));

router.get("/:id", requirePerm("cust.view"), asyncHandler(async (req, res) => {
  const c = await prisma.customer.findUnique({ where: { id: req.params.id }, include: { ...custInclude, overrides: { include: { item: { select: { sku: true, name: true, moq: true, landedCost: true, slabs: true } } } } } });
  if (!c) throw notFound("Customer not found");
  const [fin, orders, mult, minMargin, kit] = await Promise.all([
    customerFinance(c), prisma.order.findMany({ where: { customerId: c.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, total: true, status: true, createdAt: true } }),
    groupMultiplier(c.group), getMinMargin(), prisma.kit.findUnique({ where: { customerId: c.id } }),
  ]);
  res.json({
    ...serialize(c), ...fin, multiplier: mult, kit,
    orders: orders.map((o) => ({ ...o, total: D(o.total) })),
    overrides: c.overrides.map((o) => ({ itemId: o.itemId, sku: o.item.sku, name: o.item.name, rate: D(o.rate), reason: o.reason, setBy: o.setBy, slabRate: slabRate(o.item.slabs.map((s) => ({ fromQty: s.fromQty, toQty: s.toQty, rate: D(s.rate) })), o.item.moq), groupRate: Math.round(slabRate(o.item.slabs.map((s) => ({ fromQty: s.fromQty, toQty: s.toQty, rate: D(s.rate) })), o.item.moq) * mult), floor: marginFloor(D(o.item.landedCost), minMargin) })),
  });
}));

// A firm is reached on several numbers — the owner on one, the office on
// another, accounts on a third — and the bill has to go to whichever of them
// actually handles bills. `id` is present when an existing row is being edited,
// which is what keeps a contact's portal login attached to it.
export const CONTACT_ROLES = ["Owner", "Staff", "Office", "Accounts", "Other"] as const;
const contactSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1), role: z.string().default("Owner"), phone: z.string().min(5),
  authority: z.enum(["Owner", "Staff"]).default("Staff"),
});
const custSchema = z.object({
  name: z.string().min(1), contactName: z.string().min(1), phone: z.string().min(5), tehsil: z.string().min(1), gstin: z.string().optional(), firmType: z.string().default("Registered"),
  address: z.string().default(""), linesEnabled: z.array(z.string()).min(1), group: z.string().default("Regular"), salesExecId: z.string().nullable().optional(),
  creditLimit: z.number().min(0).default(0), creditDays: z.number().int().min(0).default(0), gateMode: z.enum(["WARN", "BLOCK"]).default("WARN"),
  priceAdjPct: z.number().min(0, "A discount cannot be negative").max(90, "That is not a discount, that is a giveaway").default(0),
  machines: z.array(z.object({ type: z.string(), spec: z.record(z.string()).default({}) })).default([]),
  contacts: z.array(contactSchema).default([]),
});
router.post("/", requirePerm("cust.edit"), asyncHandler(async (req, res) => {
  const b = custSchema.parse(req.body);
  if (await prisma.customer.findFirst({ where: { name: { equals: b.name, mode: "insensitive" } } })) throw badRequest("A firm with this name already exists");
  const c = await prisma.$transaction(async (tx) => {
    const id = await nextCustomerNo(tx);
    const seq = Number(id.split("-")[1]);
    // The owner is always on the list. Callers that send no contacts at all get
    // the owner alone, exactly as before.
    const contacts = b.contacts.length
      ? b.contacts.map(({ id: _drop, ...ct }) => ct)
      : [{ name: b.contactName, role: "Owner", phone: b.phone, authority: "Owner" }];
    if (!contacts.some((ct) => ct.authority === "Owner")) contacts.unshift({ name: b.contactName, role: "Owner", phone: b.phone, authority: "Owner" });
    const c = await tx.customer.create({ data: { id, name: b.name, contactName: b.contactName, phone: b.phone, tehsil: b.tehsil, gstin: b.gstin || null, firmType: b.firmType, address: b.address, linesEnabled: b.linesEnabled, group: b.group, salesExecId: b.salesExecId ?? null, creditLimit: b.creditLimit, creditDays: b.creditDays, gateMode: b.gateMode, priceAdjPct: b.priceAdjPct, referCode: `VIVAHA-RJ${4100 + seq * 37}`, contacts: { create: contacts }, machines: { create: b.machines } } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Customer created", entityType: "Customer", entityId: b.name, newValue: `${b.group} · limit ₹${b.creditLimit}`, reason: "New onboarding" });
    return c;
  });
  res.status(201).json(serialize(c));
}));

router.patch("/:id", requirePerm("cust.edit"), asyncHandler(async (req, res) => {
  const b = custSchema.partial().parse(req.body);
  const before = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound("Customer not found");
  const { machines, contacts, ...rest } = b;
  const c = await prisma.$transaction(async (tx) => {
    if (machines) { await tx.customerMachine.deleteMany({ where: { customerId: before.id } }); await tx.customerMachine.createMany({ data: machines.map((m) => ({ ...m, customerId: before.id })) }); }
    if (contacts) {
      // Reconciled by id, never wholesale replaced: hasLogin is set against a
      // contact row when a portal login is issued, and deleting the row to
      // re-create it would quietly strip that firm's access marker.
      const keep = contacts.filter((ct) => ct.id).map((ct) => ct.id!);
      await tx.customerContact.deleteMany({ where: { customerId: before.id, id: { notIn: keep.length ? keep : ["__none__"] } } });
      for (const ct of contacts) {
        const { id, ...data } = ct;
        if (id) await tx.customerContact.update({ where: { id }, data });
        else await tx.customerContact.create({ data: { ...data, customerId: before.id } });
      }
    }
    const c = await tx.customer.update({ where: { id: before.id }, data: { ...rest, gstin: rest.gstin === undefined ? undefined : rest.gstin || null, salesExecId: rest.salesExecId === undefined ? undefined : rest.salesExecId } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Customer updated", entityType: "Customer", entityId: before.name, oldValue: `limit ₹${D(before.creditLimit)} · ${before.creditDays}d · ${before.gateMode}`, newValue: `limit ₹${D(c.creditLimit)} · ${c.creditDays}d · ${c.gateMode}` });
    return c;
  });
  res.json(serialize(c));
}));

router.post("/:id/block", requirePerm("cust.block"), asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().min(3, "A reason is required"), until: z.string().optional() }).parse(req.body);
  const c = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!c) throw notFound("Customer not found");
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: c.id }, data: { blockReason: b.reason, blockedBy: req.user!.name, blockedAt: new Date(), blockUntil: b.until ? new Date(b.until) : null } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Temporary block applied", entityType: "Customer", entityId: c.name, oldValue: "Active", newValue: "Blocked", reason: b.reason });
    await notify(tx, { text: `Temporary block applied to ${c.name}`, kind: "WARN", role: "SALES_EXECUTIVE" });
  });
  res.json({ ok: true });
}));
router.post("/:id/unblock", requirePerm("cust.block"), asyncHandler(async (req, res) => {
  const c = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!c) throw notFound("Customer not found");
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: c.id }, data: { blockReason: null, blockedBy: null, blockedAt: null, blockUntil: null } });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Temporary block lifted", entityType: "Customer", entityId: c.name, oldValue: "Blocked", newValue: "Active", reason: "Manual release" });
  });
  res.json({ ok: true });
}));

router.put("/:id/overrides/:itemId", requirePerm("cust.price"), asyncHandler(async (req, res) => {
  const b = z.object({
    mode: z.enum(["FLAT", "PERCENT"]).default("FLAT"),
    rate: z.number().positive("Enter a valid rate").optional(),
    pct: z.number().min(0, "A discount cannot be negative").max(90, "That is not a discount, that is a giveaway").optional(),
    reason: z.string().default("Negotiated rate"),
  }).parse(req.body);
  const [c, it, minMargin] = await Promise.all([
    prisma.customer.findUnique({ where: { id: req.params.id } }),
    prisma.item.findUnique({ where: { id: req.params.itemId }, include: { line: true, slabs: { orderBy: { fromQty: "asc" } } } }),
    getMinMargin(),
  ]);
  if (!c || !it) throw notFound();

  // Cards go out on one published price list; only the negotiated lines carry
  // per-firm pricing. Which is which is configuration on the business line.
  if (!it.line.allowCustomPricing) throw badRequest(`${it.line.name} is sold from a fixed price list — per-firm pricing is not used on this line. Change the slab rates on the item instead.`);

  // Whichever way it was entered, the floor is checked against the rupee figure
  // the firm would actually pay at this item's minimum order quantity.
  const mult = await groupMultiplier(c.group);
  const listRate = Math.round(slabRate(it.slabs.map((s) => ({ fromQty: s.fromQty, toQty: s.toQty, rate: D(s.rate) })), it.moq) * mult);
  if (b.mode === "FLAT" && b.rate == null) throw badRequest("Enter the agreed rate");
  if (b.mode === "PERCENT" && b.pct == null) throw badRequest("Enter the agreed discount");
  const effective = b.mode === "FLAT" ? b.rate! : Math.round(listRate * (1 - b.pct! / 100));

  const floor = marginFloor(D(it.landedCost), minMargin);
  if (effective < floor && !can(req, "margin.override")) throw forbidden(`₹${effective} is below the margin floor of ₹${floor} — your role cannot override it`);

  const shown = b.mode === "FLAT" ? `₹${effective}` : `${b.pct}% off (₹${effective} at MOQ)`;
  await prisma.$transaction(async (tx) => {
    const data = { mode: b.mode, rate: effective, pct: b.mode === "PERCENT" ? b.pct! : null, reason: b.reason, setBy: req.user!.name };
    await tx.priceOverride.upsert({ where: { customerId_itemId: { customerId: c.id, itemId: it.id } }, create: { customerId: c.id, itemId: it.id, ...data }, update: data });
    await audit(tx, { userId: req.user!.id, actor: req.user!.name, action: "Customer price override set", entityType: "Customer", entityId: c.name, oldValue: `list ₹${listRate}`, newValue: `${it.sku} = ${shown}`, reason: effective < floor ? `Below margin floor ₹${floor}, overridden by ${req.user!.role}` : b.reason });
  });
  res.json({ ok: true, belowFloor: effective < floor, floor, effective, listRate });
}));
router.delete("/:id/overrides/:itemId", requirePerm("cust.price"), asyncHandler(async (req, res) => {
  await prisma.priceOverride.deleteMany({ where: { customerId: req.params.id, itemId: req.params.itemId } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Customer price override removed", entityType: "Customer", entityId: req.params.id, oldValue: req.params.itemId });
  res.status(204).send();
}));

// Portal login for a firm contact.
router.post("/:id/login", requirePerm("cust.edit"), asyncHandler(async (req, res) => {
  const { username, password, contactName, authority } = z.object({ username: z.string().min(3), password: z.string().min(6), contactName: z.string().min(1), authority: z.enum(["Owner", "Staff"]).default("Owner") }).parse(req.body);
  const c = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!c) throw notFound();
  // Issued the same way Settings issues one: the password the office can see is
  // temporary, and the holder has to replace it at first sign-in.
  const u = await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash(password, 10), name: contactName, initials: contactName.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase(), role: "CUSTOMER", customerId: c.id, authority, mustChangePassword: true, passwordSetAt: new Date() } });
  await prisma.customerContact.updateMany({ where: { customerId: c.id, name: contactName }, data: { hasLogin: true } });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Portal login issued", entityType: "Customer", entityId: c.name, newValue: username });
  res.status(201).json({ id: u.id, username: u.username });
}));

export default router;
