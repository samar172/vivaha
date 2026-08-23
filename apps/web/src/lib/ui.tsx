"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Icon, KIND_ICON } from "@/components/icons";

type ToastKind = "s" | "e" | "w" | "i";
interface Toast { id: number; msg: string; k: ToastKind }
interface ModalSpec { body: ReactNode; cls?: string }
interface UI { toast: (msg: string, k?: ToastKind) => void; openModal: (body: ReactNode, cls?: string) => void; closeModal: () => void; openDrawer: (body: ReactNode, width?: number) => void; closeDrawer: () => void; drawerOpen: boolean }
const Ctx = createContext<UI | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const [drawer, setDrawer] = useState<{ body: ReactNode; width?: number } | null>(null);
  const toast = useCallback((msg: string, k: ToastKind = "i") => { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, msg, k }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800); }, []);
  const openModal = useCallback((body: ReactNode, cls?: string) => setModal({ body, cls }), []);
  const closeModal = useCallback(() => setModal(null), []);
  const openDrawer = useCallback((body: ReactNode, width?: number) => setDrawer({ body, width }), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") { setModal(null); setDrawer(null); } }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, []);
  return (
    <Ctx.Provider value={{ toast, openModal, closeModal, openDrawer, closeDrawer, drawerOpen: !!drawer }}>
      {children}
      <div className={"ov" + (drawer ? " on" : "")} onClick={closeDrawer} />
      <div className={"dr" + (drawer ? " on" : "")} style={drawer?.width ? { width: drawer.width } : undefined}>{drawer?.body}</div>
      <div className={"mo" + (modal ? " on" : "")} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}><div className={"mb " + (modal?.cls ?? "")}>{modal?.body}</div></div>
      <div className="tw">{toasts.map((t) => <div key={t.id} className={"to " + t.k}><span style={{ marginTop: 2 }}><Icon n={KIND_ICON[t.k] ?? "info"} s={15} /></span><span>{t.msg}</span></div>)}</div>
    </Ctx.Provider>
  );
}
export function useUI() { const c = useContext(Ctx); if (!c) throw new Error("useUI outside UIProvider"); return c; }
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
