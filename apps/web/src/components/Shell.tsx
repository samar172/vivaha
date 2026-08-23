"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useAppState } from "@/lib/app-state";
import { useApi, useGodowns, useLines } from "@/lib/hooks";
import { post } from "@/lib/api";
import { useUI } from "@/lib/ui";
import { money, num, fDT, type Perm } from "@vivaha/shared";
import { ROLE_LABELS } from "@vivaha/shared";
import { Icon, KIND_ICON, type IconName } from "./icons";

export const NAV: { g: string; items: { k: string; l: string; i: IconName; perm: Perm }[] }[] = [
  { g: "Overview", items: [{ k: "dashboard", l: "Dashboard", i: "grid", perm: "dash.view" }] },
  { g: "Catalogue", items: [{ k: "items", l: "Items & Rates", i: "tag", perm: "item.view" }] },
  { g: "Supply", items: [{ k: "purchase", l: "Purchase & GRN", i: "inbox", perm: "purchase.view" }, { k: "stock", l: "Inventory", i: "warehouse", perm: "stock.view" }] },
  { g: "Sales", items: [{ k: "customers", l: "Customers", i: "users", perm: "cust.view" }, { k: "orders", l: "Orders", i: "receipt", perm: "order.view" }, { k: "dispatch", l: "Dispatch", i: "truck", perm: "order.dispatch" }, { k: "jobs", l: "Job Work", i: "printer", perm: "order.view" }, { k: "returns", l: "Returns", i: "undo", perm: "return.view" }] },
  { g: "Finance", items: [{ k: "accounts", l: "Ledger & GST", i: "rupee", perm: "ledger.view" }] },
  { g: "Insight", items: [{ k: "reports", l: "Reports", i: "chart", perm: "report.view" }, { k: "audit", l: "Audit Log", i: "history", perm: "audit.view" }] },
  { g: "System", items: [{ k: "settings", l: "Settings", i: "sliders", perm: "settings.manage" }] },
];

interface FootState { count: number | null; filter: string; page: number; pages: number; setPage: (p: number) => void }
const FootCtx = createContext<{ set: (s: Partial<FootState>) => void; foot: FootState } | null>(null);
export function useFooter(count: number | null, filter = "", page = 1, pages = 1, setPage: (p: number) => void = () => {}) {
  const c = useContext(FootCtx);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { c?.set({ count, filter, page, pages, setPage }); }, [count, filter, page, pages]); // eslint-disable-line react-hooks/exhaustive-deps
}
export function usePager<T>(rows: T[], size = 14) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pages);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [rows.length]);
  return { page: p, pages, setPage, rows: rows.slice((p - 1) * size, p * size) };
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, loading, logout, can } = useAuth(); const router = useRouter(); const pathname = usePathname();
  const { line, setLine, godown, setGodown, sbCol, toggleSb } = useAppState();
  const { data: lines } = useLines(); const { data: godowns } = useGodowns();
  const [mob, setMob] = useState(false); const [nt, setNt] = useState(false); const [pal, setPal] = useState<string | null>(null);
  const [foot, setFootS] = useState<FootState>({ count: null, filter: "", page: 1, pages: 1, setPage: () => {} });
  const { data: notifs, mutate: mutNotifs } = useApi<{ notifications: { id: string; text: string; kind: string; isRead: boolean; createdAt: string; link: string | null }[]; unread: number }>(user && user.role !== "CUSTOMER" ? "/api/notifications" : null, { refreshInterval: 20000 });
  const { data: counts } = useApi<{ counts: Record<string, number> }>(user && can("order.view") ? "/api/orders?tab=approve" : null, { refreshInterval: 30000 });
  const { data: rets } = useApi<{ status: string }[]>(user && can("return.view") ? "/api/returns" : null, { refreshInterval: 60000 });
  const { data: jobs } = useApi<{ status: string }[]>(user && can("order.view") ? "/api/jobs" : null, { refreshInterval: 60000 });
  useEffect(() => { if (!loading && (!user || user.role === "CUSTOMER")) router.replace(user ? "/portal" : "/login"); }, [loading, user, router]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMob(false); }, [pathname]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPal(""); } else if (e.key === "Escape") { setPal(null); setNt(false); } else if (e.key === "[" && !/input|textarea|select/i.test((document.activeElement as HTMLElement)?.tagName)) toggleSb(); else if (e.key === "/" && !/input|textarea|select/i.test((document.activeElement as HTMLElement)?.tagName)) { const f = document.querySelector<HTMLInputElement>(".tsr input"); if (f) { e.preventDefault(); f.focus(); } } }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, [toggleSb]);
  const ctx = useMemo(() => ({ foot, set: (s: Partial<FootState>) => setFootS((f) => ({ ...f, ...s })) }), [foot]);
  if (loading || !user) return <div className="loading">Loading…</div>;
  const navCount = (k: string) => k === "orders" ? counts?.counts.approve || null : k === "dispatch" ? counts?.counts.dispatch || null : k === "returns" ? rets?.filter((r) => r.status !== "ACCEPTED" && r.status !== "REJECTED").length || null : k === "jobs" ? jobs?.filter((j) => j.status !== "DELIVERED").length || null : null;
  const gdLabel = godown === "ALL" ? "All godowns" : godowns?.find((g) => g.id === godown)?.name ?? godown;
  return (
    <FootCtx.Provider value={ctx}>
      <div className="erp">
        <div className="gh">
          <button className="gi" style={{ display: "none" }} id="mobMenu" onClick={() => setMob((m) => !m)}><Icon n="menu" s={17} /></button>
          <div className="br"><div className="m">VC</div><span className="t">Vivaha Cards</span></div>
          <div className="lsw">{lines?.map((l) => <button key={l.id} className={line === l.id ? "on" : ""} onClick={() => setLine(l.id)}><span className="ld" style={{ background: l.color }} />{l.name}</button>)}<button className={line === "ALL" ? "on" : ""} onClick={() => setLine("ALL")}>All</button></div>
          <button className="gsel" onClick={() => setPal("godown ")}><Icon n="pin" s={13} /><span>{gdLabel}</span><Icon n="chevronD" s={12} style={{ opacity: .6 }} /></button>
          <div className="dbadge">DEMO</div>
          <button className="gsr" onClick={() => setPal("")}><Icon n="search" s={13} /><span className="lbl">Search orders, customers, SKUs…</span><kbd>⌘K</kbd></button>
          <button className="gi" onClick={() => setNt((v) => !v)} title="Notifications"><Icon n="bell" s={16} />{!!notifs?.unread && <span className="bg">{notifs.unread}</span>}</button>
          <div className="rch"><Icon n="user" s={13} /><span>{ROLE_LABELS[user.role]}</span></div>
          <button className="av" onClick={() => logout().then(() => router.replace("/login"))} title="Sign out">{user.initials}</button>
        </div>
        <div className="shell">
          <aside className={"sb" + (sbCol ? " col" : "") + (mob ? " mob" : "")}>
            <nav className="sbn">{NAV.map((g) => { const its = g.items.filter((i) => can(i.perm)); if (!its.length) return null; return <div className="ng" key={g.g}><div className="nl">{g.g}</div>{its.map((i) => { const c = navCount(i.k); const on = pathname.startsWith("/" + i.k); return <Link href={"/" + i.k} key={i.k} className={"ni" + (on ? " on" : "")}><span className="ic"><Icon n={i.i} s={16} /></span><span>{i.l}</span>{c ? <span className="ct">{c}</span> : null}</Link>; })}</div>; })}</nav>
            <button className="sbc" onClick={toggleSb}><Icon n={sbCol ? "chevronR" : "chevronL"} s={15} /></button>
          </aside>
          <div className="ws">{children}</div>
        </div>
        <footer className="ft">
          <span><span className="sd" />Synced · {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          <span>{foot.count == null ? "— records" : num(foot.count) + " record" + (foot.count === 1 ? "" : "s")}</span>
          <span style={{ opacity: .85 }}>{foot.filter}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}><kbd>⌘K</kbd> palette <kbd>/</kbd> filter <kbd>Esc</kbd> close</span>
          <div className="pg"><button className="pb" onClick={() => foot.setPage(Math.max(1, foot.page - 1))}>Prev</button><span>Page {foot.page} of {foot.pages}</span><button className="pb" onClick={() => foot.setPage(Math.min(foot.pages, foot.page + 1))}>Next</button></div>
        </footer>
      </div>
      <div className={"ov" + (nt ? " on" : "")} onClick={() => setNt(false)} />
      <div className={"dr" + (nt ? " on" : "")} style={{ width: 370 }}>
        <div className="drh"><strong style={{ fontSize: 13 }}>Notifications</strong><button className="b b-g b-s" style={{ marginLeft: "auto" }} onClick={() => post("/api/notifications/read-all").then(() => mutNotifs())}>Mark all read</button><button className="b b-g b-s" onClick={() => setNt(false)}><Icon n="x" s={13} /></button></div>
        <div className="drb">{notifs?.notifications.length ? notifs.notifications.map((n) => <div className="ds" key={n.id} style={{ opacity: n.isRead ? .55 : 1, cursor: n.link ? "pointer" : "default" }} onClick={() => { post(`/api/notifications/${n.id}/read`).then(() => mutNotifs()); if (n.link) { setNt(false); router.push(n.link); } }}><div style={{ display: "flex", gap: 9 }}><span style={{ color: `var(--${({ WARN: "wa", OK: "ok", ERR: "er", INFO: "in" } as Record<string, string>)[n.kind]})`, marginTop: 2 }}><Icon n={KIND_ICON[n.kind] ?? "info"} s={14} /></span><div><div style={{ fontSize: 12, lineHeight: 1.5 }}>{n.text}</div><div className="sm" style={{ marginTop: 3 }}>{fDT(n.createdAt)}</div></div></div></div>) : <div className="empty"><div className="t">Nothing new</div><div className="d">You are all caught up.</div></div>}</div>
      </div>
      {pal !== null && <Palette initial={pal} onClose={() => setPal(null)} setGodown={(g) => { setGodown(g); setPal(null); }} godowns={godowns ?? []} />}
    </FootCtx.Provider>
  );
}

function Palette({ initial, onClose, setGodown, godowns }: { initial: string; onClose: () => void; setGodown: (g: string) => void; godowns: { id: string; name: string }[] }) {
  const [q, setQ] = useState(initial); const router = useRouter(); const { can } = useAuth();
  const { data } = useApi<{ orders: { id: string; firm: string; status: string }[]; items: { id: string; sku: string; name: string; available: number }[]; customers: { id: string; name: string; outstanding: number }[] }>(q.trim().length > 1 && !q.startsWith("godown") ? `/api/search?q=${encodeURIComponent(q.trim())}` : null);
  const ql = q.toLowerCase().trim();
  const nav = NAV.flatMap((g) => g.items).filter((i) => can(i.perm) && (!ql || i.l.toLowerCase().includes(ql)));
  const go = (href: string) => { onClose(); router.push(href); };
  return (
    <div className="pv on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pl"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command, order number, SKU or customer…" />
        <div className="plr">
          {nav.length > 0 && <><div className="plg">Go to</div>{nav.slice(0, 6).map((i) => <div className="pli" key={i.k} onClick={() => go("/" + i.k)}><span className="ic"><Icon n={i.i} s={15} /></span>{i.l}</div>)}</>}
          {ql.startsWith("godown") && <><div className="plg">Godown</div>{[{ id: "ALL", name: "All godowns" }, ...godowns].map((g) => <div className="pli" key={g.id} onClick={() => setGodown(g.id)}><span className="ic"><Icon n="pin" s={15} /></span>{g.name}</div>)}</>}
          {data?.orders.length ? <><div className="plg">Orders</div>{data.orders.map((o) => <div className="pli" key={o.id} onClick={() => go(`/orders?open=${o.id}`)}><span className="ic"><Icon n="receipt" s={15} /></span>{o.id} — {o.firm}<kbd>{o.status.replace(/_/g, " ")}</kbd></div>)}</> : null}
          {data?.items.length ? <><div className="plg">Items</div>{data.items.map((i) => <div className="pli" key={i.id} onClick={() => go(`/items?open=${i.id}`)}><span className="ic"><Icon n="tag" s={15} /></span>{i.sku} — {i.name}<kbd>{num(i.available)}</kbd></div>)}</> : null}
          {data?.customers.length ? <><div className="plg">Customers</div>{data.customers.map((c) => <div className="pli" key={c.id} onClick={() => go(`/customers?open=${c.id}`)}><span className="ic"><Icon n="users" s={15} /></span>{c.name}<kbd>{money(c.outstanding)}</kbd></div>)}</> : null}
          {!nav.length && !data?.orders.length && !data?.items.length && !data?.customers.length && !ql.startsWith("godown") && <div className="plg">No matches</div>}
        </div></div>
    </div>
  );
}
