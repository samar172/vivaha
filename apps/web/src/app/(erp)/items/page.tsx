"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { money, num, slabRate } from "@vivaha/shared";
import { useApi, useLines } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { Pill, BandPill, LineChip, Thumb, Empty } from "@/components/ui";
import { ItemDrawer, ItemForm } from "@/components/ItemDrawer";
import type { ItemView } from "@/components/types";
import { exportCsv } from "@/lib/csv";
import { refresh } from "@/lib/hooks";

export default function ItemsPage() {
  const { line } = useAppState(); const { data: lines } = useLines(); const { can } = useAuth(); const { openDrawer, openModal, toast } = useUI(); const sp = useSearchParams();
  const [q, setQ] = useState(""); const [filters, setFilters] = useState<string[]>([]); const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: "sku", d: 1 }); const [sel, setSel] = useState<Set<string>>(new Set());
  const { data } = useApi<{ items: ItemView[]; minMargin: number }>(`/api/items?line=${line}&q=${encodeURIComponent(q)}&filter=${filters.join(",")}`);
  useEffect(() => { const o = sp.get("open"); if (o) openDrawer(<ItemDrawer id={o} />); }, [sp, openDrawer]);
  const rows = (data?.items ?? []).slice().sort((a, b) => { const v = (i: ItemView) => sort.k === "avail" ? i.available : sort.k === "cost" ? i.landedCost : sort.k === "rate" ? slabRate(i.slabs, i.moq) : i.sku; const x = v(a), y = v(b); return (typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y))) * sort.d; });
  const pg = usePager(rows); useFooter(rows.length, filters.length ? filters.length + " filter(s)" : "", pg.page, pg.pages, pg.setPage);
  const tg = (f: string) => setFilters((fs) => fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]);
  const sortBy = (k: string) => setSort((s) => ({ k, d: s.k === k && s.d === 1 ? -1 : 1 })); const ic = (k: string) => sort.k === k ? (sort.d === 1 ? " ↑" : " ↓") : "";
  const bulk = async (action: "discontinue" | "revise") => { const pct = action === "revise" ? Number(prompt("Revise slab rates by %", "5")) : undefined; if (action === "revise" && !pct) return; try { await post("/api/items/bulk", { ids: [...sel], action, pct }); toast(`${sel.size} items ${action === "revise" ? "revised" : "discontinued"}`, "s"); setSel(new Set()); refresh("/api/items"); } catch (e) { toast(errMsg(e), "e"); } };
  return <>
    <PageHead crumb={["Catalogue", "Items & Rates"]} title="Items & Rates" sub={`${rows.length} items · ${line === "ALL" ? "all lines" : lines?.find((l) => l.id === line)?.name} · quantity slabs and landed cost`} actions={<><button className="b b-o" onClick={() => exportCsv("items", ["SKU", "Name", "Line", "Available", "On hand", "Reserved", "Damaged", "Cost", "Slab1", "HSN", "GST"], rows.map((i) => [i.sku, i.name, i.lineId, i.available, i.onHand, i.reserved, i.damaged, i.landedCost, i.slabs[0]?.rate, i.hsn, i.gstPct]))}>⤓ Export</button>{can("item.edit") && <button className="b b-p" onClick={() => openModal(<ItemForm />, "w")}>+ New item</button>}</>} />
    <div className={"bulk" + (sel.size ? " on" : "")}>{sel.size ? <>{sel.size} selected · <button className="b b-o b-s" onClick={() => bulk("revise")}>Revise rates</button> <button className="b b-o b-s" onClick={() => bulk("discontinue")}>Discontinue</button> <button className="b b-g b-s" onClick={() => setSel(new Set())}>Clear</button></> : null}</div>
    <div className="wa">
      <div className="tbar"><div className="tsr">🔍<input placeholder="SKU, design no or name…" value={q} onChange={(e) => setQ(e.target.value)} /></div><button className="b b-o b-s" onClick={() => tg("low")}>Below full set</button><button className="b b-o b-s" onClick={() => tg("disc")}>Discontinued</button>{filters.map((f) => <span className="chip" key={f}>{f}<span className="x" onClick={() => tg(f)}>✕</span></span>)}<span style={{ marginLeft: "auto", fontSize: 11, color: "var(--t4)" }}>Margin floor {(data?.minMargin ?? .18) * 100}% over landed cost</span></div>
      <div className="gw"><table className="dg"><thead><tr><th style={{ width: 30 }}></th><th className="sortable" onClick={() => sortBy("sku")}>Item{ic("sku")}</th><th>Line</th><th>Attributes</th><th className="n sortable" onClick={() => sortBy("cost")}>Landed cost{ic("cost")}</th><th className="n">Slab 1 / 500+ / 2000+</th><th className="n sortable" onClick={() => sortBy("avail")}>Available{ic("avail")}</th><th>Stock band</th><th>HSN · GST</th><th>Status</th></tr></thead><tbody>
        {pg.rows.length ? pg.rows.map((i) => { const svc = lines?.find((l) => l.id === i.lineId)?.workflow === "JOBWORK"; return <tr key={i.id} className={sel.has(i.id) ? "sel" : ""} onClick={() => openDrawer(<ItemDrawer id={i.id} />)}>
          <td onClick={(e) => { e.stopPropagation(); setSel((s) => { const n = new Set(s); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; }); }}><input className="ck" type="checkbox" checked={sel.has(i.id)} readOnly /></td>
          <td className="w"><div style={{ display: "flex", gap: 8, alignItems: "center" }}><Thumb it={i} w={36} h={46} style={{ width: 26 }} /><div><span className="rid">{i.sku}</span> <span style={{ color: "var(--t9)" }}>{i.name}</span><div className="sm">{i.designNo ? i.designNo + " · " : ""}{i.nameHi}</div></div></div></td>
          <td><LineChip id={i.lineId} /></td><td className="w"><div className="sm" style={{ fontFamily: "inherit" }}>{Object.values(i.attrs).slice(0, 3).join(" · ")}</div></td>
          <td className="n tab">{money(i.landedCost)}</td><td className="n tab">{i.slabs.map((s) => s.rate).slice(0, 3).join(" / ")}</td>
          <td className="n tab" style={{ fontWeight: 600, color: "var(--t9)" }}>{svc ? "—" : num(i.available)}</td><td>{svc ? <span className="sm">service</span> : <BandPill b={i.band} />}</td>
          <td className="sm">{i.hsn} · {i.gstPct}%</td><td><Pill s={i.status} /></td></tr>; }) : <tr><td colSpan={10}><Empty t="No items match" d="Try clearing the search or filters." action={<button className="b b-o" onClick={() => { setQ(""); setFilters([]); }}>Clear all</button>} /></td></tr>}
      </tbody></table></div>
    </div>
  </>;
}
