"use client";
import { useMemo, useState } from "react";
import { num, fDate, paise, rate as showRate } from "@vivaha/shared";
import { useApi, useLines, refresh } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post, del } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { LineChip, Empty, Note, Field, Num } from "@/components/ui";
import { Icon } from "@/components/icons";
import { exportCsv } from "@/lib/csv";

// What everything sells at, on one screen.
//
// The office does not price an item at a time; it prices a list. And it thinks
// in a chain: what the supplier charges, the markup on top, and the figure that
// comes out. So that is the row — type any of the three and the others follow.
//
// The purchase price here is the supplier's own rate before freight, which is
// the number they negotiate and remember. Landed cost is a different number and
// is deliberately not what you price off: it carries freight, it moves on its
// own with every goods receipt, and it exists to hold the margin floor.
//
// Nothing is applied until Save, and what Save does depends on the date: today
// takes effect at once, a later date waits and the item keeps its published
// rates until then — so every order in between is priced on what was published.

interface Row {
  id: string; sku: string; ref: string; name: string; status: string;
  lineId: string; lineName: string; uom: string; moq: number;
  vendor: { id: string; name: string; code: string | null } | null;
  purchasePrice: number | null; landedCost: number; multiplier: number | null;
  slabs: { fromQty: number; toQty: number; rate: number }[]; sellingPrice: number;
  pending: { id: string; effectiveFrom: string; reason: string; by: string; purchasePrice: number | null; multiplier: number | null; sellingPrice: number | null } | null;
}
interface PriceList { baseGroup: { name: string; multiplier: number }; items: Row[] }
/** What the operator has typed into a row, before it is saved. */
type Edit = { purchasePrice: number | null; multiplier: number | null; sellingPrice: number };

const today = () => new Date().toISOString().slice(0, 10);

export default function PricesPage() {
  const { line } = useAppState(); const { data: lines } = useLines();
  const { can } = useAuth(); const { toast } = useUI();
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState(0);

  const { data, mutate } = useApi<PriceList>(`/api/items/price-list?line=${line}&q=${encodeURIComponent(q)}`);
  const rows = useMemo(() => (data?.items ?? []).filter((r) => r.status === "ACTIVE"), [data]);
  useFooter(rows.length, line === "ALL" ? "" : lines?.find((l) => l.id === line)?.name ?? "");

  const live = (r: Row): Edit => edits[r.id] ?? { purchasePrice: r.purchasePrice, multiplier: r.multiplier, sellingPrice: r.sellingPrice };
  const dirty = (r: Row) => { const e = edits[r.id]; return !!e && (e.sellingPrice !== r.sellingPrice || e.purchasePrice !== r.purchasePrice || e.multiplier !== r.multiplier); };
  const changed = rows.filter(dirty);

  const setRow = (r: Row, patch: Partial<Edit>) => setEdits((m) => ({ ...m, [r.id]: { ...live(r), ...patch } }));
  // The three numbers are one relation, so typing any of them moves the others:
  // a markup gives a price, and a price gives back the markup it implies.
  const setPurchase = (r: Row, v: number) => { const e = live(r); setRow(r, { purchasePrice: v || null, sellingPrice: e.multiplier ? paise(v * e.multiplier) : e.sellingPrice }); };
  const setMult = (r: Row, v: number) => { const e = live(r); setRow(r, { multiplier: v || null, sellingPrice: e.purchasePrice && v ? paise(e.purchasePrice * v) : e.sellingPrice }); };
  const setSelling = (r: Row, v: number) => { const e = live(r); setRow(r, { sellingPrice: v, multiplier: e.purchasePrice ? Math.round((v / e.purchasePrice) * 1000) / 1000 : e.multiplier }); };

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allTicked = rows.length > 0 && rows.every((r) => sel.has(r.id));

  // One markup across everything ticked — the usual way a season's list is set.
  const applyBulk = () => {
    if (!bulk) return toast("Enter the multiplier to apply", "e");
    const target = rows.filter((r) => sel.has(r.id) && r.purchasePrice);
    if (!target.length) return toast("Tick some rows that have a purchase price first", "e");
    setEdits((m) => {
      const n = { ...m };
      for (const r of target) n[r.id] = { ...live(r), multiplier: bulk, sellingPrice: paise(r.purchasePrice! * bulk) };
      return n;
    });
    toast(`×${bulk} applied to ${target.length} item${target.length === 1 ? "" : "s"} — nothing is saved yet`, "s");
  };

  const save = async () => {
    if (!changed.length) return toast("Nothing has changed yet", "e");
    setBusy(true);
    try {
      const r = await post<{ scheduled: number; applied: number; immediate: boolean }>("/api/items/price-list", {
        effectiveFrom: new Date(from + "T00:00:00").toISOString(),
        reason: reason.trim(),
        rows: changed.map((x) => { const e = live(x); return { itemId: x.id, purchasePrice: e.purchasePrice, multiplier: e.multiplier, sellingPrice: Number(e.sellingPrice) }; }),
      });
      toast(r.immediate
        ? `${r.applied || r.scheduled} price${(r.applied || r.scheduled) === 1 ? "" : "s"} in force now`
        : `${r.scheduled} price${r.scheduled === 1 ? "" : "s"} set for ${fDate(from)} — the catalogue keeps today's rates until then`, "s");
      setEdits({}); setSel(new Set()); setReason(""); mutate(); refresh("/api/items");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  const cancelPending = async (r: Row) => {
    try { await del(`/api/items/price-changes/${r.pending!.id}`); toast(`Queued price for ${r.name} called off`, "s"); mutate(); }
    catch (e) { toast(errMsg(e), "e"); }
  };

  const base = data?.baseGroup ?? { name: "Regular", multiplier: 1.25 };
  const queued = rows.filter((r) => r.pending).length;

  return <>
    <PageHead
      crumb={["Catalogue", "Price list"]}
      title="Price list"
      sub="What everything sells at. Supplier's price, the markup on it, and the figure that comes out — type any one and the others follow."
      actions={<><button className="b b-o" onClick={() => exportCsv("price-list", ["Item", "Ref", "Line", "Supplier", "Purchase price", "Multiplier", "Selling price", "Landed cost"], rows.map((r) => [r.name, r.ref, r.lineName, r.vendor?.name ?? "", r.purchasePrice ?? "", r.multiplier ?? "", r.sellingPrice, r.landedCost]))}><Icon n="download" s={13} /> Export</button></>}
    />
    <div className="wa">
      <Note style={{ marginBottom: 11 }}>
        <b>Purchase price</b> is what the supplier charges, before freight — it is kept current from every goods receipt, and it is the number to price off. <b>Landed cost</b> is shown only because the margin floor is measured against it; it carries freight and moves on its own. The <b>selling price</b> you set here is this item&apos;s published rate; what a firm actually pays is that times its pricing group, shown in the last column at <b>{base.name} ×{base.multiplier}</b>.
      </Note>
      {queued > 0 && <Note k="i" style={{ marginBottom: 11 }}>{queued} item{queued === 1 ? " has" : "s have"} a price already queued for a later date. Until that date arrives the item keeps the rate it has now.</Note>}

      <div className="tbar">
        <div className="tsr"><Icon n="search" s={13} /><input placeholder="Item, design number or code…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {can("item.edit") && <>
          <label className="sm" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input className="ck" type="checkbox" checked={allTicked} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
            Select all
          </label>
          <span className="sm">{sel.size} ticked</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span className="sm">Apply ×</span>
            <Num value={bulk} step="0.01" onChange={setBulk} style={{ width: 74, height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} />
            <button className="b b-o b-s" disabled={!sel.size} onClick={applyBulk}>to ticked</button>
          </span>
        </>}
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{rows.length} items</span>
      </div>

      <div className="gw"><table className="dg"><thead><tr>
        {can("item.edit") && <th style={{ width: 30 }}></th>}
        <th>Item</th><th>Line</th><th>Supplier</th>
        <th className="n">Purchase price</th><th className="n">× Multiplier</th><th className="n">Selling price</th>
        <th className="n">Landed cost</th><th className="n">{base.name} pays</th><th>Queued</th>
      </tr></thead><tbody>
        {rows.length ? rows.map((r) => {
          const e = live(r);
          const d = dirty(r);
          return <tr key={r.id} style={{ cursor: "default", background: d ? "var(--ac-bg)" : undefined }}>
            {can("item.edit") && <td onClick={() => toggle(r.id)}><input className="ck" type="checkbox" checked={sel.has(r.id)} readOnly /></td>}
            <td className="w">{r.name}<div className="sm">{r.ref || r.uom} · MOQ {num(r.moq)}</div></td>
            <td><LineChip id={r.lineId} /></td>
            <td className="sm">{r.vendor ? <>{r.vendor.code ? <span className="tab">{r.vendor.code} </span> : null}{r.vendor.name}</> : "—"}</td>
            <td className="n">{can("item.edit")
              ? <Num value={e.purchasePrice ?? 0} step="0.01" placeholder="not known" onChange={(v) => setPurchase(r, v)} style={{ width: 96, height: 28, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} />
              : <span className="tab">{e.purchasePrice == null ? "—" : showRate(e.purchasePrice)}</span>}</td>
            <td className="n">{can("item.edit")
              ? <Num value={e.multiplier ?? 0} step="0.01" placeholder="group" onChange={(v) => setMult(r, v)} style={{ width: 80, height: 28, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} />
              : <span className="tab">{e.multiplier ?? "group"}</span>}</td>
            <td className="n">{can("item.edit")
              ? <Num value={e.sellingPrice} step="0.01" onChange={(v) => setSelling(r, v)} style={{ width: 100, height: 28, border: "1px solid " + (d ? "var(--ac)" : "var(--bd)"), borderRadius: 5, padding: "0 7px", textAlign: "right", fontWeight: 600 }} />
              : <span className="tab" style={{ fontWeight: 600 }}>{showRate(e.sellingPrice)}</span>}</td>
            <td className="n tab sm">{showRate(r.landedCost)}</td>
            <td className="n tab">{showRate(paise(e.sellingPrice * (e.multiplier ?? base.multiplier)))}
              {e.multiplier ? <div className="sm">own ×{e.multiplier}</div> : null}</td>
            <td className="sm">{r.pending
              ? <>{showRate(r.pending.sellingPrice ?? 0)} from {fDate(r.pending.effectiveFrom)}
                {can("item.edit") && <button className="b b-g b-s" style={{ marginLeft: 6 }} onClick={() => cancelPending(r)}>Call off</button>}</>
              : "—"}</td>
          </tr>;
        }) : <tr><td colSpan={can("item.edit") ? 10 : 9}><Empty t="No items" d="Nothing in this line matches that search." /></td></tr>}
      </tbody></table></div>

      {can("item.edit") && <div className="pn" style={{ marginTop: 12 }}><div className="pnb">
        <div className="fg">
          <Field label="In force from" hint="Today applies at once. A later date waits, and the catalogue keeps today's rates until then."><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Why (kept with the change)" full><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier revised the card list for the season" /></Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 11 }}>
          <button className="b b-p" disabled={busy || !changed.length} onClick={save}>
            {changed.length ? `Save ${changed.length} price${changed.length === 1 ? "" : "s"}` : "Nothing changed"}
          </button>
          {!!changed.length && <button className="b b-o" onClick={() => { setEdits({}); setSel(new Set()); }}>Discard changes</button>}
          <span className="sm">{changed.length
            ? <>Changed rows are highlighted. {new Date(from + "T00:00:00") <= new Date() ? "This will apply as soon as you save." : `These take effect on ${fDate(from)}.`}</>
            : "Type a purchase price, a multiplier or a selling price to begin."}</span>
        </div>
      </div></div>}
    </div>
  </>;
}
