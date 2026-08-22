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

export function invalidatePermCache() { cache = null; }
