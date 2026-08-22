"use client";
import type { ReactNode } from "react";
export interface Tab { k: string; l: string; n?: number | null }
export function PageHead({ crumb, title, sub, actions, tabs, tab, onTab }: { crumb: string[]; title: string; sub?: ReactNode; actions?: ReactNode; tabs?: Tab[]; tab?: string; onTab?: (k: string) => void }) {
  return (
    <div className="wh">
      <div className="bc">{crumb.map((x, i) => i === crumb.length - 1 ? <span className="cur" key={i}>{x}</span> : <span key={i}>{x} <span>›</span></span>)}</div>
      <div className="wt"><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div><div className="wta">{actions}</div></div>
      {tabs && <div className="ts">{tabs.map((t) => <div key={t.k} className={"tb" + (tab === t.k ? " on" : "")} onClick={() => onTab?.(t.k)}>{t.l}{t.n != null && <span className="n">{t.n}</span>}</div>)}</div>}
    </div>
  );
}
