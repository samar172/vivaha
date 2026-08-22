"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface AppState { line: string; setLine: (l: string) => void; godown: string; setGodown: (g: string) => void; sbCol: boolean; toggleSb: () => void }
const Ctx = createContext<AppState | null>(null);
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [line, setLineS] = useState("L1"); const [godown, setGodownS] = useState("ALL"); const [sbCol, setSb] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const l = localStorage.getItem("vc.line"); if (l) setLineS(l); const g = localStorage.getItem("vc.godown"); if (g) setGodownS(g); } catch { /* ignore */ } }, []);
  const setLine = (l: string) => { setLineS(l); try { localStorage.setItem("vc.line", l); } catch { /* ignore */ } };
  const setGodown = (g: string) => { setGodownS(g); try { localStorage.setItem("vc.godown", g); } catch { /* ignore */ } };
  return <Ctx.Provider value={{ line, setLine, godown, setGodown, sbCol, toggleSb: () => setSb((v) => !v) }}>{children}</Ctx.Provider>;
}
export function useAppState() { const c = useContext(Ctx); if (!c) throw new Error("useAppState outside provider"); return c; }
