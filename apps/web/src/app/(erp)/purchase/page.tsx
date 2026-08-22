"use client";
import { useState } from "react";
import { money, money2, num, fDate } from "@vivaha/shared";
import { useApi, useGodowns, useLines, refresh } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { Pill, DF, Section, DrawerFrame, ModalFrame, Field, Note } from "@/components/ui";
import type { ItemView } from "@/components/types";
import { exportCsv } from "@/lib/csv";

interface PO { id: string; invNo: string; date: string; eta: string | null; freight: number; total: number; gstPct: number; status: string; vendor: { id: string; name: string; gstin: string | null; terms: string }; lines: { id: string; itemId: string; qty: number; rate: number; alloc: Record<string, number>; batchNo: string | null; item: { sku: string; name: string; uom: string; landedCost: number } }[] }
interface Vendor { id: string; name: string; gstin: string | null; terms: string; city: string; phone: string; documents: number; purchased: number; invoiced: number; paid: number; outstanding: number; oldestDays: number }

export default function PurchasePage() {
  const { line } = useAppState(); const { can } = useAuth(); const { openDrawer, openModal } = useUI();
  const [tab, setTab] = useState("grn"); const [q, setQ] = useState("");
  const { data: pos } = useApi<PO[]>(`/api/purchases?line=${line}&q=${encodeURIComponent(q)}`); const { data: vendors } = useApi<Vendor[]>("/api/masters/vendors");
  const rows = pos ?? []; const pg = usePager(rows); useFooter(tab === "grn" ? rows.length : vendors?.length ?? 0, "", pg.page, pg.pages, pg.setPage);
  return <>
    <PageHead crumb={["Supply", "Purchase & GRN"]} title="Purchase & GRN" sub={`${rows.length} documents · ${vendors?.length ?? 0} vendors · landed cost recomputed on every receipt`} tabs={[{ k: "grn", l: "Purchase invoices", n: rows.length }, { k: "vend", l: "Vendors", n: vendors?.length }, { k: "pay", l: "Vendor payables", n: vendors?.length }]} tab={tab} onTab={setTab}
      actions={<><button className="b b-o" onClick={() => exportCsv("purchase", ["PO", "Invoice", "Vendor", "Date", "Item", "Qty", "Rate", "Freight", "Status"], rows.map((p) => [p.id, p.invNo, p.vendor.name, fDate(p.date), p.lines[0]?.item.sku, p.lines[0]?.qty, p.lines[0]?.rate, p.freight, p.status]))}>⤓ Export</button>{can("purchase.create") && <button className="b b-p" onClick={() => openModal(<PurchaseModal />, "w")}>+ New purchase invoice</button>}</>} />
    <div className="wa">
      {tab === "grn" && <><div className="tbar"><div className="tsr">🔍<input placeholder="PO or invoice number…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="gw"><table className="dg"><thead><tr><th>Document</th><th>Vendor</th><th>Date</th><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Freight</th><th className="n">Value</th><th>Godown split</th><th>Status</th></tr></thead><tbody>
          {pg.rows.map((p) => { const l = p.lines[0]; return <tr key={p.id} onClick={() => openDrawer(<PODrawer p={p} />)}><td><span className="rid">{p.invNo}</span><div className="sm">{p.id}</div></td><td className="w">{p.vendor.name}<div className="sm">{p.vendor.gstin}</div></td><td className="tab">{fDate(p.date)}</td><td className="w">{l?.item.name}<div className="sm">{l?.item.sku}{p.lines.length > 1 ? ` +${p.lines.length - 1}` : ""}</div></td><td className="n tab">{num(l?.qty)}</td><td className="n tab">{money(l?.rate)}</td><td className="n tab">{money(p.freight)}</td><td className="n tab" style={{ fontWeight: 600, color: "var(--t9)" }}>{money(p.total + p.freight)}</td><td className="sm">{l && Object.keys(l.alloc).length ? Object.keys(l.alloc).map((g) => g.replace("GD-", "") + ":" + num(l.alloc[g])).join(" · ") : "—"}</td><td><Pill s={p.status} /></td></tr>; })}
        </tbody></table></div></>}
      {tab === "vend" && <div className="gw"><table className="dg"><thead><tr><th>Vendor</th><th>GSTIN</th><th>City</th><th>Terms</th><th>Phone</th><th className="n">Documents</th><th className="n">Purchased</th></tr></thead><tbody>{vendors?.map((v) => <tr key={v.id} style={{ cursor: "default" }}><td>{v.name}</td><td className="sm">{v.gstin}</td><td>{v.city}</td><td>{v.terms}</td><td className="sm">{v.phone}</td><td className="n tab">{v.documents}</td><td className="n tab">{money(v.purchased)}</td></tr>)}</tbody></table></div>}
      {tab === "pay" && <><Note style={{ marginBottom: 11 }}>Vendor payables mirror the customer ledger: an invoice posts a credit, a payment posts a debit, ageing runs from the invoice date.</Note>
        <div className="gw"><table className="dg"><thead><tr><th>Vendor</th><th>Terms</th><th className="n">Invoiced</th><th className="n">Paid</th><th className="n">Outstanding</th><th className="n">Oldest</th><th></th></tr></thead><tbody>{vendors?.map((v) => <tr key={v.id} style={{ cursor: "default" }}><td>{v.name}</td><td>{v.terms}</td><td className="n tab">{money(v.invoiced)}</td><td className="n tab" style={{ color: "var(--ok)" }}>{money(v.paid)}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{money(v.outstanding)}</td><td className="n tab" style={{ color: v.oldestDays > 60 ? "var(--er)" : "var(--t6)" }}>{v.oldestDays} d</td><td>{can("purchase.create") && <button className="b b-o b-s" onClick={() => openModal(<VendorPayModal v={v} />)}>Pay</button>}</td></tr>)}</tbody></table></div></>}
    </div>
  </>;
}

function PODrawer({ p }: { p: PO }) {
  const { closeDrawer, openModal, toast } = useUI(); const { data: godowns } = useGodowns(); const { can } = useAuth();
  const gross = p.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  return <DrawerFrame onClose={closeDrawer} head={<><span className="rid" style={{ fontSize: 13 }}>{p.invNo}</span><Pill s={p.status} /></>} actions={<>{p.status === "IN_TRANSIT" && can("purchase.create") && <button className="b b-p b-s" onClick={() => openModal(<ReceiveModal p={p} />, "w")}>Receive goods</button>}<button className="b b-o b-s" onClick={() => toast("Printed GRN", "i")}>Print GRN</button></>}>
    <Section t="Document"><DF k="Vendor" v={p.vendor.name} /><DF k="GSTIN" v={p.vendor.gstin ?? "—"} /><DF k="Terms" v={p.vendor.terms} /><DF k="PO number" v={p.id} /><DF k="Date" v={fDate(p.date)} />{p.eta && <DF k="ETA" v={fDate(p.eta)} />}</Section>
    <Section t="Lines">{p.lines.map((l) => <DF key={l.id} k={<>{l.item.name}{l.batchNo && <span className="sm"> · batch {l.batchNo}</span>}</>} v={`${num(l.qty)} × ${money(l.rate)}`} mono />)}<DF k="Freight & charges" v={money(p.freight)} mono /><DF k={`GST ${p.gstPct}%`} v={money(((gross + p.freight) * p.gstPct) / 100)} mono /><DF k="Invoice total" v={money((gross + p.freight) * (1 + p.gstPct / 100))} mono strong /><div className="sm" style={{ marginTop: 7 }}>Landed cost after freight apportionment: {p.lines.map((l) => `${l.item.sku} ${money(l.item.landedCost)}/${l.item.uom}`).join(" · ")}</div></Section>
    <Section t="Godown allocation">{p.lines.map((l) => Object.keys(l.alloc).length ? Object.keys(l.alloc).map((g) => <DF key={l.id + g} k={(godowns?.find((x) => x.id === g)?.name ?? g) + (p.lines.length > 1 ? " · " + l.item.sku : "")} v={num(l.alloc[g])} mono />) : <div className="sm" key={l.id}>Not yet received — stock lands on GRN.</div>)}</Section>
  </DrawerFrame>;
}

function AllocInputs({ godowns, alloc, setAlloc, qty }: { godowns: { id: string; short: string }[]; alloc: Record<string, number>; setAlloc: (a: Record<string, number>) => void; qty: number }) {
  const s = Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0);
  return <><div style={{ display: "flex", gap: 8 }}>{godowns.map((g) => <div key={g.id} style={{ flex: 1 }}><div className="sm" style={{ marginBottom: 3 }}>{g.short}</div><input type="number" value={alloc[g.id] ?? 0} onChange={(e) => setAlloc({ ...alloc, [g.id]: Number(e.target.value) || 0 })} style={{ width: "100%", height: 30, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px" }} /></div>)}</div><div className="sm" style={{ marginTop: 7 }}>{s === qty ? <span style={{ color: "var(--ok)", fontWeight: 700 }}>✓ {num(s)} / {num(qty)} allocated</span> : <span style={{ color: "var(--er)", fontWeight: 700 }}>✕ {num(s)} / {num(qty)} — must equal quantity</span>}</div></>;
}

function PurchaseModal() {
  const { closeModal, toast } = useUI(); const { data: godowns } = useGodowns(); const { data: lines } = useLines(); const { data: vendors } = useApi<Vendor[]>("/api/masters/vendors"); const { data: items } = useApi<{ items: ItemView[] }>("/api/items");
  const its = (items?.items ?? []).filter((i) => lines?.find((l) => l.id === i.lineId)?.workflow !== "JOBWORK");
  const [f, setF] = useState(() => ({ vendorId: "", invNo: "PINV-" + (7900 + Math.floor(Math.random() * 90)), itemId: "", qty: 1200, rate: 40, freight: 1800, batchNo: "", status: "POSTED" as "POSTED" | "IN_TRANSIT", eta: "" }));
  const [alloc, setAlloc] = useState<Record<string, number>>({ "GD-A": 500, "GD-B": 400, "GD-C": 300 });
  const it = its.find((i) => i.id === (f.itemId || its[0]?.id)); const landed = f.qty > 0 ? (f.qty * f.rate + f.freight) / f.qty : 0;
  const submit = async () => { try { await post("/api/purchases", { vendorId: f.vendorId || vendors?.[0]?.id, invNo: f.invNo, freight: Number(f.freight), status: f.status, eta: f.eta || undefined, lines: [{ itemId: it?.id, qty: Number(f.qty), rate: Number(f.rate), alloc, batchNo: f.batchNo || undefined }] }); toast(f.status === "POSTED" ? "Receipt posted · landed cost recalculated" : "PO raised — items show 'Arriving' until received", "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="New purchase invoice" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={submit}>{f.status === "POSTED" ? "Post receipt" : "Raise PO"}</button></>}>
    <div className="fg">
      <Field label="Vendor"><select value={f.vendorId || vendors?.[0]?.id || ""} onChange={(e) => setF({ ...f, vendorId: e.target.value })}>{vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      <Field label="Vendor invoice no"><input value={f.invNo} onChange={(e) => setF({ ...f, invNo: e.target.value })} /></Field>
      <Field label="Item" full><select value={it?.id ?? ""} onChange={(e) => setF({ ...f, itemId: e.target.value })}>{its.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></Field>
      <Field label="Quantity"><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
      <Field label="Rate (₹)"><input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: Number(e.target.value) })} /></Field>
      <Field label="Freight & charges (₹)"><input type="number" value={f.freight} onChange={(e) => setF({ ...f, freight: Number(e.target.value) })} /></Field>
      <Field label="Batch (consumables)"><input value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} placeholder="e.g. B2699" /></Field>
      <Field label="Status"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "POSTED" })}><option value="POSTED">Received now (GRN)</option><option value="IN_TRANSIT">In transit (PO)</option></select></Field>
      {f.status === "IN_TRANSIT" && <Field label="ETA"><input type="date" value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></Field>}
    </div>
    {f.status === "POSTED" && <div style={{ marginTop: 13 }}><div className="sm" style={{ marginBottom: 6, fontFamily: "inherit" }}>Godown allocation — must sum to the quantity</div><AllocInputs godowns={godowns ?? []} alloc={alloc} setAlloc={setAlloc} qty={f.qty} /><div className="sm" style={{ marginTop: 4 }}>goods value {money(f.qty * f.rate)} · landed cost <b>{money2(landed)}</b> per unit after freight</div></div>}
  </ModalFrame>;
}

function ReceiveModal({ p }: { p: PO }) {
  const { closeModal, closeDrawer, toast } = useUI(); const { data: godowns } = useGodowns();
  const [al, setAl] = useState<Record<string, Record<string, number>>>(Object.fromEntries(p.lines.map((l) => [l.itemId, { "GD-A": l.qty, "GD-B": 0, "GD-C": 0 }])));
  const [batch, setBatch] = useState<Record<string, string>>({});
  const go = async () => { try { await post(`/api/purchases/${p.id}/receive`, { lines: p.lines.map((l) => ({ itemId: l.itemId, alloc: al[l.itemId], batchNo: batch[l.itemId] || undefined })) }); toast("Goods received — stock landed, landed cost recomputed", "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Receive — " + p.invNo} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Post GRN</button></>}>
    {p.lines.map((l) => <div key={l.id} style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 10, marginBottom: 9 }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 7 }}>{l.item.sku} — {l.item.name} · {num(l.qty)} {l.item.uom}</div><AllocInputs godowns={godowns ?? []} alloc={al[l.itemId]} setAlloc={(a) => setAl({ ...al, [l.itemId]: a })} qty={l.qty} /><Field label="Batch (if batch-tracked)"><input value={batch[l.itemId] ?? ""} onChange={(e) => setBatch({ ...batch, [l.itemId]: e.target.value })} /></Field></div>)}
  </ModalFrame>;
}

function VendorPayModal({ v }: { v: Vendor }) {
  const { closeModal, toast } = useUI(); const [amt, setAmt] = useState(v.outstanding); const [ref, setRef] = useState(() => "NEFT-" + Math.floor(Math.random() * 90000));
  const go = async () => { try { await post("/api/purchases/vendor-payments", { vendorId: v.id, amount: Number(amt), ref }); toast("Vendor payment recorded", "s"); closeModal(); refresh("/api/masters/vendors"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Pay vendor — " + v.name} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Record payment</button></>}><div className="fg"><Field label="Amount (₹)"><input type="number" value={amt} onChange={(e) => setAmt(Number(e.target.value))} /></Field><Field label="Reference"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div></ModalFrame>;
}
