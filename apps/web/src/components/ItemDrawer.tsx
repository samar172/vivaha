"use client";
import { useRef, useState } from "react";
import { money, num, fDT, marginFloor } from "@vivaha/shared";
import { useApi, useGodowns, useLines, refresh } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post, del } from "@/lib/api";
import { Pill, BandPill, LineChip, Thumb, DF, Section, DrawerFrame, ModalFrame, Field, Note } from "./ui";
import { Qr } from "./Qr";
import { thumb } from "@/lib/art";
import type { ItemView } from "./types";

export function ItemDrawer({ id }: { id: string }) {
  const { data: i } = useApi<ItemView & { txns: { id: string; type: string; qty: number; godownId: string; batchNo: string | null; at: string; by: string; reason: string | null }[]; minMargin: number }>(`/api/items/${id}`);
  const { data: lines } = useLines(); const { data: godowns } = useGodowns(); const { can } = useAuth(); const { closeDrawer, openModal } = useUI();
  if (!i) return <div className="drb"><div className="sm">Loadingâ€¦</div></div>;
  const L = lines?.find((l) => l.id === i.lineId); const svc = L?.workflow === "JOBWORK";
  return (
    <DrawerFrame onClose={closeDrawer} head={<><span className="rid" style={{ fontSize: 14.5 }}>{i.sku}</span><LineChip id={i.lineId} /><Pill s={i.status} /></>}
      actions={<>{can("item.edit") && <button className="b b-o b-s" onClick={() => openModal(<ItemForm item={i} />, "w")}>Edit</button>}{can("stock.adjust") && !svc && <button className="b b-o b-s" onClick={() => openModal(<AdjustModal itemId={i.id} />)}>Adjust stock</button>}{can("stock.transfer") && !svc && <button className="b b-o b-s" onClick={() => openModal(<TransferModal itemId={i.id} />)}>Transfer</button>}</>}>
      <Section><div style={{ display: "flex", gap: 12 }}><Thumb it={i} w={120} h={155} style={{ width: 88 }} /><div><div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.35 }}>{i.name}</div><div className="hi" style={{ fontSize: 14, color: "var(--t6)" }}>{i.nameHi}</div><div className="sm" style={{ marginTop: 5 }}>{i.designNo || i.sku}</div><div style={{ marginTop: 7, display: "flex", gap: 4, flexWrap: "wrap" }}>{Object.values(i.attrs).map((a) => <span className="atc" key={a}>{a}</span>)}</div></div></div></Section>
      {svc ? <Section t="Stock"><div className="sm">Job work carries no stock of its own â€” base cards are drawn through a normal outward movement.</div></Section> :
        <Section t={<>Availability Â· {i.band.label}</>}>
          <DF k="On hand" v={num(i.onHand) + " " + i.uom} mono /><DF k="Reserved" v={num(i.reserved)} mono /><DF k="On hold" v={num(i.hold)} mono /><DF k="Damaged / quarantined" v={<span style={{ color: "var(--er)" }}>{num(i.damaged + i.quarantined)}</span>} mono />
          <DF k="Available" v={<span style={{ color: "var(--ac)", fontWeight: 700 }}>{num(i.available)}</span>} mono strong />
          <div className="sm" style={{ marginTop: 7 }}>MIN SET QTY for {L?.name} = {num(L?.minSetQty ?? 0)} {L?.uom} (global per line)</div>
        </Section>}
      {!svc && <Section t="Godown split"><table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Godown</th><th className="n">On hand</th><th className="n">Res</th><th className="n">Hold</th><th className="n">Dmg</th><th className="n">Avail</th></tr></thead><tbody>{(godowns ?? []).map((g) => { const r = i.godowns.find((x) => x.godownId === g.id) ?? { onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0, available: 0 }; return <tr key={g.id} style={{ cursor: "default" }}><td>{g.short}</td><td className="n tab">{num(r.onHand)}</td><td className="n tab">{num(r.reserved)}</td><td className="n tab">{num(r.hold)}</td><td className="n tab" style={{ color: "var(--er)" }}>{num(r.damaged + r.quarantined)}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{num(r.available)}</td></tr>; })}</tbody></table></Section>}
      <Section t={<>Quantity slabs · rate before customer multiplier</>}>
        <div className="sm" style={{ marginBottom: 7 }}>The highlighted row is the slab an order of the minimum quantity ({num(i.moq)} {i.uom}) falls in.</div>
        <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>From</th><th>To</th><th className="n">Rate</th><th className="n">Margin at Regular Ã—1.25</th></tr></thead><tbody>{i.slabs.map((s, x) => { const r = Math.round(s.rate * 1.25); const m = ((r - i.landedCost) / r) * 100; const applies = i.moq >= s.fromQty && i.moq <= s.toQty; return <tr key={x} style={{ cursor: "default", background: applies ? "var(--bg-sel, #FFF8E6)" : undefined, fontWeight: applies ? 600 : undefined }}><td className="tab">{num(s.fromQty)}</td><td className="tab">{s.toQty > 1e8 ? "âˆž" : num(s.toQty)}</td><td className="n tab">{money(s.rate)}</td><td className="n tab" style={{ color: m < i.minMargin * 100 ? "var(--er)" : "var(--ok)" }}>{m.toFixed(1)}%</td></tr>; })}</tbody></table><div className="sm" style={{ marginTop: 7 }}>Landed cost {money(i.landedCost)} Â· floor {money(marginFloor(i.landedCost, i.minMargin))} Â· HSN {i.hsn} Â· GST {i.gstPct}%</div></Section>
      <PriceHistorySection itemId={i.id} />
      <CodesSection itemId={i.id} name={i.name} />
      <Section t="Recent movements">{i.txns.length ? i.txns.map((t) => <div className="ti" key={t.id}><span className="dt" /><div><div><span className="wo">{t.type}</span> {num(t.qty)} {i.uom} Â· {t.godownId}{t.batchNo && t.batchNo !== "-" ? " Â· " + t.batchNo : ""}</div><div className="wn">{fDT(t.at)} Â· {t.by}{t.reason ? " Â· " + t.reason : ""}</div></div></div>) : <div className="sm">No movements yet.</div>}</Section>
    </DrawerFrame>
  );
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
    try { await post(`/api/codes/item/${itemId}/relabel`, { replacesCodeId }); toast("Own code issued â€” print the new label", "s"); mutate(); refresh("/api/"); }
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
            <div className="sm" style={{ marginTop: 6, lineHeight: 1.6 }}>Issued by {own.by} Â· {fDT(own.createdAt)}</div>
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
      <div className="sm" style={{ marginTop: 11, marginBottom: 5, fontWeight: 700, color: "var(--t6)" }}>Replaced labels â€” still scannable</div>
      {replaced.map((c) => <div key={c.id} className="ti"><span className="dt" /><div>
        <div><span className="wo" style={{ fontFamily: "var(--mono)" }}>{c.code}</span> {c.kind === "MANUFACTURER" ? "Â· factory label" : "Â· earlier own code"}</div>
        <div className="wn">Replaced {c.replacedAt ? fDT(c.replacedAt) : ""}{c.vendor ? " Â· " + c.vendor.name : ""} â€” a scan of this still resolves to this item</div>
      </div></div>)}
    </>}
    <div className="sm" style={{ marginTop: 9 }}>Scanning any of these codes â€” current or replaced â€” opens this item. Nothing is ever deleted, so a vendor claim or a recall can be traced back to the batch it came in on.</div>
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
  // Scoped to the module the operator is standing in â€” no cross-line picking.
  const its = (data?.items ?? []).filter((i) => lines?.find((l) => l.id === i.lineId)?.workflow !== "JOBWORK" && (line === "ALL" || i.lineId === line));
  const submit = async () => { try { await post("/api/stock/adjust", { ...f, itemId: f.itemId || its[0]?.id, qty: Number(f.qty) }); toast(`Adjustment posted â€” ${num(f.qty)} ${f.dir}`, "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="Stock adjustment" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-d" onClick={submit}>Post adjustment</button></>}>
    <div className="fg">
      <Field label="Item" full><select value={f.itemId || its[0]?.id || ""} onChange={(e) => setF({ ...f, itemId: e.target.value })}>{its.map((i) => <option key={i.id} value={i.id}>{i.sku} â€” {i.name}</option>)}</select></Field>
      <Field label="Godown"><select value={f.godownId} onChange={(e) => setF({ ...f, godownId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Direction"><select value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value })}><option value="damage">Available â†’ damaged</option><option value="quarantine">Available â†’ quarantined</option><option value="recover">Damaged â†’ available</option><option value="writeoff">Damaged â†’ written off</option></select></Field>
      <Field label="Quantity"><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
      <Field label="Reason (required)" full><textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Water seepage in Godown B, 8 boxes on the north wall" /></Field>
    </div>
    <Note k="w" style={{ marginTop: 11 }}>Damaged and quarantined stock is excluded from availability <b>and</b> from inventory valuation.</Note>
  </ModalFrame>;
}

export function TransferModal({ itemId }: { itemId?: string }) {
  const { data } = useApi<{ items: ItemView[] }>("/api/items"); const { data: godowns } = useGodowns(); const { closeModal, closeDrawer, toast } = useUI(); const { data: lines } = useLines(); const { line } = useAppState();
  // Scoped to the module the operator is standing in â€” no cross-line picking.
  const its = (data?.items ?? []).filter((i) => lines?.find((l) => l.id === i.lineId)?.workflow !== "JOBWORK" && (line === "ALL" || i.lineId === line));
  const [f, setF] = useState({ itemId: itemId ?? "", fromId: "GD-A", toId: "GD-B", qty: 200 });
  const cur = its.find((i) => i.id === (f.itemId || its[0]?.id)); const av = cur?.godowns.find((g) => g.godownId === f.fromId)?.available ?? 0;
  const submit = async () => { try { const t = await post<{ id: string }>("/api/stock/transfers", { ...f, itemId: f.itemId || its[0]?.id, qty: Number(f.qty) }); toast(`Transfer ${t.id} raised â€” ${num(f.qty)} in transit to ${f.toId}`, "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="Godown transfer" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={submit}>Raise transfer</button></>}>
    <div className="fg">
      <Field label="Item" full><select value={f.itemId || its[0]?.id || ""} onChange={(e) => setF({ ...f, itemId: e.target.value })}>{its.map((i) => <option key={i.id} value={i.id}>{i.sku} â€” {i.name}</option>)}</select></Field>
      <Field label="From"><select value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="To"><select value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Quantity" full hint={<>Available at {f.fromId}: <b>{num(av)}</b>{f.qty > av && <span style={{ color: "var(--er)" }}> â€” exceeds available</span>}</>}><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
    </div>
    <Note k="i" style={{ marginTop: 11 }}>Stock leaves the source immediately and belongs to neither godown until it is received at the destination.</Note>
  </ModalFrame>;
}

export function ItemForm({ item }: { item?: ItemView }) {
  const { data: lines } = useLines(); const { data: vendors } = useApi<{ id: string; name: string }[]>("/api/masters/vendors"); const { closeModal, closeDrawer, toast } = useUI();
  const [f, setF] = useState({ lineId: item?.lineId ?? "L1", name: item?.name ?? "", nameHi: item?.nameHi ?? "", designNo: item?.designNo ?? "", attrs: item?.attrs ?? {}, uom: item?.uom ?? "PCS", packUom: item?.packUom ?? "Box", perPack: item?.perPack ?? 50, moq: item?.moq ?? 250, landedCost: item?.landedCost ?? 30, hsn: item?.hsn ?? "4817", gstPct: item?.gstPct ?? 12, vendorId: item?.vendorId ?? "", batchTracked: item?.batchTracked ?? false, status: item?.status ?? "ACTIVE", base: item?.slabs[0]?.rate ?? 50 });
  const { data: attrs } = useApi<{ lineId: string | null; key: string; label: string; values: string[] }[]>("/api/masters/attributes");
  const L = lines?.find((l) => l.id === f.lineId);
  const submit = async () => {
    const slabs = [{ fromQty: 1, toQty: 499, rate: f.base }, { fromQty: 500, toQty: 1999, rate: Math.round(f.base * .89) }, { fromQty: 2000, toQty: 4999, rate: Math.round(f.base * .8) }, { fromQty: 5000, toQty: 1e9, rate: Math.round(f.base * .74) }];
    const body = { ...f, base: undefined, vendorId: f.vendorId || null, slabs, landedCost: Number(f.landedCost), perPack: Number(f.perPack), moq: Number(f.moq), gstPct: Number(f.gstPct) };
    try { if (item) await (await import("@/lib/api")).patch(`/api/items/${item.id}`, body); else await post("/api/items", body); toast(item ? "Item updated" : "Item created", "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); }
  };
  return <ModalFrame title={item ? "Edit item â€” " + item.sku : "New item"} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={submit}>Save item</button></>}>
    <div className="fg">
      <Field label="Business line"><select value={f.lineId} disabled={!!item} onChange={(e) => { const l = lines?.find((x) => x.id === e.target.value); setF({ ...f, lineId: e.target.value, uom: l?.uom ?? f.uom, gstPct: l?.gstPct ?? f.gstPct, packUom: l?.packUoms[0] ?? "", batchTracked: !!l?.batchTracked }); }}>{lines?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label="Status"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="ACTIVE">Active</option><option value="DISCONTINUED">Discontinued</option></select></Field>
      <Field label="Name *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Name (Hindi)"><input className="hi" value={f.nameHi} onChange={(e) => setF({ ...f, nameHi: e.target.value })} /></Field>
      <Field label="Design no"><input value={f.designNo} onChange={(e) => setF({ ...f, designNo: e.target.value })} /></Field>
      <Field label="Vendor"><select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}><option value="">â€”</option>{vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      {attrs?.filter((a) => a.lineId === f.lineId).map((a) => <Field key={a.key} label={a.label}><select value={(f.attrs as Record<string, string>)[a.key] ?? ""} onChange={(e) => setF({ ...f, attrs: { ...f.attrs, [a.key]: e.target.value } })}><option value="">â€”</option>{a.values.map((v) => <option key={v}>{v}</option>)}</select></Field>)}
      <Field label="UOM"><input value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} /></Field>
      <Field label="Pack unit"><select value={f.packUom} onChange={(e) => setF({ ...f, packUom: e.target.value })}><option value="">â€”</option>{L?.packUoms.map((p) => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Per pack"><input type="number" value={f.perPack} onChange={(e) => setF({ ...f, perPack: Number(e.target.value) })} /></Field>
      <Field label="MOQ"><input type="number" value={f.moq} onChange={(e) => setF({ ...f, moq: Number(e.target.value) })} /></Field>
      <Field label="Landed cost (â‚¹)"><input type="number" value={f.landedCost} onChange={(e) => setF({ ...f, landedCost: Number(e.target.value) })} /></Field>
      <Field label="Slab 1 rate (â‚¹) â€” deeper slabs at 89 / 80 / 74 %"><input type="number" value={f.base} onChange={(e) => setF({ ...f, base: Number(e.target.value) })} /></Field>
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

function ItemPhoto({ item }: { item?: ItemView }) {
  const { toast } = useUI();
  const [url, setUrl] = useState<string | null>(item?.imageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  // Uploading needs somewhere to attach the picture to.
  if (!item) return <Note style={{ marginTop: 13 }}>Save the item first, then reopen it to add a photograph. Until one is added the catalogue draws generated artwork from the design number.</Note>;

  const choose = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await downscale(file);
      const r = await post<{ imageUrl: string }>(`/api/items/${item.id}/image`, { data });
      setUrl(r.imageUrl); toast("Photograph saved", "s"); refresh("/api/");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); if (pick.current) pick.current.value = ""; }
  };
  const remove = async () => {
    setBusy(true);
    try { await del(`/api/items/${item.id}/image`); setUrl(null); toast("Photograph removed — showing generated artwork", "s"); refresh("/api/"); }
    catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <>
    <div className="st" style={{ marginTop: 16 }}>Photograph</div>
    <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
      <img src={thumb({ ...item, imageUrl: url }, 120, 156)} alt="" style={{ width: 96, border: "1px solid var(--bd)", borderRadius: 4, background: "#fff" }} />
      <div style={{ flex: 1 }}>
        <div className="sm" style={{ marginBottom: 8 }}>{url ? "This is the picture buyers see in the catalogue and the portal." : "No photograph yet — the catalogue is drawing generated artwork from the design number."}</div>
        <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => choose(e.target.files?.[0])} />
        <div style={{ display: "flex", gap: 7 }}>
          <button className="b b-o b-s" disabled={busy} onClick={() => pick.current?.click()}>{busy ? "Working…" : url ? "Replace photo" : "Add photo"}</button>
          {url && <button className="b b-g b-s" disabled={busy} onClick={remove}>Remove</button>}
        </div>
        <div className="sm" style={{ marginTop: 7 }}>JPEG, PNG or WebP. Large photographs are shrunk to {MAX_EDGE} px before they are sent.</div>
      </div>
    </div>
  </>;
}
