import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Perm, Role } from "@vivaha/shared";
import { env } from "../env";
import { unauthorized, forbidden } from "../utils/httpError";
import { permsForRole } from "../services/permissions";

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  customerId: string | null;
  perms: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized("Missing bearer token"));
  const token = header.slice("Bearer ".length);
  let payload: { id: string; role: Role; name: string; customerId: string | null };
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as typeof payload;
  } catch {
    return next(unauthorized("Invalid or expired token"));
  }
  permsForRole(payload.role)
    .then((perms) => {
      req.user = { id: payload.id, role: payload.role, name: payload.name, customerId: payload.customerId ?? null, perms };
      next();
    })
    .catch(next);
}

export function requirePerm(...perms: Perm[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!perms.some((p) => req.user!.perms.includes(p))) {
      return next(forbidden(`Your role (${req.user.role}) lacks ${perms.join(" / ")}`));
    }
    next();
  };
}

// Portal routes: only CUSTOMER logins with a firm attached.
export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "CUSTOMER" || !req.user.customerId) return next(forbidden("Customer portal login required"));
  next();
}

// Internal routes: anything but the portal role.
export function requireInternal(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role === "CUSTOMER") return next(forbidden("Internal users only"));
  next();
}

export const can = (req: Request, p: Perm) => !!req.user && req.user.perms.includes(p);
