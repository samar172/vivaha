"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Icon, KIND_ICON } from "@/components/icons";
import { ApiError } from "@/lib/api";

type ToastKind = "s" | "e" | "w" | "i";
interface Toast { id: number; msg: string; k: ToastKind }
interface ModalSpec { body: ReactNode; cls?: string }
// Every detail view is a page now, so the only overlay left is the modal.
interface UI { toast: (msg: string, k?: ToastKind) => void; openModal: (body: ReactNode, cls?: string) => void; closeModal: () => void }
const Ctx = createContext<UI | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const toast = useCallback((msg: string, k: ToastKind = "i") => { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, msg, k }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800); }, []);
  const openModal = useCallback((body: ReactNode, cls?: string) => setModal({ body, cls }), []);
  const closeModal = useCallback(() => setModal(null), []);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") setModal(null); }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, []);
  return (
    <Ctx.Provider value={{ toast, openModal, closeModal }}>
      {children}
      <div className={"mo" + (modal ? " on" : "")} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}><div className={"mb " + (modal?.cls ?? "")}>{modal?.body}</div></div>
      <div className="tw">{toasts.map((t) => <div key={t.id} className={"to " + t.k}><span style={{ marginTop: 2 }}><Icon n={KIND_ICON[t.k] ?? "info"} s={15} /></span><span>{t.msg}</span></div>)}</div>
    </Ctx.Provider>
  );
}
export function useUI() { const c = useContext(Ctx); if (!c) throw new Error("useUI outside UIProvider"); return c; }
// The panel's language, read from the office setting and kept here so any
// toast can reach it without every caller threading it through. Set once when
// the shell loads; English until it is known, which is the default anyway.
let panelLang: "en" | "hi" = "en";
export const setPanelLang = (l: "en" | "hi") => { panelLang = l; };
export const getPanelLang = () => panelLang;

// A refusal from the API arrives in both languages when the server had a Hindi
// form for it. Everything else — an unexpected failure, a browser error — has
// only the one, and showing English is better than showing nothing.
export const errMsg = (e: unknown) => {
  if (e instanceof ApiError && panelLang === "hi" && e.messageHi) return e.messageHi;
  return e instanceof Error ? e.message : String(e);
};
