"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Perm, Role } from "@vivaha/shared";
import { apiFetch, setAccessToken, setUnauthorizedHandler, refreshAccessToken, ApiError } from "./api";

export interface SessionUser { id: string; username: string; name: string; initials: string; role: Role; customerId: string | null; customerName?: string | null; authority?: string | null; perms: string[] }
interface Ctx { user: SessionUser | null; loading: boolean; login: (username: string, password: string, kind: "internal" | "customer") => Promise<SessionUser>; logout: () => Promise<void>; can: (p: Perm) => boolean }
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const logout = async () => { setAccessToken(null); setUser(null); try { await apiFetch("/api/auth/logout", { method: "POST", skipAuthRetry: true }); } catch { /* best effort */ } };
  const login = async (username: string, password: string, kind: "internal" | "customer") => {
    const d = await apiFetch<{ accessToken: string; user: SessionUser }>("/api/auth/login", { method: "POST", body: { username, password, kind }, skipAuthRetry: true });
    setAccessToken(d.accessToken); setUser(d.user); return d.user;
  };
  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); setAccessToken(null); });
    (async () => { try { if (await refreshAccessToken()) setUser(await apiFetch<SessionUser>("/api/auth/me")); } catch (e) { if (!(e instanceof ApiError)) console.error(e); } finally { setLoading(false); } })();
    return () => setUnauthorizedHandler(null);
  }, []);
  const can = (p: Perm) => !!user && user.perms.includes(p);
  return <AuthContext.Provider value={{ user, loading, login, logout, can }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const c = useContext(AuthContext); if (!c) throw new Error("useAuth outside AuthProvider"); return c; }
