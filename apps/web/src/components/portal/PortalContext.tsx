"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useApi, refresh } from "@/lib/hooks";
import { useUI } from "@/lib/ui";
import { post, del, ApiError } from "@/lib/api";
import type { Band, CreditGate } from "@vivaha/shared";

export interface PItem { id: string; sku: string; designNo: string | null; name: string; nameHi: string; lineId: string; attrs: Record<string, string>; uom: string; packUom: string; perPack: number; moq: number; gstPct: number; artSeed: number; imageUrl: string | null; images?: { id: string; url: string; label: string }[]; band: Band; rate: number; status: string }
export interface PLine { id: string; name: string; nameHi: string; icon: string; color: string; gstPct: number; facets: string[]; holdMins: number }
export interface Me { firm: { id: string; name: string; contactName: string; tehsil: string; group: string; creditLimit: number; creditDays: number; gateMode: "WARN" | "BLOCK"; gstin: string | null; phone: string; referCode: string; linesEnabled: string[]; blockReason: string | null; salesExec: { name: string } | null; machines: { id: string; type: string; spec: Record<string, string> }[] }; gate: CreditGate; lines: PLine[]; cartCount: number }
export interface CartView { lines: { item: PItem; qty: number; rate: number; amount: number; gstPct: number; available: number }[]; totals: { taxable: number; tax: number; total: number; blocks: { gstPct: number; taxable: number; inter: boolean; total: number }[] }; gate: CreditGate; byLine: Record<string, { sub: number; gstPct: number }>; count: number }

interface Ctx { me: Me | null; line: string; setLine: (l: string) => void; sheet: string | null; openSheet: (id: string, qty?: number) => void; closeSheet: () => void; sheetQty: number; cartOpen: boolean; openCart: () => void; cart: CartView | null; addLine: (itemId: string, qty: number, mode?: "add" | "set") => Promise<boolean>; rmLine: (itemId: string) => Promise<void>; reload: () => void }
const C = createContext<Ctx | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth(); const router = useRouter(); const { toast } = useUI();
  const { data: me, mutate: mutMe } = useApi<Me>(user?.role === "CUSTOMER" ? "/api/portal/me" : null);
  const { data: cart, mutate: mutCart } = useApi<CartView>(user?.role === "CUSTOMER" ? "/api/portal/cart" : null);
  const [line, setLineS] = useState(""); const [sheet, setSheet] = useState<string | null>(null); const [sheetQty, setSheetQty] = useState(0); const [cartOpen, setCartOpen] = useState(false);
  useEffect(() => { if (!loading && (!user || user.role !== "CUSTOMER")) router.replace(user ? "/dashboard" : "/login"); }, [user, loading, router]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (me && !line) setLineS(me.lines[0]?.id ?? me.firm.linesEnabled[0]); }, [me, line]);
  const reload = () => { mutMe(); mutCart(); refresh("/api/portal"); };
  // Asking for more than there is should not end the conversation. When the
  // shortfall comes back with a number, take what there is instead of refusing
  // — the same thing the item sheet offers, now in the cart too.
  const addLine = async (itemId: string, qty: number, mode: "add" | "set" = "add") => {
    try { await post("/api/portal/cart", { itemId, qty, mode }); mutCart(); mutMe(); return true; }
    catch (e) {
      const d = e instanceof ApiError ? (e.details as { available?: number; moq?: number } | undefined) : undefined;
      if (d?.available != null && d.moq != null && d.available >= d.moq) {
        try {
          await post("/api/portal/cart", { itemId, qty: d.available, mode: "set" });
          mutCart(); mutMe();
          toast(`सिर्फ़ ${d.available.toLocaleString("en-IN")} उपलब्ध — वही जोड़े गए`, "w");
          return true;
        } catch { /* fall through to the plain message */ }
      }
      toast(e instanceof Error ? e.message : "Error", "e");
      return false;
    }
  };
  const rmLine = async (itemId: string) => { await del(`/api/portal/cart/${itemId}`); mutCart(); mutMe(); };
  if (loading || !user || !me) return <div className="loading">Loading…</div>;
  return <C.Provider value={{ me, line: line || me.lines[0]?.id || me.firm.linesEnabled[0], setLine: setLineS, sheet, openSheet: (id, q) => { setSheet(id); setSheetQty(q ?? 0); setCartOpen(false); }, closeSheet: () => { setSheet(null); setCartOpen(false); }, sheetQty, cartOpen, openCart: () => { if (!cart?.count) return toast("कार्ट खाली है", "i"); setSheet(null); setCartOpen(true); }, cart: cart ?? null, addLine, rmLine, reload }}>{children}</C.Provider>;
}
export const usePortal = () => { const c = useContext(C); if (!c) throw new Error("usePortal outside provider"); return c; };
