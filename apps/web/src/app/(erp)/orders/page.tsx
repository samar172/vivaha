"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { money, fDate, dueLbl, daysTo, orderProgress, ORDER_STATUS_LABEL, type OrderStatus } from "@vivaha/shared";
import { useApi, useLines, refresh } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useUI, errMsg } from "@/lib/ui";
import { useAuth } from "@/lib/auth-context";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { Pill, LineChip, GateDot, Hold, Empty, Bar } from "@/components/ui";
import { useOrderActions } from "@/components/OrderDetail";
import { NewOrderModal } from "@/components/NewOrderModal";
import type { Order } from "@/components/types";
import { exportCsv } from "@/lib/csv";
import { Icon } from "@/components/icons";

const CLOSED = ["LAPSED", "REJECTED", "CANCELLED"];
export default function OrdersPage() {
  const { line } = useAppState(); const { data: lines } = useLines(); const { openModal, toast } = useUI(); const { can } = useAuth(); const router = useRouter(); const sp = useSearchParams(); const A = useOrderActions();
  const [tab, setTab] = useState(() => sp.get("tab") ?? "approve"); const [q, setQ] = useState(""); const [sel, setSel] = useState<Set<string>>(new Set()); const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  // The dashboard links straight into a stage, e.g. /orders?tab=active&status=PICKING.
  const [status, setStatus] = useState<string | null>(() => sp.get("status"));
  const { data, mutate } = useApi<{ orders: Order[]; counts: Record<string, number> }>(`/api/orders?tab=${tab}&line=${line}&q=${encodeURIComponent(q)}`, { refreshInterval: 20000 });
  useEffect(() => { const o = sp.get("open"); if (o) router.push(`/orders/${o}`); }, [sp, router]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const t = sp.get("tab"); if (t) setTab(t); setStatus(sp.get("status")); }, [sp]);
  let rows = data?.orders ?? []; if (status) rows = rows.filter((o) => o.status === status);
  if (sort && tab !== "approve") rows = rows.slice().sort((a, b) => ((sort.k === "total" ? a.total - b.total : new Date(a.requiredBy).getTime() - new Date(b.requiredBy).getTime()) * sort.d));
  const pg = usePager(rows); useFooter(rows.length, line === "ALL" ? "" : lines?.find((l) => l.id === line)?.name ?? "", pg.page, pg.pages, pg.setPage);
  const cnt = data?.counts ?? {};
  const bulk = async () => { try { const r = await post<{ approved: number; skipped: number }>("/api/orders/bulk-approve", { ids: [...sel] }); toast(`${r.approved} approved${r.skipped ? ` · ${r.skipped} skipped, credit gate not green — open individually` : ""}`, r.skipped ? "w" : "s"); setSel(new Set()); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  const sortBy = (k: string) => setSort((s) => ({ k, d: s?.k === k && s.d === 1 ? -1 : 1 })); const ic = (k: string) => sort?.k === k ? (sort.d === 1 ? " ↑" : " ↓") : "";
  return <>
    <PageHead crumb={["Sales", "Orders"]} title="Orders" sub="Booking → approval → reservation → allocation → pick → pack → dispatch. Lapsed holds keep the intent; partial dispatch creates a backorder." actions={<><button className="b b-o" onClick={() => exportCsv("orders", ["Order", "Firm", "Status", "Lines", "Taxable", "Tax", "Total", "Required by", "Created"], rows.map((o) => [o.id, o.customer.name, o.status, o.lines.length, o.subtotal, o.tax, o.total, fDate(o.requiredBy), fDate(o.createdAt)]))}><Icon n="download" s={13} /> Export</button>{can("order.create") && <button className="b b-p" onClick={() => openModal(<NewOrderModal />, "w")}>+ New order</button>}</>}
      tabs={[{ k: "approve", l: "Awaiting approval", n: cnt.approve }, { k: "active", l: "In fulfilment", n: cnt.active }, { k: "shipped", l: "Shipped", n: cnt.shipped }, { k: "closed", l: "Closed", n: cnt.closed }, { k: "all", l: "All", n: cnt.all }]} tab={tab} onTab={(k) => { setTab(k); setStatus(null); setSel(new Set()); }} />
    <div className={"bulk" + (sel.size ? " on" : "")}>{sel.size ? <>{sel.size} selected · <button className="b b-o b-s" onClick={bulk}>Approve green only</button> <button className="b b-g b-s" onClick={() => setSel(new Set())}>Clear</button></> : null}</div>
    <div className="wa">
      <div className="tbar"><div className="tsr"><Icon n="search" s={13} /><input placeholder="Order number or firm…" value={q} onChange={(e) => setQ(e.target.value)} /></div>{status && <button className="b b-o b-s" onClick={() => setStatus(null)}>{ORDER_STATUS_LABEL[status as OrderStatus] ?? status} only <Icon n="x" s={11} style={{ display: "inline", verticalAlign: "-1px", marginLeft: 3 }} /></button>}{tab === "approve" && !status && <span style={{ fontSize: 12.5, color: "var(--t4)" }}>Sorted by hold remaining — the order about to lapse is always first</span>}<span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{rows.length} shown</span></div>
      <div className="gw"><table className="dg"><thead><tr><th style={{ width: 30 }}></th>{tab === "approve" && <th className="n">Hold left</th>}<th>Order</th><th>Firm</th><th>Lines</th><th className="n sortable" onClick={() => sortBy("total")}>Value{ic("total")}</th><th className="n sortable" onClick={() => sortBy("req")}>Required by{ic("req")}</th><th>Credit</th><th>Status</th><th>Progress</th><th></th></tr></thead><tbody>
        {pg.rows.length ? pg.rows.map((o) => { const c = o.customer, g = o.gate; const rd = daysTo(o.requiredBy), urgent = rd >= 0 && rd <= 7 && !["DELIVERED", "DISPATCHED", ...CLOSED].includes(o.status); const closed = CLOSED.includes(o.status);
          return <tr key={o.id} className={(sel.has(o.id) ? "sel" : "") + (closed ? " dim" : "")} onClick={() => router.push(`/orders/${o.id}`)}>
            <td onClick={(e) => { e.stopPropagation(); setSel((s) => { const n = new Set(s); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; }); }}><input className="ck" type="checkbox" checked={sel.has(o.id)} readOnly /></td>
            {tab === "approve" && <td className="n"><Hold until={o.holdUntil} onExpire={() => setTimeout(() => mutate(), 16000)} /></td>}
            <td><span className="rid">{o.id}</span><div className="sm">{fDate(o.createdAt)}</div></td><td className="w">{c.name}<div className="sm">{c.tehsil} · {c.group}</div></td>
            <td className="w">{[...new Set(o.lines.map((l) => l.lineId))].map((l) => <LineChip key={l} id={l} />)}<div className="sm">{o.lines.length} line{o.lines.length === 1 ? "" : "s"}</div></td>
            <td className="n tab" style={{ fontWeight: 600, color: "var(--t9)" }}>{money(o.total)}<div className="sm">+{money(o.tax)} GST</div></td>
            <td>{fDate(o.requiredBy)}<div className="sm" style={{ color: urgent ? "var(--er)" : "var(--t4)" }}>{dueLbl(o.requiredBy)}{urgent ? <Icon n="alert" s={11} style={{ display: "inline", verticalAlign: "-1px", marginLeft: 3 }} /> : null}</div></td>
            <td><GateDot status={g.status} /> {g.restricted ? (g.mode === "BLOCK" ? "Blocked" : "Warn") : g.status === "near" ? "Near" : "OK"}</td><td><Pill s={o.status} /></td>
            <td style={{ minWidth: 90 }}><div style={{ width: 74 }}><Bar pct={orderProgress(o.status as OrderStatus) * 100} color={closed ? "var(--er)" : undefined} /></div></td><td>{A.actionBtn(o)}</td></tr>; })
          : <tr><td colSpan={11}><Empty t="Nothing here" d="No orders in this stage for the selected line." action={<button className="b b-o" onClick={() => { setTab("all"); setQ(""); }}>Show all orders</button>} /></td></tr>}
      </tbody></table></div>
    </div>
  </>;
}
