"use client";
import { useMemo, useState } from "react";
import { num, fDate, paise, rate as showRate } from "@vivaha/shared";
import { useApi, useLines, refresh } from "@/lib/hooks";
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

// What the multiplier is applied to. There is no single right answer — a card
// is priced off what the supplier charges, a consumable off what it actually
// cost to get here, a line being put up five percent off what it sells for
// today — so it is the office's choice, per item, and it is remembered.
type Basis = "PURCHASE" | "LANDED" | "CURRENT" | "MANUAL";
const BASIS: { k: Basis; l: string; hint: string }[] = [
  { k: "PURCHASE", l: "Last purchase", hint: "What the supplier charged, before freight" },
  { k: "LANDED", l: "Landed cost", hint: "What it actually cost to get here, freight included" },
  { k: "CURRENT", l: "Selling now", hint: "Today's published rate — for putting a list up by a percentage" },
  { k: "MANUAL", l: "Typed", hint: "A figure you enter yourself" },
];
const BASIS_LABEL: Record<Basis, string> = { PURCHASE: "Last purchase", LANDED: "Landed cost", CURRENT: "Selling now", MANUAL: "Typed" };

interface Row {
  id: string; sku: string; ref: string; name: string; status: string;
  lineId: string; lineName: string; uom: string; moq: number;
  vendor: { id: string; name: string; code: string | null } | null;
  purchasePrice: number | null; landedCost: number; multiplier: number | null;
  priceBasis: Basis; manualBase: number | null;
  slabs: { fromQty: number; toQty: number; rate: number }[]; sellingPrice: number;
  pending: { id: string; effectiveFrom: string; reason: string; by: string; purchasePrice: number | null; multiplier: number | null; sellingPrice: number | null } | null;
}
interface PriceList { baseGroup: { name: string; multiplier: number }; items: Row[] }
/** What the operator has typed into a row, before it is saved. */
type Edit = { purchasePrice: number | null; multiplier: number | null; sellingPrice: number; basis: Basis; manualBase: number | null };

const today = () => new Date().toISOString().slice(0, 10);

// What a filter chip is asking about. Kept as questions the office would
// actually ask rather than as field names.
const FILTERS: { k: string; l: string; ask: (r: Row, floor: (r: Row) => number) => boolean }[] = [
  { k: "nobase", l: "No purchase price", ask: (r) => r.purchasePrice == null },
  { k: "queued", l: "Price queued", ask: (r) => !!r.pending },
  { k: "own", l: "Own multiplier", ask: (r) => r.multiplier != null },
  { k: "thin", l: "Thin margin", ask: (r, floor) => r.sellingPrice > 0 && r.sellingPrice < floor(r) * 1.15 },
];

export default function PricesPage() {
  const { data: lines } = useLines();
  const { can } = useAuth(); const { toast } = useUI();
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState(0);
  const [tab, setTab] = useState("ALL");
  const [chips, setChips] = useState<Set<string>>(new Set());

  // The screen fetches everything and filters here, so switching tabs and chips
  // is instant and a half-typed price list is never thrown away by a refetch.
  const { data, mutate } = useApi<PriceList>(`/api/items/price-list?line=ALL&q=${encodeURIComponent(q)}`);
  const all = useMemo(() => (data?.items ?? []).filter((r) => r.status === "ACTIVE"), [data]);
  const minMargin = 0.18;
  const floorOf = (r: Row) => paise(r.landedCost * (1 + minMargin));
  const rows = useMemo(() => {
    let out = tab === "ALL" ? all : all.filter((r) => r.lineId === tab);
    for (const k of chips) { const f = FILTERS.find((x) => x.k === k); if (f) out = out.filter((r) => f.ask(r, floorOf)); }
    return out;
  }, [all, tab, chips]);
  useFooter(rows.length, tab === "ALL" ? "" : lines?.find((l) => l.id === tab)?.name ?? "");

  const live = (r: Row): Edit => edits[r.id] ?? { purchasePrice: r.purchasePrice, multiplier: r.multiplier, sellingPrice: r.sellingPrice, basis: r.priceBasis ?? "PURCHASE", manualBase: r.manualBase };
  const dirty = (r: Row) => { const e = edits[r.id]; return !!e && (e.sellingPrice !== r.sellingPrice || e.purchasePrice !== r.purchasePrice || e.multiplier !== r.multiplier || e.basis !== (r.priceBasis ?? "PURCHASE") || e.manualBase !== r.manualBase); };
  const changed = rows.filter(dirty);

  // Whatever the multiplier is being applied to on this row.
  const baseOf = (r: Row, e: Edit): number => {
    if (e.basis === "LANDED") return r.landedCost;
    if (e.basis === "CURRENT") return r.sellingPrice;
    if (e.basis === "MANUAL") return e.manualBase ?? 0;
    return e.purchasePrice ?? 0;
  };

  const setRow = (r: Row, patch: Partial<Edit>) => setEdits((m) => ({ ...m, [r.id]: { ...live(r), ...patch } }));
  // The basis, the multiplier and the price are one relation: change any and
  // the others follow. A markup gives a price; a price gives back the markup it
  // implies against whatever it is being measured from.
  const recut = (r: Row, e: Edit): Partial<Edit> => { const b = baseOf(r, e); return b && e.multiplier ? { sellingPrice: paise(b * e.multiplier) } : {}; };
  const setBasis = (r: Row, basis: Basis) => { const e = { ...live(r), basis }; setRow(r, { basis, ...recut(r, e) }); };
  const setManual = (r: Row, v: number) => { const e = { ...live(r), manualBase: v || null, basis: "MANUAL" as Basis }; setRow(r, { manualBase: v || null, basis: "MANUAL", ...recut(r, e) }); };
  const setPurchase = (r: Row, v: number) => { const e = { ...live(r), purchasePrice: v || null }; setRow(r, { purchasePrice: v || null, ...recut(r, e) }); };
  const setMult = (r: Row, v: number) => { const e = { ...live(r), multiplier: v || null }; setRow(r, { multiplier: v || null, ...recut(r, e) }); };
  const setSelling = (r: Row, v: number) => { const e = live(r); const b = baseOf(r, e); setRow(r, { sellingPrice: v, multiplier: b ? Math.round((v / b) * 1000) / 1000 : e.multiplier }); };

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allTicked = rows.length > 0 && rows.every((r) => sel.has(r.id));

  // One markup across everything ticked — the usual way a season's list is set.
  // Each row is measured from its own basis, so a mixed selection still comes
  // out right rather than all being priced off the same kind of number.
  const applyBulk = () => {
    if (!bulk) return toast("Enter the multiplier to apply", "e");
    const target = rows.filter((r) => sel.has(r.id) && baseOf(r, live(r)) > 0);
    if (!target.length) return toast("Tick some rows that have something to multiply first", "e");
    setEdits((m) => {
      const n = { ...m };
      for (const r of target) { const e = { ...live(r), multiplier: bulk }; n[r.id] = { ...e, sellingPrice: paise(baseOf(r, e) * bulk) }; }
      return n;
    });
    toast(`×${bulk} applied to ${target.length} item${target.length === 1 ? "" : "s"} — nothing is saved yet`, "s");
  };

  // And one basis across everything ticked, for when a whole line should be
  // priced the same way.
  const applyBasis = (basis: Basis) => {
    const target = rows.filter((r) => sel.has(r.id));
    if (!target.length) return toast("Tick some rows first", "e");
    setEdits((m) => {
      const n = { ...m };
      for (const r of target) { const e = { ...live(r), basis }; n[r.id] = { ...e, ...recut(r, e) }; }
      return n;
    });
    toast(`${target.length} item${target.length === 1 ? "" : "s"} now priced off ${BASIS_LABEL[basis].toLowerCase()}`, "s");
  };

  const save = async () => {
    if (!changed.length) return toast("Nothing has changed yet", "e");
    setBusy(true);
    try {
      const r = await post<{ scheduled: number; applied: number; immediate: boolean }>("/api/items/price-list", {
        effectiveFrom: new Date(from + "T00:00:00").toISOString(),
        reason: reason.trim(),
        rows: changed.map((x) => { const e = live(x); return { itemId: x.id, purchasePrice: e.purchasePrice, multiplier: e.multiplier, priceBasis: e.basis, manualBase: e.manualBase, sellingPrice: Number(e.sellingPrice) }; }),
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
<b>Price off</b> is the choice: the multiplier can be measured from what the supplier last charged, from landed cost with freight in it, from what the item sells for today — for putting a list up by a percentage — or from a figure you type. It is remembered per item, because a card and a tin of ink are not priced the same way. The <b>selling price</b> is this item&apos;s published rate; what a firm actually pays is that times its pricing group, shown at <b>{base.name} ×{base.multiplier}</b>.
      </Note>
      {queued > 0 && <Note k="i" style={{ marginBottom: 11 }}>{queued} item{queued === 1 ? " has" : "s have"} a price already queued for a later date. Until that date arrives the item keeps the rate it has now.</Note>}

      {/* Tabs and filters sit with the search box, because "find the ones I mean"
          is one action and not three. */}
      <div className="tbar" style={{ flexWrap: "wrap" }}>
        <div className="tsr"><Icon n="search" s={13} /><input placeholder="Item, design number or code…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="ptab">
          <button className={tab === "ALL" ? "on" : ""} onClick={() => setTab("ALL")}>All <b>{all.length}</b></button>
          {lines?.filter((l) => all.some((r) => r.lineId === l.id)).map((l) => <button key={l.id} className={tab === l.id ? "on" : ""} onClick={() => setTab(l.id)}>{l.name} <b>{all.filter((r) => r.lineId === l.id).length}</b></button>)}
        </span>
        <span style={{ flexBasis: "100%", height: 0 }} />
        {FILTERS.map((f) => { const on = chips.has(f.k); const n = (tab === "ALL" ? all : all.filter((r) => r.lineId === tab)).filter((r) => f.ask(r, floorOf)).length;
          return <button key={f.k} className={"b b-s " + (on ? "b-p" : "b-o")} onClick={() => setChips((c) => { const x = new Set(c); if (x.has(f.k)) x.delete(f.k); else x.add(f.k); return x; })}>{f.l} {n ? <b>{n}</b> : null}</button>; })}
        {chips.size > 0 && <button className="b b-g b-s" onClick={() => setChips(new Set())}>Clear <Icon n="x" s={11} /></button>}
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{rows.length} shown</span>
      </div>

      {can("item.edit") && <div className="tbar" style={{ flexWrap: "wrap" }}>
        <label className="sm" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input className="ck" type="checkbox" checked={allTicked} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
          Select all shown
        </label>
        <span className="sm">{sel.size} ticked</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span className="sm">Price off</span>
          {BASIS.map((b) => <button key={b.k} className="b b-o b-s" title={b.hint} disabled={!sel.size} onClick={() => applyBasis(b.k)}>{b.l}</button>)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span className="sm">and apply ×</span>
          <Num value={bulk} step="0.01" onChange={setBulk} style={{ width: 74, height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} />
          <button className="b b-o b-s" disabled={!sel.size} onClick={applyBulk}>to ticked</button>
        </span>
      </div>}

      <div className="gw"><table className="dg"><thead><tr>
        {can("item.edit") && <th style={{ width: 30 }}></th>}
        <th>Item</th><th>Line</th><th>Supplier</th>
        <th className="n">Last purchase</th><th className="n">Landed cost</th>
        <th>Price off</th><th className="n">Base</th><th className="n">× Multiplier</th><th className="n">Selling price</th>
        <th className="n">{base.name} pays</th><th>Queued</th>
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
              ? <Num value={e.purchasePrice ?? 0} step="0.01" placeholder="not known" onChange={(v) => setPurchase(r, v)} style={{ width: 92, height: 28, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} />
              : <span className="tab">{e.purchasePrice == null ? "—" : showRate(e.purchasePrice)}</span>}</td>
            <td className="n tab sm">{showRate(r.landedCost)}<div className="sm">floor {showRate(floorOf(r))}</div></td>
            {/* Which of those the markup is measured from. Remembered per item,
                because a card and a tin of ink are not priced the same way. */}
            <td>{can("item.edit")
              ? <select value={e.basis} onChange={(ev) => setBasis(r, ev.target.value as Basis)} style={{ height: 28, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 6px", fontSize: 12.5 }}>
                {BASIS.map((b) => <option key={b.k} value={b.k} title={b.hint}>{b.l}</option>)}
              </select>
              : <span className="sm">{BASIS_LABEL[e.basis]}</span>}</td>
            <td className="n">{e.basis === "MANUAL"
              ? (can("item.edit")
                ? <Num value={e.manualBase ?? 0} step="0.01" placeholder="type it" onChange={(v) => setManual(r, v)} style={{ width: 92, height: 28, border: "1px solid var(--ac)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} />
                : <span className="tab">{showRate(e.manualBase ?? 0)}</span>)
              : <span className="tab sm">{showRate(baseOf(r, e))}</span>}</td>
            <td className="n">{can("item.edit")
              ? <Num value={e.multiplier ?? 0} step="0.01" placeholder="group" onChange={(v) => setMult(r, v)} style={{ width: 76, height: 28, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} />
              : <span className="tab">{e.multiplier ?? "group"}</span>}</td>
            <td className="n">{can("item.edit")
              ? <Num value={e.sellingPrice} step="0.01" onChange={(v) => setSelling(r, v)} style={{ width: 98, height: 28, border: "1px solid " + (d ? "var(--ac)" : "var(--bd)"), borderRadius: 5, padding: "0 7px", textAlign: "right", fontWeight: 600 }} />
              : <span className="tab" style={{ fontWeight: 600 }}>{showRate(e.sellingPrice)}</span>}
              {e.sellingPrice > 0 && e.sellingPrice < floorOf(r) && <div className="sm" style={{ color: "var(--er)" }}>under the floor</div>}</td>
            <td className="n tab">{showRate(paise(e.sellingPrice * (e.multiplier ?? base.multiplier)))}
              {e.multiplier ? <div className="sm">own ×{e.multiplier}</div> : null}</td>
            <td className="sm">{r.pending
              ? <>{showRate(r.pending.sellingPrice ?? 0)} from {fDate(r.pending.effectiveFrom)}
                {can("item.edit") && <button className="b b-g b-s" style={{ marginLeft: 6 }} onClick={() => cancelPending(r)}>Call off</button>}</>
              : "—"}</td>
          </tr>;
        }) : <tr><td colSpan={can("item.edit") ? 12 : 11}><Empty t="No items" d="Nothing in this line matches that search." /></td></tr>}
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
