import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Role } from "@vivaha/shared";
import { prisma } from "../../db";
import { env } from "../../env";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { audit } from "../../services/audit";
import { permsForUser } from "../../services/permissions";

const ACCESS_TOKEN_TTL = "30m";
const REFRESH_TOKEN_TTL_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface TokenUser { id: string; role: Role; name: string; customerId: string | null }
export interface SessionUser extends TokenUser { username: string; initials: string; perms: string[]; customerName?: string | null; authority?: string | null; mustChangePassword: boolean }

const signAccess = (u: TokenUser) => jwt.sign(u, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
const signRefresh = (u: TokenUser) => jwt.sign({ id: u.id }, env.JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });

async function sessionFor(user: { id: string; role: Role; name: string; customerId: string | null; username: string; initials: string; authority: string | null; mustChangePassword?: boolean }): Promise<SessionUser> {
  const perms = await permsForUser(user.id, user.role);
  const cust = user.customerId ? await prisma.customer.findUnique({ where: { id: user.customerId }, select: { name: true } }) : null;
  return { id: user.id, role: user.role, name: user.name, customerId: user.customerId, username: user.username, initials: user.initials, perms, customerName: cust?.name ?? null, authority: user.authority, mustChangePassword: !!user.mustChangePassword };
}

// An account is handed over with a password the office generated and can see,
// so the holder has to be able to replace it with one only they know.
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized("Sign in again");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw unauthorized("Current password is not correct");
  if (await bcrypt.compare(newPassword, user.passwordHash)) throw badRequest("The new password has to be different from the current one");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10), failedLoginCount: 0, lockedUntil: null, mustChangePassword: false, passwordSetAt: new Date() } });
  await audit(prisma, { userId: user.id, actor: user.name, action: "Password changed", entityType: "User", entityId: user.username, reason: "Changed by the account holder" });
}

// Readable but not guessable: no look-alike characters, so it survives being
// written on paper and read back over the phone.
const PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
export function generatePassword(len = 10) {
  let out = "";
  for (let i = 0; i < len; i++) out += PW_ALPHABET[Math.floor(Math.random() * PW_ALPHABET.length)];
  return out;
}

// Office-issued password: returned in clear ONCE to whoever issued it, then only
// ever stored as a hash. The holder must replace it before they can work.
export async function issuePassword(targetUserId: string, actor: { id: string; name: string }) {
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw notFound("User not found");
  const password = generatePassword();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, passwordSetAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  await audit(prisma, { userId: actor.id, actor: actor.name, action: "Password reset by office", entityType: "User", entityId: user.username, reason: "Temporary password issued — holder must change it at next sign-in" });
  return { password, username: user.username, role: user.role };
}

export async function login(username: string, password: string, kind: "internal" | "customer", ip: string | null) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isActive) throw unauthorized("Invalid username or password");
  if (kind === "customer" && user.role !== "CUSTOMER") throw unauthorized("Use the Internal (Office) tab for this login");
  if (kind === "internal" && user.role === "CUSTOMER") throw unauthorized("Use the Customer Portal tab for this login");
  if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized(`Account locked until ${user.lockedUntil.toLocaleTimeString("en-IN")}. Contact the office.`);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount, lockedUntil: failedLoginCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null } });
    throw unauthorized("Invalid username or password");
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const tokenUser: TokenUser = { id: user.id, role: user.role, name: user.name, customerId: user.customerId };
  await audit(prisma, { userId: user.id, actor: user.name, action: "Signed in", entityType: "Session", entityId: user.id, ip, newValue: kind });
  return { accessToken: signAccess(tokenUser), refreshToken: signRefresh(tokenUser), user: await sessionFor(user) };
}

export async function refresh(refreshToken: string) {
  let payload: { id: string };
  try { payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { id: string }; }
  catch { throw unauthorized("Invalid or expired refresh token"); }
  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user || !user.isActive) throw unauthorized();
  const tokenUser: TokenUser = { id: user.id, role: user.role, name: user.name, customerId: user.customerId };
  return { accessToken: signAccess(tokenUser), refreshToken: signRefresh(tokenUser), user: await sessionFor(user) };
}

export async function me(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw unauthorized();
  return sessionFor(user);
}

export const REFRESH_COOKIE_NAME = "vivaha_refresh";
export const REFRESH_COOKIE_MAX_AGE_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
