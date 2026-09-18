import { DEFAULT_ROLE_PERMS, type Role } from "@vivaha/shared";
import { prisma } from "../db";

let cache: Record<string, string[]> | null = null;
let cacheAt = 0;
const TTL = 30_000;

export async function allRolePerms(): Promise<Record<string, string[]>> {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const rows = await prisma.rolePermission.findMany();
  const map: Record<string, string[]> = {};
  for (const r of rows) (map[r.role] = map[r.role] || []).push(r.perm);
  // Fallback to defaults if the table is empty (fresh DB before seed).
  if (!rows.length) for (const k of Object.keys(DEFAULT_ROLE_PERMS)) map[k] = [...DEFAULT_ROLE_PERMS[k as Role]];
  cache = map; cacheAt = Date.now();
  return map;
}

export async function permsForRole(role: Role): Promise<string[]> {
  return (await allRolePerms())[role] ?? [];
}

/** What one person may actually do: their role's capabilities, plus anything
 *  granted to them by name, minus anything withheld from them by name.
 *
 *  Read per request rather than trusted from the token, so a capability taken
 *  away this morning is gone on the next click rather than at the next sign-in.
 *  Grants are few and keyed by user, so this is one indexed lookup. */
export async function permsForUser(userId: string, role: Role): Promise<string[]> {
  const [base, grants] = await Promise.all([
    permsForRole(role),
    prisma.userPermission.findMany({ where: { userId }, select: { perm: true, allow: true } }),
  ]);
  if (!grants.length) return base;
  const set = new Set(base);
  for (const g of grants) (g.allow ? set.add(g.perm) : set.delete(g.perm));
  return [...set];
}

export function invalidatePermCache() { cache = null; }
