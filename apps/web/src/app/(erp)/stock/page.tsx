"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { money, num, fDate, locationCode } from "@vivaha/shared";
import { useApi, useGodowns, refresh } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { Pill, BandPill, LineChip, Empty, Note, Panel, ZoomThumb, useZoomAnchor } from "@/components/ui";
import { Qr } from "@/components/Qr";
import { AdjustModal, TransferModal } from "@/components/ItemDetail";
import type { ItemView } from "@/components/types";
import { exportCsv } from "@/lib/csv";
import { Icon } from "@/components/icons";

type Row = ItemView & { valueAtCost: number };

// Small QR in the row; hover blows it up to something a phone can actually read.
function QrCell({ code, kind, name }: { code: string; kind: "OWN" | "MANUFACTURER" | null; name: string }) {
  const { ref, pos, handlers } = useZoomAnchor<HTMLSpanElement>(230, 300);
  return <>
    <span ref={ref} {...handlers} style={{ display: "inline-block", cursor: "zoom-in", lineHeight: 0 }}>
      <Qr value={code} size={28} />
    </span>
    {pos && <div className="zoomp" style={{ left: pos.left, top: pos.top, width: 230, textAlign: "center" }}>
      <Qr value={code} size={214} style={{ margin: "0 auto" }} />
      <div className="zoomc" style={{ textAlign: "center" }}>
        <b style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{code}</b><br />{name}<br />
        <span style={{ color: kind === "OWN" ? "var(--ok)" : "var(--wa)" }}>{kind === "OWN" ? "Vivaha Cards label" : "Manufacturer label — not re-labelled yet"}</span>
      </div>
    </div>}
  </>;
}
export default function StockPage() {
  const { line, godown, setGodown } = useAppState(); const { data: godowns } = useGodowns(); const { can } = useAuth(); const { openModal, toast } = useUI(); const router = useRouter();
  const sp = useSearchParams(); const [tab, setTab] = useState(() => sp.get("tab") ?? "pos");
  // Reports links in as /stock?tab=dead — honour it on arrival and on later
  // navigations, the same way /accounts takes its tab and bucket.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const t = sp.get("tab"); if (t) setTab(t); }, [sp]);
   const [q, setQ] = useState(""); const [sortAvail, setSortAvail] = useState<0 | 1 | -1>(0);
  const { data } = useApi<Row[]>(`/api/stock/position?line=${line}&q=${encodeURIComponent(q)}&godown=${godown}`);
  const { data: trf } = useApi<{ id: string; item: { sku: string; name: string; uom: string }; fromId: string; toId: string; qty: number; at: string; by: string; status: string; receivedAt: string | null }[]>("/api/stock/transfers");
  let rows = data ?? []; if (sortAvail) rows = rows.slice().sort((a, b) => (a.available - b.available) * sortAvail);
  const pg = usePager(rows); useFooter(tab === "pos" ? rows.length : tab === "trf" ? trf?.length ?? 0 : 0, godown === "ALL" ? "" : "Godown " + godown, pg.page, pg.pages, pg.setPage);
  return <>
    <PageHead crumb={["Supply", "Inventory"]} title="Inventory" sub="Five buckets per item × godown × batch · availability computed live, never from a day-start snapshot" tabs={[{ k: "pos", l: "Stock position", n: rows.length }, { k: "trf", l: "Transfers", n: trf?.length }, { k: "age", l: "Ageing" }, { k: "dead", l: "Dead stock" }, { k: "exp", l: "Expiry watch" }]} tab={tab} onTab={setTab}
      actions={<><button className="b b-o" onClick={() => exportCsv("stock", ["SKU", "Name", "On hand", "Reserved", "Hold", "Damaged", "Quarantined", "Available", "Value"], rows.map((i) => [i.sku, i.name, i.onHand, i.reserved, i.hold, i.damaged, i.quarantined, i.available, i.valueAtCost]))}><Icon n="download" s={13} /> Export</button>{can("stock.transfer") && <button className="b b-o" onClick={() => openModal(<TransferModal />)}><Icon n="swap" s={13} /> Transfer</button>}{can("stock.adjust") && <button className="b b-o" onClick={() => openModal(<AdjustModal />)}>Adjust</button>}{can("stock.adjust") && <button className="b b-p" onClick={() => toast("Count session — freeze, scan, post variance", "i")}>Physical count</button>}</>} />
    <div className="wa">
      {tab === "pos" && <><div className="tbar"><div className="tsr"><Icon n="search" s={13} /><input placeholder="SKU or name…" value={q} onChange={(e) => setQ(e.target.value)} /></div><select value={godown} onChange={(e) => setGodown(e.target.value)} style={{ height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 8px" }}><option value="ALL">All godowns</option>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select><span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>available = on hand − reserved − hold − damaged − quarantined</span></div>
        <div className="gw"><table className="dg"><thead><tr><th style={{ width: 34 }}></th><th style={{ width: 40 }}>QR</th><th>Item</th><th>Line</th><th className="n">On hand</th><th className="n">Reserved</th><th className="n">Hold</th><th className="n">Damaged</th><th className="n">Quarantined</th><th className="n sortable" onClick={() => setSortAvail((s) => s === 1 ? -1 : 1)}>Available{sortAvail === 1 ? " ↑" : sortAvail === -1 ? " ↓" : ""}</th><th>Band</th><th className="n">Value at cost</th></tr></thead><tbody>
          {pg.rows.map((i) => <tr key={i.id} onClick={() => router.push(`/items/${i.id}`)}><td onClick={(e) => e.stopPropagation()} style={{ padding: "4px 6px" }}><ZoomThumb it={i} w={34} h={44} zoom={300} style={{ width: 26 }} caption={<><b>{i.name}</b><br />{i.designNo ? i.designNo + " · " : ""}{i.sku}<br />{num(i.available)} {i.uom.toLowerCase()} available of {num(i.onHand)} on hand</>} /></td>
            <td onClick={(e) => e.stopPropagation()} style={{ padding: "4px 6px" }}>{i.code ? <QrCell code={i.code} kind={i.codeKind} name={i.name} /> : <span className="bd b-wa">none</span>}</td>
            <td className="w"><span className="rid">{i.sku}</span> {i.name}<div className="sm">{i.code ? <>{i.code}{i.codeKind === "MANUFACTURER" && <span className="bd b-wa" style={{ marginLeft: 5 }}>factory label</span>}</> : (i.designNo || i.uom)}</div></td><td><LineChip id={i.lineId} /></td><td className="n tab">{num(i.onHand)}</td><td className="n tab">{num(i.reserved)}</td><td className="n tab">{num(i.hold)}</td><td className="n tab" style={{ color: i.damaged ? "var(--er)" : "var(--t4)" }}>{num(i.damaged)}</td><td className="n tab" style={{ color: i.quarantined ? "var(--wa)" : "var(--t4)" }}>{num(i.quarantined)}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{num(i.available)}</td><td><BandPill b={i.band} /></td><td className="n tab">{money(i.valueAtCost)}</td></tr>)}
        </tbody></table></div></>}
      {tab === "trf" && <><div className="gw"><table className="dg"><thead><tr><th>Transfer</th><th>Item</th><th>From</th><th>To</th><th className="n">Qty</th><th>Raised</th><th>Status</th><th></th></tr></thead><tbody>{trf?.map((t) => <tr key={t.id} style={{ cursor: "default" }}><td><span className="rid">{t.id}</span></td><td className="w">{t.item.name}<div className="sm">{t.item.sku}</div></td><td>{t.fromId}</td><td>{t.toId}</td><td className="n tab">{num(t.qty)}</td><td className="sm">{fDate(t.at)} · {t.by}</td><td><Pill s={t.status} /></td><td>{t.status === "IN_TRANSIT" && can("stock.transfer") ? <ReceiveTransfer t={t} /> : <span className="sm">{t.receivedAt ? fDate(t.receivedAt) : ""}</span>}</td></tr>)}</tbody></table></div><Note k="i" style={{ marginTop: 11 }}>In-transit stock belongs to neither godown until it is received — it is deducted at source on dispatch and added at destination on receipt.</Note></>}
      {tab === "age" && <AgeTab line={line} />}
      {tab === "dead" && <DeadTab line={line} />}
      {tab === "exp" && <ExpTab line={line} />}
    </div>
  </>;
}
// Receiving a transfer at the far end. The rack is asked for here because this
// is the moment somebody is standing in front of the shelf putting it down —
// and a godown that does not run racks just presses Receive.
function ReceiveTransfer({ t }: { t: { id: string; toId: string } }) {
  const { data: godowns } = useGodowns(); const { toast } = useUI();
  const [rack, setRack] = useState(""); const [busy, setBusy] = useState(false);
  const racks = godowns?.find((g) => g.id === t.toId)?.racks ?? [];
  const go = async () => {
    setBusy(true);
    try { await post(`/api/stock/transfers/${t.id}/receive`, { rack }); toast(`Transfer ${t.id} received at ${t.toId}${rack ? ` · rack ${rack}` : ""}`, "s"); refresh("/api/"); }
    catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };
  return <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
    {racks.length > 0 && <select value={rack} onChange={(e) => setRack(e.target.value)} style={{ height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 6px" }}>
      <option value="">Rack…</option>
      {racks.map((r) => (r.subRacks?.length
        ? <optgroup key={r.id} label={r.code}>
          <option value={r.code}>{r.code} — anywhere</option>
          {r.subRacks.map((sr) => <option key={sr.id} value={locationCode(r.code, sr.code)}>{locationCode(r.code, sr.code)}</option>)}
        </optgroup>
        : <option key={r.id} value={r.code}>{r.code}</option>))}
    </select>}
    <button className="b b-o b-s" disabled={busy} onClick={go}>Receive at {t.toId}</button>
  </div>;
}

function AgeTab({ line }: { line: string }) {
  const { data } = useApi<{ labels: string[]; qty: number[]; value: number[] }>(`/api/stock/ageing?line=${line}`); if (!data) return null; const mx = Math.max(1, ...data.qty);
  return <Panel t="Stock ageing by goods-receipt batch" h="a design restocked in June is not aged from its January receipt"><div className="pnb"><div style={{ display: "flex", alignItems: "flex-end", gap: 22, height: 200, padding: "8px 4px" }}>{data.labels.map((l, i) => <div key={l} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}><div className="tab" style={{ fontSize: 13, fontWeight: 700 }}>{num(data.qty[i])}</div><div style={{ width: "56%", height: Math.max(4, (data.qty[i] / mx) * 130), background: i >= 3 ? "var(--er)" : i === 2 ? "var(--wa)" : "var(--ac)", borderRadius: "3px 3px 0 0" }} /><div style={{ fontSize: 12, color: "var(--t4)" }}>{l}</div><div className="sm">{money(data.value[i])}</div></div>)}</div></div></Panel>;
}
function DeadTab({ line }: { line: string }) {
  const router = useRouter();
  const { data } = useApi<{ days: number; capital: number; rows: { item: ItemView; sold: number; daysIdle: number; capital: number }[] }>(`/api/stock/dead?line=${line}`); const { toast } = useUI(); if (!data) return null;
  return <><Note k="w" style={{ marginBottom: 11 }}>{data.rows.length} items with no outward movement in the last {data.days} days, holding {money(data.capital)} at landed cost.</Note><div className="gw"><table className="dg"><thead><tr><th>Item</th><th>Line</th><th className="n">Available</th><th className="n">Capital held</th><th className="n">Days idle</th><th></th></tr></thead><tbody>{data.rows.length ? data.rows.slice(0, 30).map((r) => <tr key={r.item.id} onClick={() => router.push(`/items/${r.item.id}`)}><td className="w"><span className="rid">{r.item.sku}</span> {r.item.name}</td><td><LineChip id={r.item.lineId} /></td><td className="n tab">{num(r.item.available)}</td><td className="n tab" style={{ fontWeight: 600, color: "var(--t9)" }}>{money(r.capital)}</td><td className="n tab">{r.daysIdle > 900 ? "never" : r.daysIdle}</td><td><button className="b b-o b-s" onClick={(e) => { e.stopPropagation(); toast(`Liquidation offer drafted for ${r.item.sku}`, "s"); }}>Liquidate</button></td></tr>) : <tr><td colSpan={6}><Empty t="Nothing idle" d="Every item has moved recently." /></td></tr>}</tbody></table></div></>;
}
function ExpTab({ line }: { line: string }) {
  const { data } = useApi<{ id: string; sku: string; name: string; batchNo: string; godownId: string; onHand: number; expiry: string; daysLeft: number }[]>(`/api/stock/expiry?line=${line}`);
  return <><Note k="i" style={{ marginBottom: 11 }}>Consumables allocate first-expiry-first-out. Stock within 60 days of expiry is flagged and excluded from automatic allocation.</Note><div className="gw"><table className="dg"><thead><tr><th>Item</th><th>Batch</th><th>Godown</th><th className="n">On hand</th><th>Expiry</th><th className="n">Days left</th><th>Flag</th></tr></thead><tbody>{data?.length ? data.slice(0, 40).map((r) => <tr key={r.id} style={{ cursor: "default" }}><td className="w"><span className="rid">{r.sku}</span> {r.name}</td><td className="sm">{r.batchNo}</td><td>{r.godownId}</td><td className="n tab">{num(r.onHand)}</td><td className="tab">{fDate(r.expiry)}</td><td className="n tab" style={{ color: r.daysLeft < 60 ? "var(--er)" : "var(--t6)" }}>{r.daysLeft}</td><td>{r.daysLeft < 60 ? <span className="bd b-er">Liquidate</span> : <span className="bd b-ok">OK</span>}</td></tr>) : <tr><td colSpan={7}><Empty t="No batch-tracked stock in this line" d="Switch to Ink & Chemicals to see expiry tracking." /></td></tr>}</tbody></table></div></>;
}
