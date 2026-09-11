"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { money, num, fDT } from "@vivaha/shared";
import type { Band } from "@vivaha/shared";
import { useLines } from "@/lib/hooks";
import { thumb } from "@/lib/art";
import { Icon } from "@/components/icons";

const PILL: Record<string, string> = { DELIVERED: "b-ok", APPROVED: "b-ok", RECEIVED: "b-ok", POSTED: "b-ok", ACCEPTED: "b-ok", ACTIVE: "b-ok", Active: "b-ok", "Good stock": "b-ok",
  BOOKED: "b-wa", PICKING: "b-wa", READY_TO_DISPATCH: "b-wa", PARTIALLY_DISPATCHED: "b-wa", IN_TRANSIT: "b-wa", INSPECTION: "b-wa", QUOTED: "b-wa", PROOF_SENT: "b-wa", REQUESTED: "b-wa", Damaged: "b-wa",
  REJECTED: "b-er", CANCELLED: "b-er", LAPSED: "b-er", DISCONTINUED: "b-er", Blocked: "b-er", Rejected: "b-er",
  RESERVED: "b-in", ALLOCATED: "b-in", PICKED: "b-in", PACKED: "b-in", DISPATCHED: "b-in", PRINTING: "b-in", APPROVED_PROOF: "b-in" };
export const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace("To Dispatch", "to Dispatch");
export const Pill = ({ s, text }: { s: string; text?: string }) => <span className={"bd " + (PILL[s] || "b-nu")}>{text ?? label(s)}</span>;
export const BandPill = ({ b }: { b: Band | null | undefined }) => b ? <span className={"bd b-" + ({ ok: "ok", warn: "wa", err: "er", neu: "nu" } as const)[b.cls]}>{b.label}</span> : <span className="sm">—</span>;

export function LineChip({ id }: { id: string }) { const { data } = useLines(); const L = data?.find((l) => l.id === id); return L ? <span className="lchip" style={{ background: L.bg, color: L.color }}>{L.icon} {L.name}</span> : <span className="lchip">{id}</span>; }
export function LineDot({ id }: { id: string }) { const { data } = useLines(); const L = data?.find((l) => l.id === id); return <span className="ld" style={{ background: L?.color, opacity: 1 }} title={L?.name} />; }
export const Thumb = ({ it, w, h, style }: { it: { lineId: string; artSeed: number; imageUrl?: string | null }; w: number; h: number; style?: React.CSSProperties }) => <img className="cw" src={thumb(it, w, h)} alt="" style={{ width: Math.round(w * 0.7), border: "1px solid var(--bd)", ...style }} />;
export const GateDot = ({ status }: { status: string }) => <span className="tl" style={{ background: ({ ok: "#15803D", near: "#B45309", warn: "#B45309", block: "#BE123C" } as Record<string, string>)[status] }} />;
export const Bar = ({ pct, color }: { pct: number; color?: string }) => <div className="bar"><i style={{ width: Math.min(100, pct) + "%", background: color ?? "var(--ac)" }} /></div>;

// Anchors a fixed-position hover preview beside an element, clamped to the
// viewport. Fixed rather than absolute because .wa scrolls and would clip it.
export function useZoomAnchor<T extends HTMLElement>(w: number, h: number) {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const open = () => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const pad = 12;
    let left = r.right + pad;
    if (left + w + pad > window.innerWidth) left = r.left - w - pad;
    if (left < pad) left = Math.max(pad, Math.round((window.innerWidth - w) / 2));
    const top = Math.min(Math.max(pad, r.top + r.height / 2 - h / 2), Math.max(pad, window.innerHeight - h - pad - 40));
    setPos({ left, top });
  };
  const close = () => setPos(null);
  return { ref, pos, handlers: { onMouseEnter: open, onMouseLeave: close, onFocus: open, onBlur: close, tabIndex: 0 } };
}

// Thumbnail that shows a full-size preview on hover. The artwork is procedural
// SVG, so the large render is generated at the bigger size rather than scaled up.
export function ZoomThumb({ it, w, h, zoom = 300, caption, style }: { it: { lineId: string; artSeed: number; imageUrl?: string | null }; w: number; h: number; zoom?: number; caption?: ReactNode; style?: React.CSSProperties }) {
  const zh = Math.round((zoom * h) / w);
  const { ref, pos, handlers } = useZoomAnchor<HTMLImageElement>(zoom, zh + 60);
  return <>
    <img ref={ref} className="cw" src={thumb(it, w, h)} alt="" {...handlers}
      style={{ width: Math.round(w * 0.7), border: "1px solid var(--bd)", cursor: "zoom-in", ...style }} />
    {pos && <div className="zoomp" style={{ left: pos.left, top: pos.top, width: zoom }}>
      <img src={thumb(it, zoom, zh)} alt="" style={{ width: "100%", display: "block", borderRadius: 4 }} />
      {caption && <div className="zoomc">{caption}</div>}
    </div>}
  </>;
}
export const KPI = ({ l, v, d, cls, onClick }: { l: string; v: ReactNode; d?: ReactNode; cls?: string; onClick?: () => void }) => <div className="kpi" onClick={onClick}><div className="l">{l}</div><div className="v">{v}</div>{d && <div className={"d " + (cls ?? "")}>{d}</div>}</div>;
export const Empty = ({ t, d, action }: { t: string; d?: string; action?: ReactNode }) => <div className="empty"><div className="t">{t}</div>{d && <div className="d">{d}</div>}{action}</div>;
export const DF = ({ k, v, mono, strong }: { k: ReactNode; v: ReactNode; mono?: boolean; strong?: boolean }) => <div className="df" style={strong ? { borderTop: "1px solid var(--bd-soft)", marginTop: 5, paddingTop: 7 } : undefined}><span className="k">{strong ? <b>{k}</b> : k}</span><span className={"v" + (mono ? " m" : "")} style={strong ? { fontWeight: 700 } : undefined}>{v}</span></div>;
export const Section = ({ t, children, style }: { t?: ReactNode; children: ReactNode; style?: React.CSSProperties }) => <div className="ds" style={style}>{t && <div className="st">{t}</div>}{children}</div>;
export const Panel = ({ t, h, children, style }: { t: ReactNode; h?: ReactNode; children: ReactNode; style?: React.CSSProperties }) => <div className="pn" style={style}><div className="pnh"><h3>{t}</h3>{h && <span className="h">{h}</span>}</div>{children}</div>;
export const Timeline = ({ rows }: { rows: { t: ReactNode; n: ReactNode }[] }) => <>{rows.map((r, i) => <div className="ti" key={i}><span className="dt" /><div><div>{r.t}</div><div className="wn">{r.n}</div></div></div>)}</>;

export function Hold({ until, onExpire }: { until: string | null | undefined; onExpire?: () => void }) {
  const [s, setS] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!until) { setS(null); return; } const tick = () => { const v = Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000)); setS(v); if (v <= 0) onExpire?.(); }; tick(); const id = setInterval(tick, 1000); return () => clearInterval(id); }, [until, onExpire]);
  if (s == null) return <span className="tab">—</span>;
  return <span className="tab" style={{ color: s < 300 ? "var(--er)" : s < 600 ? "var(--wa)" : undefined }}>{String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}</span>;
}
export const fmtMoney = money; export const fmtNum = num; export const fmtDT = fDT;

export function ModalFrame({ title, children, actions, onClose }: { title: ReactNode; children: ReactNode; actions: ReactNode; onClose: () => void }) {
  return <><div className="mh"><h3>{title}</h3><button className="b b-g b-s" onClick={onClose}><Icon n="x" s={13} /></button></div><div className="mbd">{children}</div><div className="ma">{actions}</div></>;
}
export const Field = ({ label, children, hint, full }: { label: string; children: ReactNode; hint?: ReactNode; full?: boolean }) => <div className={"fd" + (full ? " f" : "")}><label>{label}</label>{children}{hint && <div className="hint">{hint}</div>}</div>;
export const Note = ({ k, children, style }: { k?: "w" | "i" | "o"; children: ReactNode; style?: React.CSSProperties }) => <div className={"note " + (k ?? "")} style={style}>{children}</div>;
