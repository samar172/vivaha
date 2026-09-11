"use client";
import { useRef, useState } from "react";
import { money, num, fDT, marginFloor } from "@vivaha/shared";
import { useRouter } from "next/navigation";
import { useApi, useGodowns, useLines, refresh } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post, patch, del } from "@/lib/api";
import { Pill, BandPill, LineChip, Thumb, DF, Section, ModalFrame, Field, Note } from "./ui";
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
  if (!i) return <div className="wa"><div className="sm">Loading…</div></div>;
  const L = lines?.find((l) => l.id === i.lineId); const svc = L?.workflow === "JOBWORK";
  return <>
    <PageHead
      crumb={["Catalogue", "Items", i.sku]}
      title={i.name}
      sub={<><span className="rid">{i.designNo || i.sku}</span> · {L?.name}{i.nameHi ? <> · <span className="hi">{i.nameHi}</span></> : null}</>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/items")}><Icon n="chevronL" s={13} /> Back to items</button>
        {can("item.edit") && <button className="b b-p" onClick={() => openModal(<ItemForm item={i} />, "w")}>Edit item</button>}
        {can("stock.adjust") && !svc && <button className="b b-o" onClick={() => openModal(<AdjustModal itemId={i.id} />)}>Adjust stock</button>}
        {can("stock.transfer") && !svc && <button className="b b-o" onClick={() => openModal(<TransferModal itemId={i.id} />)}>Transfer</button>}
      </>}
    />
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
          <Section t={<>Quantity slabs · rate before customer multiplier</>}>
            <div className="sm" style={{ marginBottom: 7 }}>The highlighted row is the slab an order of the minimum quantity ({num(i.moq)} {i.uom}) falls in.</div>
            <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>From</th><th>To</th><th className="n">Rate</th><th className="n">Margin at Regular ×1.25</th></tr></thead><tbody>{i.slabs.map((s, x) => { const r = Math.round(s.rate * 1.25); const m = ((r - i.landedCost) / r) * 100; const applies = i.moq >= s.fromQty && i.moq <= s.toQty; return <tr key={x} style={{ cursor: "default", background: applies ? "var(--wa-bg)" : undefined, fontWeight: applies ? 600 : undefined }}><td className="tab">{num(s.fromQty)}</td><td className="tab">{s.toQty > 1e8 ? "∞" : num(s.toQty)}</td><td className="n tab">{money(s.rate)}</td><td className="n tab" style={{ color: m < i.minMargin * 100 ? "var(--er)" : "var(--ok)" }}>{m.toFixed(1)}%</td></tr>; })}</tbody></table>
            <div className="sm" style={{ marginTop: 7 }}>Landed cost {money(i.landedCost)} · floor {money(marginFloor(i.landedCost, i.minMargin))}</div>
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
          {!svc && <Section t="Godown split"><table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Godown</th><th className="n">On hand</th><th className="n">Res</th><th className="n">Hold</th><th className="n">Dmg</th><th className="n">Avail</th></tr></thead><tbody>{(godowns ?? []).map((g) => { const r = i.godowns.find((x) => x.godownId === g.id) ?? { onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0, available: 0 }; return <tr key={g.id} style={{ cursor: "default" }}><td>{g.short}</td><td className="n tab">{num(r.onHand)}</td><td className="n tab">{num(r.reserved)}</td><td className="n tab">{num(r.hold)}</td><td className="n tab" style={{ color: "var(--er)" }}>{num(r.damaged + r.quarantined)}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{num(r.available)}</td></tr>; })}</tbody></table></Section>}
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
const FIELD_LABEL: Record<string, string> = { slab1: "Slab 1 rate", landedCost: "Landed cost" };
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
  const { can } = useAuth(); const { toast, openModal } = useUI();
  if (!data) return null;
  const active = data.filter((c) => c.status === "ACTIVE");
  const own = active.find((c) => c.kind === "OWN");
  const factory = active.find((c) => c.kind === "MANUFACTURER");
  const replaced = data.filter((c) => c.status === "REPLACED");
  const relabel = async (replacesCodeId?: string) => {
    try { await post(`/api/codes/item/${itemId}/relabel`, { replacesCodeId }); toast("Own code issued — print the new label", "s"); mutate(); refresh("/api/"); }
    catch (e) { toast(errMsg(e), "e"); }
  };
  return <Section t="Labels & QR">
    {own
      ? <div style={{ display: "flex", gap: 13, alignItems: "flex-start", marginBottom: 11 }}>
          <div style={{ textAlign: "center" }}>
            <Qr value={own.code} size={104} />
            <div className="sm" style={{ marginTop: 5, fontFamily: "var(--mono)", fontWeight: 700, color: "var(--t9)" }}>{own.code}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="bd b-ok">Vivaha Cards label</span>
            <div className="sm" style={{ marginTop: 6, lineHeight: 1.6 }}>Issued by {own.by} · {fDT(own.createdAt)}</div>
            <button className="b b-o b-s" style={{ marginTop: 9 }} onClick={() => openModal(<PrintLabelModal code={own.code} name={name} />)}>Print label</button>
          </div>
        </div>
      : <Note k="w" style={{ marginBottom: 11 }}>
          This design is still going out under the manufacturer&apos;s label{factory ? ` (${factory.code})` : ""}. Issue your own code so the carton, the catalogue and a returned box all speak the same language.
          {can("item.edit") && <div style={{ marginTop: 9 }}><button className="b b-p b-s" onClick={() => relabel(factory?.id)}>Issue Vivaha Cards code</button></div>}
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

function PrintLabelModal({ code, name }: { code: string; name: string }) {
  const { closeModal } = useUI();
  return <ModalFrame title="Label preview" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Close</button><button className="b b-p" onClick={() => window.print()}>Print</button></>}>
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 18, textAlign: "center", background: "#fff", width: 260 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", color: "var(--ac)" }}>VIVAHA CARDS</div>
        <Qr value={code} size={168} style={{ margin: "12px auto" }} />
        <div style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: 700 }}>{code}</div>
        <div className="sm" style={{ marginTop: 4 }}>{name}</div>
      </div>
    </div>
    <Note style={{ marginTop: 13 }}>Stick this over the manufacturer&apos;s label. The old code stays on file, so a carton that still carries it will scan correctly.</Note>
  </ModalFrame>;
}

export function AdjustModal({ itemId }: { itemId?: string }) {
  const { data } = useApi<{ items: ItemView[] }>("/api/items"); const { data: godowns } = useGodowns(); const { closeModal, closeDrawer, toast } = useUI(); const { data: lines } = useLines(); const { line } = useAppState();
  const [f, setF] = useState({ itemId: itemId ?? "", godownId: "GD-A", dir: "damage", qty: 24, reason: "" });
  // Scoped to the module the operator is standing in — no cross-line picking.
  const its = (data?.items ?? []).filter((i) => lines?.find((l) => l.id === i.lineId)?.workflow !== "JOBWORK" && (line === "ALL" || i.lineId === line));
  const submit = async () => { try { await post("/api/stock/adjust", { ...f, itemId: f.itemId || its[0]?.id, qty: Number(f.qty) }); toast(`Adjustment posted — ${num(f.qty)} ${f.dir}`, "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="Stock adjustment" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-d" onClick={submit}>Post adjustment</button></>}>
    <div className="fg">
      <Field label="Item" full><select value={f.itemId || its[0]?.id || ""} onChange={(e) => setF({ ...f, itemId: e.target.value })}>{its.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></Field>
      <Field label="Godown"><select value={f.godownId} onChange={(e) => setF({ ...f, godownId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Direction"><select value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value })}><option value="damage">Available → damaged</option><option value="quarantine">Available → quarantined</option><option value="recover">Damaged → available</option><option value="writeoff">Damaged → written off</option></select></Field>
      <Field label="Quantity"><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
      <Field label="Reason (required)" full><textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Water seepage in Godown B, 8 boxes on the north wall" /></Field>
    </div>
    <Note k="w" style={{ marginTop: 11 }}>Damaged and quarantined stock is excluded from availability <b>and</b> from inventory valuation.</Note>
  </ModalFrame>;
}

export function TransferModal({ itemId }: { itemId?: string }) {
  const { data } = useApi<{ items: ItemView[] }>("/api/items"); const { data: godowns } = useGodowns(); const { closeModal, closeDrawer, toast } = useUI(); const { data: lines } = useLines(); const { line } = useAppState();
  // Scoped to the module the operator is standing in — no cross-line picking.
  const its = (data?.items ?? []).filter((i) => lines?.find((l) => l.id === i.lineId)?.workflow !== "JOBWORK" && (line === "ALL" || i.lineId === line));
  const [f, setF] = useState({ itemId: itemId ?? "", fromId: "GD-A", toId: "GD-B", qty: 200 });
  const cur = its.find((i) => i.id === (f.itemId || its[0]?.id)); const av = cur?.godowns.find((g) => g.godownId === f.fromId)?.available ?? 0;
  const submit = async () => { try { const t = await post<{ id: string }>("/api/stock/transfers", { ...f, itemId: f.itemId || its[0]?.id, qty: Number(f.qty) }); toast(`Transfer ${t.id} raised — ${num(f.qty)} in transit to ${f.toId}`, "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="Godown transfer" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={submit}>Raise transfer</button></>}>
    <div className="fg">
      <Field label="Item" full><select value={f.itemId || its[0]?.id || ""} onChange={(e) => setF({ ...f, itemId: e.target.value })}>{its.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></Field>
      <Field label="From"><select value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="To"><select value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Quantity" full hint={<>Available at {f.fromId}: <b>{num(av)}</b>{f.qty > av && <span style={{ color: "var(--er)" }}> — exceeds available</span>}</>}><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
    </div>
    <Note k="i" style={{ marginTop: 11 }}>Stock leaves the source immediately and belongs to neither godown until it is received at the destination.</Note>
  </ModalFrame>;
}

export function ItemForm({ item }: { item?: ItemView }) {
  const { data: lines } = useLines(); const { data: vendors } = useApi<{ id: string; name: string }[]>("/api/masters/vendors"); const { closeModal, closeDrawer, toast } = useUI();
  const [f, setF] = useState({ lineId: item?.lineId ?? "", name: item?.name ?? "", nameHi: item?.nameHi ?? "", designNo: item?.designNo ?? "", attrs: item?.attrs ?? {}, uom: item?.uom ?? "PCS", packUom: item?.packUom ?? "Box", perPack: item?.perPack ?? 50, moq: item?.moq ?? 250, landedCost: item?.landedCost ?? 30, hsn: item?.hsn ?? "4817", gstPct: item?.gstPct ?? 12, vendorId: item?.vendorId ?? "", batchTracked: item?.batchTracked ?? false, status: item?.status ?? "ACTIVE", base: item?.slabs[0]?.rate ?? 50 });
  const { data: attrs } = useApi<{ lineId: string | null; key: string; label: string; values: string[] }[]>("/api/masters/attributes");
  const L = lines?.find((l) => l.id === (f.lineId || lines?.[0]?.id));
  // The Hindi name writes itself from the English one while the operator has
  // not touched it. An item that already has a Hindi name counts as touched, so
  // opening an old card to fix a typo never quietly rewrites its Hindi.
  const [hiTouched, setHiTouched] = useState(!!item?.nameHi);
  const setName = (name: string) => setF((x) => ({ ...x, name, ...(hiTouched ? {} : { nameHi: toHindi(name) }) }));
  const submit = async () => {
    const slabs = [{ fromQty: 1, toQty: 499, rate: f.base }, { fromQty: 500, toQty: 1999, rate: Math.round(f.base * .89) }, { fromQty: 2000, toQty: 4999, rate: Math.round(f.base * .8) }, { fromQty: 5000, toQty: 1e9, rate: Math.round(f.base * .74) }];
    const body = { ...f, lineId: f.lineId || lines?.[0]?.id, base: undefined, vendorId: f.vendorId || null, slabs, landedCost: Number(f.landedCost), perPack: Number(f.perPack), moq: Number(f.moq), gstPct: Number(f.gstPct) };
    try { if (item) await (await import("@/lib/api")).patch(`/api/items/${item.id}`, body); else await post("/api/items", body); toast(item ? "Item updated" : "Item created", "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); }
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
      <Field label="Per pack"><input type="number" value={f.perPack} onChange={(e) => setF({ ...f, perPack: Number(e.target.value) })} /></Field>
      <Field label="MOQ"><input type="number" value={f.moq} onChange={(e) => setF({ ...f, moq: Number(e.target.value) })} /></Field>
      <Field label="Landed cost (₹)"><input type="number" value={f.landedCost} onChange={(e) => setF({ ...f, landedCost: Number(e.target.value) })} /></Field>
      <Field label="Slab 1 rate (₹) — deeper slabs at 89 / 80 / 74 %"><input type="number" value={f.base} onChange={(e) => setF({ ...f, base: Number(e.target.value) })} /></Field>
      <Field label="HSN"><input value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })} /></Field>
      <Field label="GST %"><input type="number" value={f.gstPct} onChange={(e) => setF({ ...f, gstPct: Number(e.target.value) })} /></Field>
    </div>
    <ItemPhoto item={item} />
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
