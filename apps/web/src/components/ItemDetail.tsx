"use client";
import { useEffect, useRef, useState } from "react";
import { money, num, fDate, fDT, marginFloor, paise, rate, itemRef } from "@vivaha/shared";
import { useRouter } from "next/navigation";
import { useApi, useGodowns, useLines, refresh } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post, patch, del } from "@/lib/api";
import { Pill, BandPill, LineChip, Thumb, DF, Section, ModalFrame, Field, Note, Num, KPI, Empty } from "./ui";
import { PageHead } from "./PageHead";
import { useFooter } from "./Shell";
import { Qr } from "./Qr";
import { Icon } from "./icons";
import { toHindi } from "@/lib/hindi";
import type { ItemView } from "./types";

// The item catalogue opens a card on its own page rather than in a side drawer.
// A card has a lot to say — its pages, its stock across four godowns, its slab
// table, its labels, its price history, its movements — and a 420px drawer made
// all of it a scroll. Same sections, same components, given room.
export function ItemDetail({ id }: { id: string }) {
  const { data: i } = useApi<ItemView & { txns: { id: string; type: string; qty: number; godownId: string; batchNo: string | null; at: string; by: string; reason: string | null }[]; minMargin: number }>(`/api/items/${id}`);
  const { data: lines } = useLines(); const { data: godowns } = useGodowns(); const { can } = useAuth(); const { openModal } = useUI();
  const router = useRouter();
  // The footer's count belongs to whatever list was last shown; a detail page
  // has no record count of its own, so clear it rather than inherit one.
  useFooter(null);
  // Alt+S, the way the trade's own software does it — and a button beside the
  // title, because a shortcut nobody is told about is not a feature.
  const [ledger, setLedger] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "s" || e.key === "S")) { e.preventDefault(); setLedger(true); }
      if (e.key === "Escape") setLedger(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  if (!i) return <div className="wa"><div className="sm">Loading…</div></div>;
  // The item's own multiplier if it has one, otherwise the Regular group's,
  // which is what this table has always illustrated with.
  const mult = i.multiplier ?? 1.25;
  const L = lines?.find((l) => l.id === i.lineId); const svc = L?.workflow === "JOBWORK";
  return <>
    <PageHead
      crumb={["Catalogue", "Items", i.sku]}
      title={i.name}
      sub={<><span className="rid">{i.designNo || i.sku}</span> · {L?.name}{i.nameHi ? <> · <span className="hi">{i.nameHi}</span></> : null}</>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/items")}><Icon n="chevronL" s={13} /> Back to items</button>
        <button className="b b-o" title="Every purchase and sale of this item (Alt+S)" onClick={() => setLedger(true)}><Icon n="history" s={13} /> Movement <kbd>Alt+S</kbd></button>
        {can("item.edit") && <button className="b b-p" onClick={() => openModal(<ItemForm item={i} />, "w")}>Edit item</button>}
        {can("stock.adjust") && !svc && <button className="b b-o" onClick={() => openModal(<AdjustModal itemId={i.id} />)}>Adjust stock</button>}
        {can("stock.transfer") && !svc && <button className="b b-o" onClick={() => openModal(<TransferModal itemId={i.id} />)}>Transfer</button>}
      </>}
    />
    {ledger && <ItemLedger id={i.id} onClose={() => setLedger(false)} />}
    <div className="wa">
      <div className="idg">
      <div>
        <div className="pn"><div className="pnb">
          <div style={{ display: "flex", gap: 14 }}>
            <Thumb it={i} w={150} h={195} style={{ width: 118 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><LineChip id={i.lineId} /><Pill s={i.status} /><BandPill b={i.band} /></div>
              <div className="sm" style={{ marginTop: 8 }}>HSN {i.hsn} · GST {i.gstPct}% · MOQ {num(i.moq)} {i.uom}{i.packUom ? ` · ${i.perPack} per ${i.packUom.toLowerCase()}` : ""}</div>
              <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>{Object.values(i.attrs).map((a) => <span className="atc" key={a}>{a}</span>)}</div>
            </div>
          </div>
          <ItemPhoto item={i} />
        </div></div>
        <div className="pn"><div className="pnb">
          <Section t={<>Quantity slabs · rate before {i.multiplier ? "this item's own" : "customer"} multiplier</>}>
            <div className="sm" style={{ marginBottom: 7 }}>The highlighted row is the slab an order of the minimum quantity ({num(i.moq)} {i.uom}) falls in.</div>
            {/* Rates carry paise. ₹13.20 shown as ₹13 is not a rounding — on a
                carton of ten thousand cards it is two thousand rupees. */}
            <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>From</th><th>To</th><th className="n">Rate</th><th className="n">Sells at ×{mult}</th><th className="n">Margin</th></tr></thead><tbody>{i.slabs.map((s, x) => { const r = paise(s.rate * mult); const m = r > 0 ? ((r - i.landedCost) / r) * 100 : 0; const applies = i.moq >= s.fromQty && i.moq <= s.toQty; return <tr key={x} style={{ cursor: "default", background: applies ? "var(--wa-bg)" : undefined, fontWeight: applies ? 600 : undefined }}><td className="tab">{num(s.fromQty)}</td><td className="tab">{s.toQty > 1e8 ? "∞" : num(s.toQty)}</td><td className="n tab">{rate(s.rate)}</td><td className="n tab">{rate(r)}</td><td className="n tab" style={{ color: m < i.minMargin * 100 ? "var(--er)" : "var(--ok)" }}>{m.toFixed(1)}%</td></tr>; })}</tbody></table>
            <div className="sm" style={{ marginTop: 7 }}>Supplier&apos;s price {i.purchasePrice == null ? "—" : rate(i.purchasePrice)} · landed cost {rate(i.landedCost)} · floor {rate(marginFloor(i.landedCost, i.minMargin))}</div>
            {can("item.edit") && <button className="b b-p b-s" style={{ marginTop: 9 }} onClick={() => openModal(<PriceUpdateModal i={i} />)}>Update price</button>}
            <div className="sm" style={{ marginTop: 4 }}>{i.multiplier
              ? <>This item carries its own multiplier of <b>×{i.multiplier}</b>, so it sells at that markup whoever is buying — the firm&apos;s pricing group does not apply.</>
              : <>Shown at the <b>Regular</b> group&apos;s ×{mult}. Each firm&apos;s own group decides what it actually pays; set a multiplier on this item to fix the markup for everybody.</>}</div>
          </Section>
          <PriceHistorySection itemId={i.id} />
        </div></div>
      </div>

      <div>
        <div className="pn"><div className="pnb">
          {svc ? <Section t="Stock"><div className="sm">Job work carries no stock of its own — base cards are drawn through a normal outward movement.</div></Section> :
            <Section t={<>Availability · {i.band.label}</>}>
              <DF k="On hand" v={num(i.onHand) + " " + i.uom} mono /><DF k="Reserved" v={num(i.reserved)} mono /><DF k="On hold" v={num(i.hold)} mono /><DF k="Damaged / quarantined" v={<span style={{ color: "var(--er)" }}>{num(i.damaged + i.quarantined)}</span>} mono />
              <DF k="Available" v={<span style={{ color: "var(--ac)", fontWeight: 700 }}>{num(i.available)}</span>} mono strong />
              <div className="sm" style={{ marginTop: 7 }}>MIN SET QTY for {L?.name} = {num(L?.minSetQty ?? 0)} {L?.uom} (global per line)</div>
            </Section>}
          {!svc && <Section t="Godown split"><table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Godown</th><th className="n">On hand</th><th className="n">Res</th><th className="n">Hold</th><th className="n">Dmg</th><th className="n">Avail</th></tr></thead><tbody>{(godowns ?? []).map((g) => { const r = i.godowns.find((x) => x.godownId === g.id) ?? { onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0, available: 0, racks: [] }; return <tr key={g.id} style={{ cursor: "default" }}><td>{g.short}{/* Which shelf to walk to — the picker's half of the number beside it. */}{(r.racks ?? []).filter((x) => x.onHand > 0).length ? <div className="sm">{(r.racks ?? []).filter((x) => x.onHand > 0).map((x) => `${x.rack === "-" ? "rack not recorded" : x.rack} ${num(x.onHand)}`).join(" · ")}</div> : null}</td><td className="n tab">{num(r.onHand)}</td><td className="n tab">{num(r.reserved)}</td><td className="n tab">{num(r.hold)}</td><td className="n tab" style={{ color: "var(--er)" }}>{num(r.damaged + r.quarantined)}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{num(r.available)}</td></tr>; })}</tbody></table></Section>}
        </div></div>
        <div className="pn"><div className="pnb">
          <CodesSection itemId={i.id} name={i.name} />
        </div></div>
        <div className="pn"><div className="pnb">
          <Section t="Recent movements">{i.txns.length ? i.txns.map((t) => <div className="ti" key={t.id}><span className="dt" /><div><div><span className="wo">{t.type}</span> {num(t.qty)} {i.uom} · {t.godownId}{t.batchNo && t.batchNo !== "-" ? " · " + t.batchNo : ""}</div><div className="wn">{fDT(t.at)} · {t.by}{t.reason ? " · " + t.reason : ""}</div></div></div>) : <div className="sm">No movements yet.</div>}</Section>
        </div></div>
      </div>
      </div>
    </div>
  </>;
}

interface PriceChange { id: string; field: string; oldValue: number; newValue: number; change: number; pct: number; by: string; reason: string; at: string }

// What this item used to cost and what it costs now, straight off the record of
// actual changes. Nothing is estimated, and an item nobody has repriced simply
// says so rather than inventing a trend.
const FIELD_LABEL: Record<string, string> = { slab1: "Selling price (slab 1)", landedCost: "Landed cost", purchasePrice: "Supplier's price" };
function PriceHistorySection({ itemId }: { itemId: string }) {
  const { data } = useApi<PriceChange[]>(`/api/items/${itemId}/price-history`);
  if (!data) return null;
  if (!data.length) return <Section t="Price history"><div className="sm">No price change recorded yet. Every future change to the slab 1 rate or the landed cost is logged here with who made it and when.</div></Section>;
  const rises = data.filter((d) => d.field === "slab1" && d.change > 0).length;
  const falls = data.filter((d) => d.field === "slab1" && d.change < 0).length;
  return <Section t="Price history">
    <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Changed</th><th>What</th><th className="n">From</th><th className="n">To</th><th className="n">Change</th><th>By</th></tr></thead><tbody>
      {data.map((d) => <tr key={d.id} style={{ cursor: "default" }}>
        <td className="sm">{fDT(d.at)}</td>
        <td>{FIELD_LABEL[d.field] ?? d.field}{d.reason ? <div className="sm">{d.reason}</div> : null}</td>
        <td className="n tab">{money(d.oldValue)}</td>
        <td className="n tab" style={{ fontWeight: 600 }}>{money(d.newValue)}</td>
        <td className="n tab" style={{ color: d.change > 0 ? "var(--er)" : "var(--ok)" }}>{d.change > 0 ? "+" : ""}{money(d.change)}<div className="sm" style={{ color: "inherit" }}>{d.pct > 0 ? "+" : ""}{d.pct.toFixed(1)}%</div></td>
        <td className="sm">{d.by}</td>
      </tr>)}
    </tbody></table>
    <div className="sm" style={{ marginTop: 7 }}>{data.length} change{data.length === 1 ? "" : "s"} recorded · slab 1 raised {rises} time{rises === 1 ? "" : "s"}, reduced {falls} time{falls === 1 ? "" : "s"}.</div>
  </Section>;
}

interface Code { id: string; code: string; kind: "OWN" | "MANUFACTURER"; status: "ACTIVE" | "REPLACED"; note: string | null; by: string; createdAt: string; replacedAt: string | null; vendor: { id: string; name: string } | null }

// The label story for one item: what the factory stuck on, what the office
// prints now, and the trail between them. Old codes are kept read-only.
function CodesSection({ itemId, name }: { itemId: string; name: string }) {
  const { data, mutate } = useApi<Code[]>(`/api/codes/item/${itemId}`);
  const { can } = useAuth(); const { openModal } = useUI();
  const { data: cfg } = useApi<{ company: { name: string; mark?: string } }>("/api/settings");
  const firmName = cfg?.company.name ?? "Your own";
  if (!data) return null;
  const active = data.filter((c) => c.status === "ACTIVE");
  const own = active.find((c) => c.kind === "OWN");
  const factory = active.find((c) => c.kind === "MANUFACTURER");
  const replaced = data.filter((c) => c.status === "REPLACED");
  return <Section t="Labels & QR">
    {own
      ? <div style={{ display: "flex", gap: 13, alignItems: "flex-start", marginBottom: 11 }}>
          <div style={{ textAlign: "center" }}>
            <Qr value={own.code} size={104} />
            <div className="sm" style={{ marginTop: 5, fontFamily: "var(--mono)", fontWeight: 700, color: "var(--t9)" }}>{own.code}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="bd b-ok">{firmName} label</span>
            <div className="sm" style={{ marginTop: 6, lineHeight: 1.6 }}>Issued by {own.by} · {fDT(own.createdAt)}</div>
            <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
              <button className="b b-o b-s" onClick={() => openModal(<PrintLabelModal code={own.code} name={name} />)}>Print label</button>
              {/* The marking is the office's to choose. Changing it issues a new
                  code and keeps the old one scannable, because cartons already
                  on a shelf still carry it. */}
              {can("item.edit") && <button className="b b-o b-s" onClick={() => openModal(<IssueCodeModal itemId={itemId} replacesCodeId={own.id} current={own.code} onDone={() => { mutate(); refresh("/api/"); }} />)}>Change the code</button>}
            </div>
          </div>
        </div>
      : <Note k="w" style={{ marginBottom: 11 }}>
          This design is still going out under the manufacturer&apos;s label{factory ? ` (${factory.code})` : ""}. Issue your own code so the carton, the catalogue and a returned box all speak the same language.
          {can("item.edit") && <div style={{ marginTop: 9 }}><button className="b b-p b-s" onClick={() => openModal(<IssueCodeModal itemId={itemId} replacesCodeId={factory?.id} onDone={() => { mutate(); refresh("/api/"); }} />)}>Issue your own code</button></div>}
        </Note>}

    {factory && <DF k="Manufacturer label" v={<span style={{ fontFamily: "var(--mono)" }}>{factory.code}</span>} />}
    {factory?.vendor && <DF k="Supplied by" v={factory.vendor.name} />}

    {replaced.length > 0 && <>
      <div className="sm" style={{ marginTop: 11, marginBottom: 5, fontWeight: 700, color: "var(--t6)" }}>Replaced labels — still scannable</div>
      {replaced.map((c) => <div key={c.id} className="ti"><span className="dt" /><div>
        <div><span className="wo" style={{ fontFamily: "var(--mono)" }}>{c.code}</span> {c.kind === "MANUFACTURER" ? "· factory label" : "· earlier own code"}</div>
        <div className="wn">Replaced {c.replacedAt ? fDT(c.replacedAt) : ""}{c.vendor ? " · " + c.vendor.name : ""} — a scan of this still resolves to this item</div>
      </div></div>)}
    </>}
    <div className="sm" style={{ marginTop: 9 }}>Scanning any of these codes — current or replaced — opens this item. Nothing is ever deleted, so a vendor claim or a recall can be traced back to the batch it came in on.</div>
  </Section>;
}

// The carton label.
//
// It carries the mark, not the firm's whole name: a label is read across a
// godown at arm's length, and "VIVAHA CARDS" set small enough to fit beside a
// QR is not read at all. The mark is a setting, so a shop called Jain Card
// Gallery prints JCG.
function PrintLabelModal({ code, name }: { code: string; name: string }) {
  const { closeModal } = useUI();
  const { data: cfg } = useApi<{ company: { name: string; mark?: string } }>("/api/settings");
  const mark = (cfg?.company.mark || initials(cfg?.company.name ?? "")) || "VC";
  return <ModalFrame title="Label preview" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Close</button><button className="b b-p" onClick={() => window.print()}>Print</button></>}>
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 18, textAlign: "center", background: "#fff", width: 260 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: ".14em", color: "var(--ac)", lineHeight: 1 }}>{mark}</div>
        <Qr value={code} size={168} style={{ margin: "12px auto" }} />
        <div style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: 700 }}>{code}</div>
        <div className="sm" style={{ marginTop: 4 }}>{name}</div>
      </div>
    </div>
    <Note style={{ marginTop: 13 }}>The mark is set under Settings → Company. Stick this over the manufacturer&apos;s label — the old code stays on file, so a carton that still carries it will scan correctly.</Note>
  </ModalFrame>;
}

/** Initials of a firm's name, for when no mark has been set. */
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

// Issuing — or changing — the marking on an item.
//
// The suggested code follows the office's convention, but it is only a
// suggestion: plenty of shops have their own marking and the code that matters
// is the one actually written on the carton. Changing an existing code issues a
// new one and keeps the old scannable, because boxes already on a shelf carry it.
function IssueCodeModal({ itemId, replacesCodeId, current, onDone }: { itemId: string; replacesCodeId?: string; current?: string; onDone: () => void }) {
  const { closeModal, toast } = useUI();
  const { data: sug } = useApi<{ suggested: string; free: boolean }>(`/api/codes/item/${itemId}/suggest`);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const value = code || (current ? "" : sug?.suggested ?? "");

  const go = async () => {
    const c = (code || sug?.suggested || "").trim();
    if (c.length < 2) return toast("Enter the code to print on the carton", "e");
    setBusy(true);
    try {
      await post(`/api/codes/item/${itemId}/relabel`, { code: c, replacesCodeId });
      toast(current ? `Now marked ${c} — ${current} stays scannable` : `${c} issued — print the label`, "s");
      closeModal(); onDone();
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <ModalFrame title={current ? "Change this item's marking" : "Issue your own code"} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={busy} onClick={go}>{current ? "Issue the new code" : "Issue code"}</button></>}>
    {current && <Note k="w" style={{ marginBottom: 12 }}>
      This item is marked <b className="tab">{current}</b>. Issuing a new one does not erase it — cartons already on a shelf carry it, so it stays on file and a scan of it still opens this item.
    </Note>}
    <Field label="Code to print" full hint={sug ? (code ? "Yours, exactly as typed" : `Suggested from the design number — type over it if the office marks differently`) : "Loading the suggestion…"}>
      <input value={value} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={sug?.suggested ?? "e.g. JCG-AAKASH-1201"} style={{ fontFamily: "var(--mono)" }} />
    </Field>
    {sug && !sug.free && !code && <Note k="w" style={{ marginTop: 9 }}>{sug.suggested} is already on another item — type a different one.</Note>}
    <div className="sm" style={{ marginTop: 9 }}>Letters, numbers and dashes. It gets written on a carton and read back over the phone, so keep it short and speakable. The prefix comes from Settings → Company.</div>
  </ModalFrame>;
}

export function AdjustModal({ itemId }: { itemId?: string }) {
  const { data } = useApi<{ items: ItemView[] }>("/api/items"); const { data: godowns } = useGodowns(); const { closeModal, toast } = useUI(); const { data: lines } = useLines(); const { line } = useAppState();
  const [f, setF] = useState({ itemId: itemId ?? "", godownId: "GD-A", dir: "damage", qty: 24, reason: "" });
  // Scoped to the module the operator is standing in — no cross-line picking.
  const its = (data?.items ?? []).filter((i) => lines?.find((l) => l.id === i.lineId)?.workflow !== "JOBWORK" && (line === "ALL" || i.lineId === line));
  const submit = async () => { try { await post("/api/stock/adjust", { ...f, itemId: f.itemId || its[0]?.id, qty: Number(f.qty) }); toast(`Adjustment posted — ${num(f.qty)} ${f.dir}`, "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="Stock adjustment" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-d" onClick={submit}>Post adjustment</button></>}>
    <div className="fg">
      <Field label="Item" full><select value={f.itemId || its[0]?.id || ""} onChange={(e) => setF({ ...f, itemId: e.target.value })}>{its.map((i) => <option key={i.id} value={i.id}>{itemRef(i)} — {i.name}</option>)}</select></Field>
      <Field label="Godown"><select value={f.godownId} onChange={(e) => setF({ ...f, godownId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Direction"><select value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value })}><option value="damage">Available → damaged</option><option value="quarantine">Available → quarantined</option><option value="recover">Damaged → available</option><option value="writeoff">Damaged → written off</option></select></Field>
      <Field label="Quantity"><Num value={f.qty} onChange={(val) => setF({ ...f, qty: val })} /></Field>
      <Field label="Reason (required)" full><textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Water seepage in Godown B, 8 boxes on the north wall" /></Field>
    </div>
    <Note k="w" style={{ marginTop: 11 }}>Damaged and quarantined stock is excluded from availability <b>and</b> from inventory valuation.</Note>
  </ModalFrame>;
}

export function TransferModal({ itemId }: { itemId?: string }) {
  const { data } = useApi<{ items: ItemView[] }>("/api/items"); const { data: godowns } = useGodowns(); const { closeModal, toast } = useUI(); const { data: lines } = useLines(); const { line } = useAppState();
  // Scoped to the module the operator is standing in — no cross-line picking.
  const its = (data?.items ?? []).filter((i) => lines?.find((l) => l.id === i.lineId)?.workflow !== "JOBWORK" && (line === "ALL" || i.lineId === line));
  const [f, setF] = useState({ itemId: itemId ?? "", fromId: "GD-A", toId: "GD-B", qty: 200 });
  const cur = its.find((i) => i.id === (f.itemId || its[0]?.id)); const av = cur?.godowns.find((g) => g.godownId === f.fromId)?.available ?? 0;
  const submit = async () => { try { const t = await post<{ id: string }>("/api/stock/transfers", { ...f, itemId: f.itemId || its[0]?.id, qty: Number(f.qty) }); toast(`Transfer ${t.id} raised — ${num(f.qty)} in transit to ${f.toId}`, "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="Godown transfer" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={submit}>Raise transfer</button></>}>
    <div className="fg">
      <Field label="Item" full><select value={f.itemId || its[0]?.id || ""} onChange={(e) => setF({ ...f, itemId: e.target.value })}>{its.map((i) => <option key={i.id} value={i.id}>{itemRef(i)} — {i.name}</option>)}</select></Field>
      <Field label="From"><select value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="To"><select value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Quantity" full hint={<>Available at {f.fromId}: <b>{num(av)}</b>{f.qty > av && <span style={{ color: "var(--er)" }}> — exceeds available</span>}</>}><Num value={f.qty} onChange={(val) => setF({ ...f, qty: val })} /></Field>
    </div>
    <Note k="i" style={{ marginTop: 11 }}>Stock leaves the source immediately and belongs to neither godown until it is received at the destination.</Note>
  </ModalFrame>;
}

export function ItemForm({ item }: { item?: ItemView }) {
  const { data: lines } = useLines(); const { data: vendors } = useApi<{ id: string; name: string }[]>("/api/masters/vendors"); const { closeModal, toast } = useUI();
  const [f, setF] = useState({ lineId: item?.lineId ?? "", name: item?.name ?? "", nameHi: item?.nameHi ?? "", designNo: item?.designNo ?? "", attrs: item?.attrs ?? {}, uom: item?.uom ?? "PCS", packUom: item?.packUom ?? "Box", perPack: item?.perPack ?? 50, moq: item?.moq ?? 250, landedCost: item?.landedCost ?? 30, multiplier: item?.multiplier ?? null as number | null, hsn: item?.hsn ?? "4817", gstPct: item?.gstPct ?? 12, vendorId: item?.vendorId ?? "", batchTracked: item?.batchTracked ?? false, status: item?.status ?? "ACTIVE", base: item?.slabs[0]?.rate ?? 50 });
  const { data: attrs } = useApi<{ lineId: string | null; key: string; label: string; values: string[] }[]>("/api/masters/attributes");
  const L = lines?.find((l) => l.id === (f.lineId || lines?.[0]?.id));
  // The Hindi name writes itself from the English one while the operator has
  // not touched it. An item that already has a Hindi name counts as touched, so
  // opening an old card to fix a typo never quietly rewrites its Hindi.
  const [hiTouched, setHiTouched] = useState(!!item?.nameHi);
  // Changing a rate inside the year on an annual line is a revision of a
  // published list, so the reason is collected where the change is made.
  const [reason, setReason] = useState("");
  const annual = !!lines?.find((l) => l.id === (f.lineId || lines?.[0]?.id))?.priceListAnnual;
  const rateChanged = !!item && Number(f.base) !== Number(item.slabs?.[0]?.rate ?? 0);
  const setName = (name: string) => setF((x) => ({ ...x, name, ...(hiTouched ? {} : { nameHi: toHindi(name) }) }));
  const submit = async () => {
    // Derived to the paisa. These were rounded to the rupee, which is how a
    // base of 13.20 turned into a list of 13.20 / 12 / 11 / 10 — three of the
    // four slabs quietly moved off the percentages they are supposed to be.
    const slabs = [{ fromQty: 1, toQty: 499, rate: paise(f.base) }, { fromQty: 500, toQty: 1999, rate: paise(f.base * .89) }, { fromQty: 2000, toQty: 4999, rate: paise(f.base * .8) }, { fromQty: 5000, toQty: 1e9, rate: paise(f.base * .74) }];
    const body = { ...f, lineId: f.lineId || lines?.[0]?.id, reason: reason.trim() || undefined, base: undefined, vendorId: f.vendorId || null, slabs, landedCost: Number(f.landedCost), multiplier: f.multiplier == null || String(f.multiplier) === "" ? null : Number(f.multiplier), perPack: Number(f.perPack), moq: Number(f.moq), gstPct: Number(f.gstPct) };
    try { if (item) await (await import("@/lib/api")).patch(`/api/items/${item.id}`, body); else await post("/api/items", body); toast(item ? "Item updated" : "Item created", "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); }
  };
  return <ModalFrame title={item ? "Edit item — " + item.sku : "New item"} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={submit}>Save item</button></>}>
    <div className="fg">
      <Field label="Business line"><select value={f.lineId || lines?.[0]?.id || ""} disabled={!!item} onChange={(e) => { const l = lines?.find((x) => x.id === e.target.value); setF({ ...f, lineId: e.target.value, uom: l?.uom ?? f.uom, gstPct: l?.gstPct ?? f.gstPct, packUom: l?.packUoms[0] ?? "", batchTracked: !!l?.batchTracked }); }}>{lines?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label="Status"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="ACTIVE">Active</option><option value="DISCONTINUED">Discontinued</option></select></Field>
      <Field label="Name *"><input value={f.name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Royal Scroll Wedding Card" /></Field>
      <Field label="Name (Hindi)" hint={hiTouched
        ? <button className="b b-g b-s" style={{ padding: 0, height: "auto" }} onClick={() => { setHiTouched(false); setF((x) => ({ ...x, nameHi: toHindi(x.name) })); }}>Fill from the English name</button>
        : "Written from the English name as you type — edit it and it stays as you leave it"}>
        <input className="hi" value={f.nameHi} onChange={(e) => { setHiTouched(true); setF({ ...f, nameHi: e.target.value }); }} />
      </Field>
      <Field label="Design no"><input value={f.designNo} onChange={(e) => setF({ ...f, designNo: e.target.value })} /></Field>
      <Field label="Vendor"><select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}><option value="">—</option>{vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      {attrs?.filter((a) => a.lineId === f.lineId).map((a) => <Field key={a.key} label={a.label}><select value={(f.attrs as Record<string, string>)[a.key] ?? ""} onChange={(e) => setF({ ...f, attrs: { ...f.attrs, [a.key]: e.target.value } })}><option value="">—</option>{a.values.map((v) => <option key={v}>{v}</option>)}</select></Field>)}
      <Field label="UOM"><input value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} /></Field>
      <Field label="Pack unit"><select value={f.packUom} onChange={(e) => setF({ ...f, packUom: e.target.value })}><option value="">—</option>{L?.packUoms.map((p) => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Per pack"><Num value={f.perPack} onChange={(val) => setF({ ...f, perPack: val })} /></Field>
      <Field label="MOQ"><Num value={f.moq} onChange={(val) => setF({ ...f, moq: val })} /></Field>
      <Field label="Landed cost (₹)"><Num step="0.01" value={f.landedCost} onChange={(val) => setF({ ...f, landedCost: val })} /></Field>
      <Field label="Slab 1 rate (₹) — deeper slabs at 89 / 80 / 74 %" hint={annual ? "This line runs on a yearly published list" : "Paise are kept — 13.20 stays 13.20"}><Num step="0.01" value={f.base} onChange={(val) => setF({ ...f, base: val })} /></Field>
      <Field label="Multiplier for this item" hint="Leave blank to follow each firm's pricing group — the normal case. Set it to fix the markup whoever is buying.">
        <input type="number" step="0.01" placeholder="follows the firm's group" value={f.multiplier ?? ""} onChange={(e) => setF({ ...f, multiplier: e.target.value === "" ? null : Number(e.target.value) })} />
      </Field>
      {annual && rateChanged && <Field label="Why the list is being revised mid-year *" full hint="Recorded against the item — retailers have been quoting this list since April"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Manufacturer revised the paper rate in October" /></Field>}
      <Field label="HSN"><input value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })} /></Field>
      <Field label="GST %"><Num value={f.gstPct} onChange={(val) => setF({ ...f, gstPct: val })} /></Field>
    </div>
    <ItemPhoto item={item} />
  </ModalFrame>;
}

// Everything that ever happened to this item, the way a Tally ledger reads.
//
// The panel on the item screen shows the last dozen movements, which answers
// "what happened recently". The question actually asked at a counter is "when
// did we last buy this, from whom, at what, and who has been taking it" — so
// this is bought and sold on one page, oldest first, with a running quantity
// that reconciles because transfers, damage and job-work draws are in it too.
//
// Alt+S, because that is the key the trade's own software uses for a ledger.
interface LedgerRow {
  kind: "PURCHASE" | "SALE" | "MOVE"; at: string; ref: string; doc: string;
  party: { id: string; name: string; code: string | null } | null;
  inQty: number; outQty: number; rate: number | null; value: number | null; note: string; balance: number;
}
interface LedgerData {
  item: { id: string; sku: string; name: string; uom: string; landedCost: number; purchasePrice: number | null };
  ledger: LedgerRow[];
  summary: { bought: number; sold: number; spend: number; take: number; avgBuy: number | null; avgSell: number | null; vendors: { id: string; name: string }[]; customers: number };
}

function ItemLedger({ id, onClose }: { id: string; onClose: () => void }) {
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [kind, setKind] = useState<"ALL" | "PURCHASE" | "SALE">("ALL");
  const qs = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const { data } = useApi<LedgerData>(`/api/items/${id}/ledger?x=1${qs}`);
  const router = useRouter();

  const rows = (data?.ledger ?? []).filter((r) => kind === "ALL" || r.kind === kind);
  const s = data?.summary;

  return <div className="pwov" onClick={onClose}>
    <div className="ldgr" onClick={(e) => e.stopPropagation()}>
      <div className="drh">
        <strong style={{ fontSize: 14.5 }}>{data ? `${data.item.name} — movement` : "Movement"}</strong>
        <span className="sm" style={{ marginLeft: 8 }}>every purchase and sale</span>
        <button className="b b-g b-s" style={{ marginLeft: "auto" }} onClick={onClose}><Icon n="x" s={13} /></button>
      </div>
      <div className="tbar">
        <span className="ptab">
          {(["ALL", "PURCHASE", "SALE"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k === "ALL" ? "Everything" : k === "PURCHASE" ? "Bought" : "Sold"}</button>)}
        </span>
        <span className="sm">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px" }} />
        <span className="sm">to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px" }} />
        {(from || to) && <button className="b b-o b-s" onClick={() => { setFrom(""); setTo(""); }}>Clear</button>}
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{rows.length} entries</span>
      </div>
      {!data ? <div className="sm" style={{ padding: 14 }}>Loading…</div> : <>
        <div className="kpis c4" style={{ margin: "0 0 11px" }}>
          <KPI l="Bought" v={`${num(s!.bought)} ${data.item.uom.toLowerCase()}`} d={s!.avgBuy ? `avg ${rate(s!.avgBuy)}` : "never bought"} />
          <KPI l="Sold" v={`${num(s!.sold)} ${data.item.uom.toLowerCase()}`} d={s!.avgSell ? `avg ${rate(s!.avgSell)}` : "never sold"} />
          <KPI l="Spent" v={money(s!.spend)} d={s!.vendors.length ? s!.vendors.map((v) => v.name).join(", ") : "—"} />
          <KPI l="Taken" v={money(s!.take)} d={`${s!.customers} firm${s!.customers === 1 ? "" : "s"}`} />
        </div>
        <div className="gw" style={{ maxHeight: "48vh", overflow: "auto" }}><table className="dg"><thead><tr>
          <th>Date</th><th>Particulars</th><th>Party</th><th className="n">In</th><th className="n">Out</th><th className="n">Rate</th><th className="n">Value</th><th className="n">Balance</th>
        </tr></thead><tbody>
          {rows.length ? rows.map((r, n) => <tr key={r.kind + r.ref + n} style={{ cursor: r.party ? "pointer" : "default" }}
            onClick={() => { if (r.kind === "PURCHASE") router.push(`/purchase/${r.doc}`); else if (r.kind === "SALE" && r.party) router.push(`/customers/${r.party.id}`); }}>
            <td className="tab sm">{fDate(r.at)}</td>
            <td className="w">{r.kind === "PURCHASE" ? "Purchase" : r.kind === "SALE" ? "Sale" : "Movement"} <span className="rid">{r.ref}</span>{r.note ? <div className="sm">{r.note}</div> : null}</td>
            <td className="sm">{r.party ? <>{r.party.code ? <span className="tab">{r.party.code} </span> : null}{r.party.name}</> : "—"}</td>
            <td className="n tab" style={{ color: r.inQty ? "var(--ok)" : "var(--t4)" }}>{r.inQty ? num(r.inQty) : ""}</td>
            <td className="n tab" style={{ color: r.outQty ? "var(--er)" : "var(--t4)" }}>{r.outQty ? num(r.outQty) : ""}</td>
            <td className="n tab">{r.rate == null ? "" : rate(r.rate)}</td>
            <td className="n tab">{r.value == null ? "" : money(r.value)}</td>
            <td className="n tab" style={{ fontWeight: 600 }}>{num(r.balance)}</td>
          </tr>) : <tr><td colSpan={8}><Empty t="Nothing in this period" d="Widen the dates, or this item has not moved." /></td></tr>}
        </tbody></table></div>
        <div className="sm" style={{ marginTop: 9 }}>Oldest first, so the balance column reads down. Transfers, damage and job-work draws are included, which is why it reconciles with the godown rather than with sales alone. A row opens the document behind it.</div>
      </>}
    </div>
  </div>;
}

// Changing one item's price, from the item.
//
// The same road the price list takes — the same endpoint, the same margin
// floor, the same effective date — because a price set here and a price set
// there must not be able to behave differently. The difference is only that
// this is one item, in front of somebody who came to look at it.
function PriceUpdateModal({ i }: { i: ItemView & { minMargin: number } }) {
  const { closeModal, toast } = useUI();
  const [f, setF] = useState(() => ({
    purchasePrice: i.purchasePrice ?? 0,
    multiplier: i.multiplier ?? 0,
    sellingPrice: i.slabs[0]?.rate ?? 0,
    from: new Date().toISOString().slice(0, 10),
    reason: "",
  }));
  const [busy, setBusy] = useState(false);
  const floor = marginFloor(i.landedCost, i.minMargin);
  const was = i.slabs[0]?.rate ?? 0;

  // Typing a markup gives a price; typing a price gives back the markup.
  const setMult = (v: number) => setF((x) => ({ ...x, multiplier: v, sellingPrice: x.purchasePrice && v ? paise(x.purchasePrice * v) : x.sellingPrice }));
  const setSelling = (v: number) => setF((x) => ({ ...x, sellingPrice: v, multiplier: x.purchasePrice ? Math.round((v / x.purchasePrice) * 1000) / 1000 : x.multiplier }));
  const setPurchase = (v: number) => setF((x) => ({ ...x, purchasePrice: v, sellingPrice: x.multiplier ? paise(v * x.multiplier) : x.sellingPrice }));

  const go = async () => {
    if (!f.sellingPrice) return toast("Enter the price it should sell at", "e");
    setBusy(true);
    try {
      const r = await post<{ immediate: boolean; scheduled: number }>("/api/items/price-list", {
        effectiveFrom: new Date(f.from + "T00:00:00").toISOString(),
        reason: f.reason.trim(),
        rows: [{ itemId: i.id, purchasePrice: f.purchasePrice || null, multiplier: f.multiplier || null, sellingPrice: Number(f.sellingPrice) }],
      });
      toast(r.immediate ? `${i.name} now sells at ${rate(f.sellingPrice)}` : `${rate(f.sellingPrice)} set for ${fDate(f.from)} — today's rate stands until then`, "s");
      closeModal(); refresh("/api/");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <ModalFrame title={`Update price — ${i.name}`} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={busy} onClick={go}>Save price</button></>}>
    <div className="fg">
      <Field label="Supplier&apos;s price (₹)" hint="Before freight — kept current from every goods receipt"><Num value={f.purchasePrice} step="0.01" onChange={setPurchase} /></Field>
      <Field label="× Multiplier" hint="Blank follows the firm&apos;s pricing group"><Num value={f.multiplier} step="0.01" placeholder="group" onChange={setMult} /></Field>
      <Field label="Sells at (₹)" hint={`Was ${rate(was)}`}><Num value={f.sellingPrice} step="0.01" onChange={setSelling} /></Field>
      <Field label="In force from" hint="Today applies at once; a later date waits"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
      <Field label="Why (kept in the price history)" full><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Supplier revised the list for the season" /></Field>
    </div>
    {f.sellingPrice > 0 && f.sellingPrice < floor && <Note k="w" style={{ marginTop: 11 }}>
      {rate(f.sellingPrice)} is below this item&apos;s margin floor of {rate(floor)} — landed cost {rate(i.landedCost)} plus {Math.round(i.minMargin * 100)}%. Saving it needs <b>margin.override</b>.
    </Note>}
    <Note style={{ marginTop: 11 }}>The deeper slabs follow at 89 / 80 / 74% of this, the way the catalogue has always been built. Every change is written to this item&apos;s price history with your name against it.</Note>
  </ModalFrame>;
}

// A phone camera produces four thousand pixels across and several megabytes of
// it; the catalogue shows the picture a few hundred pixels wide. Redrawing it
// through a canvas before it leaves the browser is the difference between an
// upload that works on a godown 4G connection and one that times out.
const MAX_EDGE = 1400;
function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read that file"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image we can read"));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("Could not process that image"));
        // Cards are photographed against paper; a white ground keeps a
        // transparent PNG from turning black once it is flattened to JPEG.
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

interface ItemImg { id: string; url: string; label: string }

// Common page names, offered rather than imposed — a trifold has three panels,
// a pocket card has an insert, and the operator knows which is which.
const PAGE_LABELS = ["Front", "Inside", "Inside left", "Inside right", "Back", "Pocket", "Insert", "Envelope"];

// A wedding card is not one picture: it opens. Each page is a row, in the order
// the card opens, and the first is the cover every existing screen already
// reads through Item.imageUrl.
function ItemPhoto({ item }: { item?: ItemView }) {
  const { toast } = useUI();
  const { data: imgs, mutate } = useApi<ItemImg[]>(item ? `/api/items/${item.id}/images` : null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Front");
  const [preview, setPreview] = useState<ItemImg | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  // Uploading needs somewhere to attach the pages to.
  if (!item) return <Note style={{ marginTop: 13 }}>Save the item first, then reopen it to add photographs. Until then the catalogue draws generated artwork from the design number.</Note>;
  const list = imgs ?? [];

  const choose = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await downscale(file);
      await post(`/api/items/${item.id}/image`, { data, label });
      mutate(); refresh("/api/"); toast(`${label || "Photograph"} saved`, "s");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); if (pick.current) pick.current.value = ""; }
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); mutate(); refresh("/api/"); toast(msg, "s"); }
    catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <>
    <div className="st" style={{ marginTop: 16 }}>Photographs</div>
    <div className="sm" style={{ marginBottom: 9 }}>
      {list.length
        ? "A card opens, so it gets a page each — front, inside, back. The first is the cover buyers see in the catalogue and the portal."
        : "No photographs yet — the catalogue is drawing generated artwork from the design number. Add a page for each side of the card."}
    </div>

    {list.length > 0 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 11 }}>
      {list.map((im, i) => <div key={im.id} style={{ width: 104 }}>
        <button style={{ display: "block", width: "100%", padding: 0, border: i === 0 ? "2px solid var(--ac)" : "1px solid var(--bd)", borderRadius: 4, overflow: "hidden", background: "#fff", cursor: "zoom-in" }} onClick={() => setPreview(im)} title="Click to preview">
          <img src={im.url} alt={im.label} style={{ width: "100%", display: "block", aspectRatio: "3/4", objectFit: "cover" }} />
        </button>
        <div className="sm" style={{ marginTop: 4, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? "var(--ac)" : undefined }}>{i === 0 ? "Cover" : `Page ${i + 1}`}{im.label ? ` · ${im.label}` : ""}</div>
        <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
          {i !== 0 && <button className="b b-g b-s" disabled={busy} title="Make this the cover" onClick={() => act(() => patch(`/api/items/${item.id}/images/${im.id}`, { makeCover: true }), "Cover changed")}>Cover</button>}
          <button className="b b-g b-s" disabled={busy} title="Remove this page" onClick={() => act(() => del(`/api/items/${item.id}/images/${im.id}`), "Photograph removed")}><Icon n="x" s={11} /></button>
        </div>
      </div>)}
    </div>}

    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
      <Field label="This page is the"><select value={label} onChange={(e) => setLabel(e.target.value)}>{PAGE_LABELS.map((l) => <option key={l}>{l}</option>)}</select></Field>
      <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => choose(e.target.files?.[0])} />
      <button className="b b-o" style={{ marginBottom: 2 }} disabled={busy} onClick={() => pick.current?.click()}>{busy ? "Working…" : "+ Add photograph"}</button>
    </div>
    <div className="sm" style={{ marginTop: 7 }}>JPEG, PNG or WebP. Large photographs are shrunk to {MAX_EDGE} px before they are sent.</div>

    {preview && <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,16,28,.72)", display: "grid", placeItems: "center", padding: 24, cursor: "zoom-out" }}>
      <div style={{ textAlign: "center" }}>
        <img src={preview.url} alt={preview.label} style={{ maxWidth: "min(92vw, 620px)", maxHeight: "80vh", borderRadius: 6, background: "#fff" }} />
        <div style={{ color: "#fff", fontSize: 13, marginTop: 9 }}>{preview.label || "Photograph"} — click anywhere to close</div>
      </div>
    </div>}
  </>;
}
