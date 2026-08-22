import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Role } from "@vivaha/shared";
import { prisma } from "../../db";
import { env } from "../../env";
import { unauthorized } from "../../utils/httpError";
import { audit } from "../../services/audit";
import { permsForRole } from "../../services/permissions";

const ACCESS_TOKEN_TTL = "30m";
const REFRESH_TOKEN_TTL_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface TokenUser { id: string; role: Role; name: string; customerId: string | null }
export interface SessionUser extends TokenUser { username: string; initials: string; perms: string[]; customerName?: string | null; authority?: string | null }

const signAccess = (u: TokenUser) => jwt.sign(u, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
const signRefresh = (u: TokenUser) => jwt.sign({ id: u.id }, env.JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });

async function sessionFor(user: { id: string; role: Role; name: string; customerId: string | null; username: string; initials: string; authority: string | null }): Promise<SessionUser> {
  const perms = await permsForRole(user.role);
  const cust = user.customerId ? await prisma.customer.findUnique({ where: { id: user.customerId }, select: { name: true } }) : null;
  return { id: user.id, role: user.role, name: user.name, customerId: user.customerId, username: user.username, initials: user.initials, perms, customerName: cust?.name ?? null, authority: user.authority };
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
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
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
