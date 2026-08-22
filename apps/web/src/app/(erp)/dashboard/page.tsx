"use client";
import { useRouter } from "next/navigation";
import { money, num, fDate, dueLbl, AGEING_LABELS, ORDER_STATUS_LABEL, type OrderStatus } from "@vivaha/shared";
import { useApi, useLines } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { KPI, Panel, Bar, Hold, GateDot, Thumb, Empty } from "@/components/ui";
import { useUI } from "@/lib/ui";
import { OrderDrawer } from "@/components/OrderDrawer";
import { exportCsv } from "@/lib/csv";

interface Dash { kpis: { awaiting: number; expiringSoon: number; toDispatch: number; receivables: number; pastGate: number; billed30d: number; available: number; reserved: number; stockValue: number; damaged: number }; holds: { id: string; firm: string; tehsil: string; group: string; total: number; requiredBy: string; holdUntil: string | null; gate: { status: string; restricted: boolean; mode: string } }[]; pipeline: { status: string; count: number }[]; fastest: { item: { id: string; sku: string; name: string; lineId: string; artSeed: number; imageUrl: string | null; available: number }; qty: number }[]; ageing: number[]; notifs: { id: string; text: string; kind: string }[]; totalOrders: number }

export default function Dashboard() {
  const { line } = useAppState(); const { data: lines } = useLines(); const router = useRouter(); const { openDrawer } = useUI();
  const { data: d, mutate } = useApi<Dash>(`/api/dashboard?line=${line}`, { refreshInterval: 30000 });
  useFooter(d?.totalOrders ?? null);
  if (!d) return <div className="loading" style={{ height: 300 }}>Loading…</div>;
  const k = d.kpis; const mx = Math.max(1, ...d.pipeline.map((p) => p.count)); const amx = Math.max(1, ...d.ageing);
  return <>
    <PageHead crumb={["Overview", "Dashboard"]} title="Dashboard" sub={(line === "ALL" ? "All business lines" : lines?.find((l) => l.id === line)?.name) + " · " + new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} actions={<button className="b b-o" onClick={() => exportCsv("dashboard", ["Metric", "Value"], Object.entries(k))}>⤓ Export snapshot</button>} />
    <div className="wa">
      <div className="kpis c6">
        <KPI l="Awaiting approval" v={k.awaiting} d={k.expiringSoon ? k.expiringSoon + " expiring < 10 min" : "all holds healthy"} cls={k.expiringSoon ? "dn" : "up"} onClick={() => router.push("/orders")} />
        <KPI l="To dispatch" v={k.toDispatch} d="sorted by required-by" onClick={() => router.push("/dispatch")} />
        <KPI l="Receivables" v={money(k.receivables)} d={`${k.pastGate} firm${k.pastGate === 1 ? "" : "s"} past gate`} cls={k.pastGate ? "dn" : "up"} onClick={() => router.push("/accounts")} />
        <KPI l="Billed · 30d" v={money(k.billed30d)} d="taxable value" cls="up" onClick={() => router.push("/accounts")} />
        <KPI l="Available stock" v={num(k.available)} d={num(k.reserved) + " reserved"} onClick={() => router.push("/stock")} />
        <KPI l="Stock value" v={money(k.stockValue)} d={num(k.damaged) + " pcs damaged"} cls={k.damaged ? "dn" : ""} onClick={() => router.push("/stock")} />
      </div>
      <div className="g3"><div>
        <Panel t="Holds running out" h="Stock releases automatically and an alert is raised — BR-23">
          <div className="gw" style={{ border: "none", borderRadius: 0 }}><table className="dg"><thead><tr><th>Order</th><th>Firm</th><th className="n">Value</th><th>Required by</th><th>Credit</th><th className="n">Hold left</th></tr></thead><tbody>
            {d.holds.length ? d.holds.map((o) => <tr key={o.id} onClick={() => openDrawer(<OrderDrawer id={o.id} />)}><td><span className="rid">{o.id}</span></td><td className="w">{o.firm}<div className="sm">{o.tehsil} · {o.group}</div></td><td className="n tab">{money(o.total)}</td><td>{fDate(o.requiredBy)}<div className="sm">{dueLbl(o.requiredBy)}</div></td><td><GateDot status={o.gate.status} /> {o.gate.restricted ? (o.gate.mode === "BLOCK" ? "Blocked" : "Warn") : "OK"}</td><td className="n"><Hold until={o.holdUntil} onExpire={() => setTimeout(() => mutate(), 16000)} /></td></tr>) : <tr><td colSpan={6}><Empty t="No live holds" d="Every booking has been approved or has lapsed." /></td></tr>}
          </tbody></table></div>
        </Panel>
        <Panel t="Order pipeline" h={d.totalOrders + " orders"}><div className="pnb">{d.pipeline.map((p) => <div key={p.status} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><div style={{ width: 132, fontSize: 11.5, color: "var(--t6)" }}>{ORDER_STATUS_LABEL[p.status as OrderStatus]}</div><div style={{ flex: 1 }}><Bar pct={(p.count / mx) * 100} color={["LAPSED", "REJECTED", "CANCELLED"].includes(p.status) ? "var(--er)" : undefined} /></div><div className="tab" style={{ width: 34, textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{p.count}</div></div>)}</div></Panel>
      </div><div>
        <Panel t="Fastest moving" h="by quantity"><div className="pnb" style={{ padding: "8px 13px" }}>{d.fastest.map((x) => <div key={x.item.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", borderBottom: "1px solid var(--bd-soft)" }}><Thumb it={x.item} w={40} h={52} style={{ width: 32 }} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.item.name}</div><div className="sm">{x.item.sku} · avail {num(x.item.available)}</div></div><div className="tab" style={{ fontSize: 11.5, fontWeight: 700 }}>{num(x.qty)}</div></div>)}</div></Panel>
        <Panel t="Receivables ageing" h="all firms"><div className="pnb">{AGEING_LABELS.map((l, i) => <div key={l} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><div style={{ width: 62, fontSize: 11.5, color: "var(--t6)" }}>{l}</div><div style={{ flex: 1 }}><Bar pct={(d.ageing[i] / amx) * 100} color={i >= 3 ? "var(--er)" : i === 2 ? "var(--wa)" : undefined} /></div><div className="tab" style={{ width: 74, textAlign: "right", fontSize: 11 }}>{money(d.ageing[i])}</div></div>)}</div></Panel>
        <Panel t="Needs attention"><div className="pnb" style={{ padding: "9px 13px" }}>{d.notifs.map((n) => <div key={n.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--bd-soft)", fontSize: 11.5, lineHeight: 1.5 }}><span style={{ color: `var(--${({ WARN: "wa", OK: "ok", ERR: "er", INFO: "in" } as Record<string, string>)[n.kind]})` }}>{({ WARN: "⚠", OK: "✓", ERR: "✕", INFO: "ℹ" } as Record<string, string>)[n.kind]}</span><span>{n.text}</span></div>)}</div></Panel>
      </div></div>
    </div>
  </>;
}
