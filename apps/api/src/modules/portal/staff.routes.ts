// The firm's own list of people, run by the firm.
//
// Until now a retailer who took on a nephew to handle the counter had to ring
// the office to get him a login, and the office had to remember to mark which
// number the bills should go to. Both are the firm's business, so both are done
// here — by the owner, and only by the owner.
//
// What stays with the office on purpose:
//   * Owner authority. A staff member cannot be promoted to owner from inside
//     the portal, because owner authority is what clears a credit-breaching
//     order. Handing that out is a decision the office takes.
//   * The owner's own row. It is the firm's registered contact and moves with
//     the customer record.
// Everything done here is audited under the firm's name and raises a line to
// the sales executive, so the office sees it happen without having to do it.

import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { M } from "@vivaha/shared";
import { prisma } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { audit } from "../../services/audit";
import { notify } from "../../services/notify";
import { generatePassword } from "../auth/auth.service";
import { badRequest, forbidden, notFound } from "../../utils/httpError";

const router = Router();

const STAFF_LIMIT = 10;

// A ten-digit Indian mobile, however it was typed — with +91, with spaces, with
// a leading zero. Stored the way it was written; compared on the digits.
const digits = (p: string) => p.replace(/\D/g, "").replace(/^(91|0)/, "");
const validPhone = (p: string) => /^[6-9]\d{9}$/.test(digits(p));

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "??";

/** The signed-in portal user, with their authority read from the row rather
 *  than the token — an owner demoted this morning should not still be one. */
async function actor(req: { user?: { id: string; customerId: string | null } }) {
  const u = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, username: true, authority: true, customerId: true },
  });
  if (!u || !u.customerId) throw forbidden("Customer portal login required");
  return u;
}

async function owner(req: Parameters<typeof actor>[0]) {
  const u = await actor(req);
  if (u.authority !== "Owner") throw forbidden(M.ownerOnly());
  return u;
}

const contactSelect = {
  id: true, name: true, role: true, phone: true, authority: true, billsTo: true, hasLogin: true, userId: true,
  user: { select: { id: true, username: true, isActive: true, mustChangePassword: true, lastLoginAt: true, lockedUntil: true } },
} as const;

const list = (customerId: string) =>
  prisma.customerContact.findMany({
    where: { customerId },
    select: contactSelect,
    // The owner first, then everyone else in the order they were added.
    orderBy: [{ authority: "asc" }, { name: "asc" }],
  });

// A username nobody has to invent: the firm's id and the person's first name,
// with a number appended only if that is already taken.
async function usernameFor(customerId: string, name: string) {
  const base = `${customerId.toLowerCase().replace(/[^a-z0-9]/g, "")}.${name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "staff"}`;
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}${n + 1}`;
    if (!(await prisma.user.findUnique({ where: { username: candidate } }))) return candidate;
  }
  throw badRequest("Could not settle on a username — add a surname");
}

router.get("/", asyncHandler(async (req, res) => {
  const u = await actor(req);
  res.json({
    canManage: u.authority === "Owner",
    limit: STAFF_LIMIT,
    me: { id: u.id, username: u.username },
    contacts: await list(u.customerId!),
  });
}));

const bodySchema = z.object({
  name: z.string().trim().min(2, "Enter the person's name"),
  role: z.string().trim().min(2).default("Staff"),
  phone: z.string().trim().min(5),
  billsTo: z.boolean().default(false),
  withLogin: z.boolean().default(false),
});

router.post("/", asyncHandler(async (req, res) => {
  const u = await owner(req);
  const b = bodySchema.parse(req.body);
  if (!validPhone(b.phone)) throw badRequest(M.badPhone());

  const existing = await list(u.customerId!);
  if (existing.length >= STAFF_LIMIT) throw badRequest(M.staffLimit(STAFF_LIMIT));
  const clash = existing.find((c) => digits(c.phone) === digits(b.phone));
  if (clash) throw badRequest(M.phoneAlready(clash.name));

  const out = await prisma.$transaction(async (tx) => {
    const contact = await tx.customerContact.create({
      // Authority is always Staff from here. Only the office grants the other.
      data: { customerId: u.customerId!, name: b.name, role: b.role, phone: b.phone, authority: "Staff", billsTo: b.billsTo },
      select: contactSelect,
    });
    await audit(tx, { userId: u.id, actor: `${u.name} (${u.customerId})`, action: "Staff member added by the firm", entityType: "CustomerContact", entityId: contact.id, newValue: `${b.name} · ${b.role} · ${b.phone}` });
    return contact;
  });

  let login: { username: string; password: string } | null = null;
  if (b.withLogin) login = await issueLogin(out.id, u);

  await notify(prisma, { text: `${u.name} added ${b.name} (${b.role}) at their firm${b.withLogin ? " and issued a login" : ""}`, kind: "INFO", role: "SALES_EXECUTIVE" });
  res.status(201).json({ contact: (await list(u.customerId!)).find((c) => c.id === out.id), login });
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const u = await owner(req);
  const b = bodySchema.partial().omit({ withLogin: true }).parse(req.body);
  const c = await prisma.customerContact.findFirst({ where: { id: req.params.id, customerId: u.customerId! }, select: contactSelect });
  if (!c) throw notFound("Person not found on this firm");
  if (b.phone !== undefined && !validPhone(b.phone)) throw badRequest(M.badPhone());
  if (b.phone !== undefined) {
    const others = (await list(u.customerId!)).filter((x) => x.id !== c.id);
    const clash = others.find((x) => digits(x.phone) === digits(b.phone!));
    if (clash) throw badRequest(M.phoneAlready(clash.name));
  }
  // The owner's own row belongs to the customer record; only the billing mark
  // on it is the firm's to move.
  const data = c.authority === "Owner" ? { billsTo: b.billsTo } : b;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.customerContact.update({ where: { id: c.id }, data, select: contactSelect });
    // A name change has to reach the login, or the office sees one name on the
    // list and another on the account. Keyed off what was actually written,
    // not off what was asked for: an owner's own row refuses the rename, and
    // syncing the request anyway renamed the login out from under it.
    if (next.userId && next.name !== c.name) {
      await tx.user.update({ where: { id: next.userId }, data: { name: next.name, initials: initialsOf(next.name) } });
    }
    await audit(tx, { userId: u.id, actor: `${u.name} (${u.customerId})`, action: "Staff details changed by the firm", entityType: "CustomerContact", entityId: c.id, oldValue: `${c.name} · ${c.role} · ${c.phone}${c.billsTo ? " · bills" : ""}`, newValue: `${next.name} · ${next.role} · ${next.phone}${next.billsTo ? " · bills" : ""}` });
    return next;
  });

  await guardBillingNumber(u.customerId!);
  res.json(await reread(u.customerId!, updated.id));
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const u = await owner(req);
  const c = await prisma.customerContact.findFirst({ where: { id: req.params.id, customerId: u.customerId! }, select: contactSelect });
  if (!c) throw notFound("Person not found on this firm");
  if (c.authority === "Owner") throw badRequest(M.ownerStays());
  if (c.userId === u.id) throw badRequest(M.cannotLockSelf());

  await prisma.$transaction(async (tx) => {
    // The login is deactivated, never deleted: audit rows and notifications
    // point at it, and a firm that re-hires somebody should see the history.
    if (c.userId) await tx.user.update({ where: { id: c.userId }, data: { isActive: false } });
    await tx.customerContact.delete({ where: { id: c.id } });
    await audit(tx, { userId: u.id, actor: `${u.name} (${u.customerId})`, action: "Staff member removed by the firm", entityType: "CustomerContact", entityId: c.id, oldValue: `${c.name} · ${c.role}${c.userId ? " · login deactivated" : ""}` });
  });
  await guardBillingNumber(u.customerId!);
  await notify(prisma, { text: `${u.name} removed ${c.name} from their firm's list${c.userId ? " — the login was deactivated" : ""}`, kind: "INFO", role: "SALES_EXECUTIVE" });
  res.json({ ok: true });
}));

/** Issue a fresh login for a contact, or re-issue the password for one that
 *  already has it. The password is returned in clear exactly once. */
async function issueLogin(contactId: string, u: { id: string; name: string; customerId: string | null }) {
  const c = await prisma.customerContact.findFirst({ where: { id: contactId, customerId: u.customerId! }, select: contactSelect });
  if (!c) throw notFound("Person not found on this firm");
  const password = generatePassword();
  const hash = await bcrypt.hash(password, 10);

  if (c.userId) {
    const user = await prisma.user.update({
      where: { id: c.userId },
      data: { passwordHash: hash, mustChangePassword: true, passwordSetAt: new Date(), failedLoginCount: 0, lockedUntil: null, isActive: true },
    });
    await audit(prisma, { userId: u.id, actor: `${u.name} (${u.customerId})`, action: "Portal password re-issued by the firm", entityType: "User", entityId: user.username, reason: "Temporary password — the holder must change it at next sign-in" });
    return { username: user.username, password };
  }

  const username = await usernameFor(u.customerId!, c.name);
  const user = await prisma.user.create({
    data: {
      username, name: c.name, initials: initialsOf(c.name), role: "CUSTOMER",
      passwordHash: hash, isActive: true, mustChangePassword: true, passwordSetAt: new Date(),
      customerId: u.customerId!, authority: "Staff",
    },
  });
  await prisma.customerContact.update({ where: { id: c.id }, data: { userId: user.id, hasLogin: true } });
  await audit(prisma, { userId: u.id, actor: `${u.name} (${u.customerId})`, action: "Portal login created by the firm", entityType: "User", entityId: username, newValue: "CUSTOMER · Staff" });
  return { username, password };
}

router.post("/:id/login", asyncHandler(async (req, res) => {
  const u = await owner(req);
  const login = await issueLogin(req.params.id, u);
  await notify(prisma, { text: `${u.name} issued a portal password for ${login.username}`, kind: "INFO", role: "SALES_EXECUTIVE" });
  res.json({ login, contact: await reread(u.customerId!, req.params.id) });
}));

router.post("/:id/login/disable", asyncHandler(async (req, res) => {
  const u = await owner(req);
  const c = await prisma.customerContact.findFirst({ where: { id: req.params.id, customerId: u.customerId! }, select: contactSelect });
  if (!c) throw notFound("Person not found on this firm");
  if (!c.userId) throw badRequest("This person has no login");
  if (c.userId === u.id) throw badRequest(M.cannotLockSelf());
  const on = c.user?.isActive === false;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: c.userId! }, data: { isActive: on } });
    await audit(tx, { userId: u.id, actor: `${u.name} (${u.customerId})`, action: on ? "Portal login re-enabled by the firm" : "Portal login disabled by the firm", entityType: "User", entityId: c.user!.username, oldValue: on ? "Disabled" : "Active", newValue: on ? "Active" : "Disabled" });
  });
  res.json({ contact: await reread(u.customerId!, c.id) });
}));

/** Bills have to reach somebody. If the last marked number was unmarked or
 *  removed, the owner's row takes it back. */
async function guardBillingNumber(customerId: string) {
  const rows = await prisma.customerContact.findMany({ where: { customerId }, select: { id: true, authority: true, billsTo: true } });
  if (rows.some((r) => r.billsTo)) return;
  const fallback = rows.find((r) => r.authority === "Owner") ?? rows[0];
  if (fallback) await prisma.customerContact.update({ where: { id: fallback.id }, data: { billsTo: true } });
}

const reread = async (customerId: string, id: string) => (await list(customerId)).find((c) => c.id === id) ?? null;

export default router;
