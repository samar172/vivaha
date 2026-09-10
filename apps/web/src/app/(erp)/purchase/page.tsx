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
import { Qr } from "@/components/Qr";
import type { ItemView } from "@/components/types";
import { exportCsv } from "@/lib/csv";
import { Icon } from "@/components/icons";

interface PO { id: string; invNo: string; date: string; eta: string | null; freight: number; total: number; gstPct: number; status: string; vendor: { id: string; name: string; gstin: string | null; terms: string }; lines: { id: string; itemId: string; qty: number; rate: number; alloc: Record<string, number>; batchNo: string | null; mfrCode: string | null; item: { sku: string; name: string; uom: string; landedCost: number; lineId: string } }[] }
interface Vendor { id: string; name: string; gstin: string | null; terms: string; city: string; phone: string; documents: number; purchased: number; invoiced: number; paid: number; outstanding: number; oldestDays: number }

export default function PurchasePage() {
  const { line } = useAppState(); const { can } = useAuth(); const { openDrawer, openModal } = useUI();
  const [tab, setTab] = useState("grn"); const [q, setQ] = useState("");
  const { data: pos } = useApi<PO[]>(`/api/purchases?line=${line}&q=${encodeURIComponent(q)}`); const { data: vendors } = useApi<Vendor[]>("/api/masters/vendors");
  const rows = pos ?? []; const pg = usePager(rows); useFooter(tab === "grn" ? rows.length : vendors?.length ?? 0, "", pg.page, pg.pages, pg.setPage);
  return <>
    <PageHead crumb={["Supply", "Purchase & GRN"]} title="Purchase & GRN" sub={`${rows.length} documents · ${vendors?.length ?? 0} vendors · landed cost recomputed on every receipt`} tabs={[{ k: "grn", l: "Purchase invoices", n: rows.length }, { k: "vend", l: "Vendors", n: vendors?.length }, { k: "pay", l: "Vendor payables", n: vendors?.length }]} tab={tab} onTab={setTab}
      actions={<><button className="b b-o" onClick={() => exportCsv("purchase", ["PO", "Invoice", "Vendor", "Date", "Item", "Qty", "Rate", "Freight", "Status"], rows.map((p) => [p.id, p.invNo, p.vendor.name, fDate(p.date), p.lines[0]?.item.sku, p.lines[0]?.qty, p.lines[0]?.rate, p.freight, p.status]))}><Icon n="download" s={13} /> Export</button>{can("purchase.create") && <button className="b b-p" onClick={() => openModal(<PurchaseModal />, "w")}>+ New purchase invoice</button>}</>} />
    <div className="wa">
      {tab === "grn" && <><div className="tbar"><div className="tsr"><Icon n="search" s={13} /><input placeholder="PO or invoice number…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
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
  return <DrawerFrame onClose={closeDrawer} head={<><span className="rid" style={{ fontSize: 14.5 }}>{p.invNo}</span><Pill s={p.status} /></>} actions={<>{p.status === "IN_TRANSIT" && can("purchase.create") && <button className="b b-p b-s" onClick={() => openModal(<ReceiveModal p={p} />, "w")}>Receive goods</button>}<button className="b b-o b-s" onClick={() => toast("Printed GRN", "i")}>Print GRN</button></>}>
    <Section t="Document"><DF k="Vendor" v={p.vendor.name} /><DF k="GSTIN" v={p.vendor.gstin ?? "—"} /><DF k="Terms" v={p.vendor.terms} /><DF k="PO number" v={p.id} /><DF k="Date" v={fDate(p.date)} />{p.eta && <DF k="ETA" v={fDate(p.eta)} />}</Section>
    <Section t="Lines">{p.lines.map((l) => <DF key={l.id} k={<>{l.item.name}{l.batchNo && <span className="sm"> · batch {l.batchNo}</span>}</>} v={`${num(l.qty)} × ${money(l.rate)}`} mono />)}<DF k="Freight & charges" v={money(p.freight)} mono /><DF k={`GST ${p.gstPct}%`} v={money(((gross + p.freight) * p.gstPct) / 100)} mono /><DF k="Invoice total" v={money((gross + p.freight) * (1 + p.gstPct / 100))} mono strong /><div className="sm" style={{ marginTop: 7 }}>Landed cost after freight apportionment: {p.lines.map((l) => `${l.item.sku} ${money(l.item.landedCost)}/${l.item.uom}`).join(" · ")}</div></Section>
    <Section t="Labels received">{p.lines.some((l) => l.mfrCode)
      ? p.lines.filter((l) => l.mfrCode).map((l) => <div key={l.id} style={{ display: "flex", gap: 11, alignItems: "center", marginBottom: 9 }}><Qr value={l.mfrCode!} size={62} /><div><div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 700 }}>{l.mfrCode}</div><div className="sm">{l.item.sku} · manufacturer label, filed on receipt</div></div></div>)
      : <div className="sm">No manufacturer label was recorded on this document.</div>}</Section>
    <Section t="Godown allocation">{p.lines.map((l) => Object.keys(l.alloc).length ? Object.keys(l.alloc).map((g) => <DF key={l.id + g} k={(godowns?.find((x) => x.id === g)?.name ?? g) + (p.lines.length > 1 ? " · " + l.item.sku : "")} v={num(l.alloc[g])} mono />) : <div className="sm" key={l.id}>Not yet received — stock lands on GRN.</div>)}</Section>
  </DrawerFrame>;
}

function AllocInputs({ godowns, alloc, setAlloc, qty }: { godowns: { id: string; short: string }[]; alloc: Record<string, number>; setAlloc: (a: Record<string, number>) => void; qty: number }) {
  const s = Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0);
  return <><div style={{ display: "flex", gap: 8 }}>{godowns.map((g) => <div key={g.id} style={{ flex: 1 }}><div className="sm" style={{ marginBottom: 3 }}>{g.short}</div><input type="number" value={alloc[g.id] ?? 0} onChange={(e) => setAlloc({ ...alloc, [g.id]: Number(e.target.value) || 0 })} style={{ width: "100%", height: 30, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px" }} /></div>)}</div><div className="sm" style={{ marginTop: 7 }}>{s === qty ? <span style={{ color: "var(--ok)", fontWeight: 700 }}><Icon n="check" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {num(s)} / {num(qty)} allocated</span> : <span style={{ color: "var(--er)", fontWeight: 700 }}><Icon n="x" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {num(s)} / {num(qty)} — must equal quantity</span>}</div></>;
}

function PurchaseModal() {
  const { closeModal, toast } = useUI(); const { data: godowns } = useGodowns(); const { data: lines } = useLines(); const { data: vendors } = useApi<Vendor[]>("/api/masters/vendors");
  const { line: globalLine } = useAppState();
  // A purchase belongs to one module. The item list is scoped to that line and
  // never shows anything from another — cards here, ink there, no crossover.
  const stockLines = (lines ?? []).filter((l) => l.workflow !== "JOBWORK");
  const [pickedLine, setPickedLine] = useState("");
  const lineId = pickedLine || (globalLine !== "ALL" ? globalLine : "") || stockLines[0]?.id || "";
  const L = stockLines.find((l) => l.id === lineId);
  const { data: items, mutate: mutItems } = useApi<{ items: ItemView[] }>(lineId ? `/api/items?line=${lineId}` : null);
  const its = items?.items ?? [];
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(() => ({ vendorId: "", invNo: "PINV-" + (7900 + Math.floor(Math.random() * 90)), itemId: "", qty: 1200, rate: 40, freight: 1800, batchNo: "", mfrCode: "", status: "POSTED" as "POSTED" | "IN_TRANSIT", eta: "" }));
  const [alloc, setAlloc] = useState<Record<string, number>>({ "GD-A": 500, "GD-B": 400, "GD-C": 300 });
  const it = its.find((i) => i.id === f.itemId) ?? its[0];
  const landed = f.qty > 0 ? (f.qty * f.rate + f.freight) / f.qty : 0;
  const switchLine = (id: string) => { setPickedLine(id); setF((s) => ({ ...s, itemId: "", batchNo: "", mfrCode: "" })); setAdding(false); };
  const submit = async () => {
    if (!it) return toast(`No item in ${L?.name ?? "this line"} yet — add one first`, "e");
    try {
      await post("/api/purchases", { vendorId: f.vendorId || vendors?.[0]?.id, invNo: f.invNo, freight: Number(f.freight), status: f.status, eta: f.eta || undefined, lines: [{ itemId: it.id, qty: Number(f.qty), rate: Number(f.rate), alloc, batchNo: f.batchNo || undefined, mfrCode: f.mfrCode || undefined }] });
      toast(f.status === "POSTED" ? `Receipt posted · landed cost recalculated${f.mfrCode ? " · label recorded" : ""}` : "PO raised — items show 'Arriving' until received", "s");
      closeModal(); refresh("/api/");
    } catch (e) { toast(errMsg(e), "e"); }
  };
  return <ModalFrame title={`New purchase invoice — ${L?.name ?? "…"}`} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={adding} onClick={submit}>{f.status === "POSTED" ? "Post receipt" : "Raise PO"}</button></>}>
    <div className="fg">
      <Field label="Business line — the document stays inside it" full>
        <select value={lineId} onChange={(e) => switchLine(e.target.value)}>{stockLines.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.uom} · GST {l.gstPct}%</option>)}</select>
      </Field>
      <Field label="Vendor"><select value={f.vendorId || vendors?.[0]?.id || ""} onChange={(e) => setF({ ...f, vendorId: e.target.value })}>{vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      <Field label="Vendor invoice no"><input value={f.invNo} onChange={(e) => setF({ ...f, invNo: e.target.value })} /></Field>
      <Field label={`Item — ${L?.name ?? ""} only (${its.length})`} full>
        <div style={{ display: "flex", gap: 7 }}>
          <select style={{ flex: 1 }} value={it?.id ?? ""} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
            {its.length ? its.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>) : <option value="">No {L?.name} items yet</option>}
          </select>
          <button className="b b-o" type="button" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ New item"}</button>
        </div>
      </Field>
    </div>

    {adding && L && <NewItemInline line={L} vendorId={f.vendorId || vendors?.[0]?.id || ""} onDone={async (created) => { await mutItems(); setF((s) => ({ ...s, itemId: created.id, rate: created.landedCost || s.rate })); setAdding(false); toast(`${created.sku} created in ${L.name}`, "s"); refresh("/api/items"); }} />}

    {!adding && <>
      <div className="fg" style={{ marginTop: 11 }}>
        <Field label="Quantity"><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
        <Field label="Rate (₹)"><input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: Number(e.target.value) })} /></Field>
        <Field label="Freight & charges (₹)"><input type="number" value={f.freight} onChange={(e) => setF({ ...f, freight: Number(e.target.value) })} /></Field>
        <Field label={L?.batchTracked ? "Batch (required for this line)" : "Batch (consumables)"}><input value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} placeholder="e.g. B2699" /></Field>
        <Field label="Manufacturer QR / label code" full><input value={f.mfrCode} onChange={(e) => setF({ ...f, mfrCode: e.target.value })} placeholder="Scan or type the code printed on the cartons — e.g. SGP-4113" /></Field>
        <Field label="Status"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "POSTED" })}><option value="POSTED">Received now (GRN)</option><option value="IN_TRANSIT">In transit (PO)</option></select></Field>
        {f.status === "IN_TRANSIT" && <Field label="ETA"><input type="date" value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></Field>}
      </div>
      {f.mfrCode && <Note style={{ marginTop: 9 }}>This label is filed against {it?.sku ?? "the item"} and stays scannable for good. Re-label it with your own code from Items → the item drawer.</Note>}
      {f.status === "POSTED" && <div style={{ marginTop: 13 }}><div className="sm" style={{ marginBottom: 6, fontFamily: "inherit" }}>Godown allocation — must sum to the quantity</div><AllocInputs godowns={godowns ?? []} alloc={alloc} setAlloc={setAlloc} qty={f.qty} /><div className="sm" style={{ marginTop: 4 }}>goods value {money(f.qty * f.rate)} · landed cost <b>{money2(landed)}</b> per unit after freight</div></div>}
    </>}
  </ModalFrame>;
}

// Adding an item without leaving the receipt. Only one modal can be open at a
// time, so this expands in place rather than stacking a second dialog.
function NewItemInline({ line, vendorId, onDone }: { line: { id: string; name: string; uom: string; gstPct: number; packUoms: string[]; batchTracked: boolean }; vendorId: string; onDone: (i: ItemView) => void }) {
  const { toast } = useUI();
  const { data: attrs } = useApi<{ lineId: string | null; key: string; label: string; values: string[] }[]>("/api/masters/attributes");
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState({ name: "", nameHi: "", designNo: "", uom: line.uom, packUom: line.packUoms[0] ?? "", perPack: 50, moq: 250, landedCost: 30, base: 50, hsn: "", gstPct: line.gstPct, attrs: {} as Record<string, string> });
  const save = async () => {
    if (!n.name.trim()) return toast("The item needs a name", "e");
    if (!n.hsn.trim()) return toast("HSN is required — it drives the tax on every invoice", "e");
    setBusy(true);
    try {
      const slabs = [{ fromQty: 1, toQty: 499, rate: n.base }, { fromQty: 500, toQty: 1999, rate: Math.round(n.base * .89) }, { fromQty: 2000, toQty: 4999, rate: Math.round(n.base * .8) }, { fromQty: 5000, toQty: 1e9, rate: Math.round(n.base * .74) }];
      const created = await post<ItemView>("/api/items", {
        lineId: line.id, name: n.name, nameHi: n.nameHi, designNo: n.designNo || undefined, attrs: n.attrs,
        uom: n.uom, packUom: n.packUom, perPack: Number(n.perPack), moq: Number(n.moq),
        landedCost: Number(n.landedCost), hsn: n.hsn, gstPct: Number(n.gstPct),
        vendorId: vendorId || null, batchTracked: line.batchTracked, slabs,
      });
      onDone(created);
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };
  return <div style={{ marginTop: 11, border: "1px solid var(--ac-bd)", background: "var(--ac-bg)", borderRadius: 6, padding: 13 }}>
    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ac-d)", marginBottom: 9 }}>New {line.name} item</div>
    <div className="fg">
      <Field label="Name *"><input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
      <Field label="Name (Hindi)"><input className="hi" value={n.nameHi} onChange={(e) => setN({ ...n, nameHi: e.target.value })} /></Field>
      <Field label="Design no"><input value={n.designNo} onChange={(e) => setN({ ...n, designNo: e.target.value })} placeholder="DSN-2610" /></Field>
      <Field label="HSN *"><input value={n.hsn} onChange={(e) => setN({ ...n, hsn: e.target.value })} placeholder="4817" /></Field>
      {attrs?.filter((a) => a.lineId === line.id).map((a) => <Field key={a.key} label={a.label}><select value={n.attrs[a.key] ?? ""} onChange={(e) => setN({ ...n, attrs: { ...n.attrs, [a.key]: e.target.value } })}><option value="">—</option>{a.values.map((v) => <option key={v}>{v}</option>)}</select></Field>)}
      <Field label="UOM"><input value={n.uom} onChange={(e) => setN({ ...n, uom: e.target.value })} /></Field>
      <Field label="Pack unit"><select value={n.packUom} onChange={(e) => setN({ ...n, packUom: e.target.value })}><option value="">—</option>{line.packUoms.map((p) => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Per pack"><input type="number" value={n.perPack} onChange={(e) => setN({ ...n, perPack: Number(e.target.value) })} /></Field>
      <Field label="MOQ"><input type="number" value={n.moq} onChange={(e) => setN({ ...n, moq: Number(e.target.value) })} /></Field>
      <Field label="Landed cost (₹)"><input type="number" value={n.landedCost} onChange={(e) => setN({ ...n, landedCost: Number(e.target.value) })} /></Field>
      <Field label="Slab 1 rate (₹)"><input type="number" value={n.base} onChange={(e) => setN({ ...n, base: Number(e.target.value) })} /></Field>
      <Field label="GST %"><input type="number" value={n.gstPct} onChange={(e) => setN({ ...n, gstPct: Number(e.target.value) })} /></Field>
    </div>
    <div className="sm" style={{ marginTop: 8 }}>SKU is issued automatically from the line code. Deeper slabs are set at 89 / 80 / 74 % of slab 1 — tune them later under Items &amp; Rates.</div>
    <button className="b b-p" style={{ marginTop: 11 }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Create and use this item"}</button>
  </div>;
}

function ReceiveModal({ p }: { p: PO }) {
  const { closeModal, closeDrawer, toast } = useUI(); const { data: godowns } = useGodowns();
  const [al, setAl] = useState<Record<string, Record<string, number>>>(Object.fromEntries(p.lines.map((l) => [l.itemId, { "GD-A": l.qty, "GD-B": 0, "GD-C": 0 }])));
  const [batch, setBatch] = useState<Record<string, string>>({});
  const [mfr, setMfr] = useState<Record<string, string>>(() => Object.fromEntries(p.lines.map((l) => [l.itemId, l.mfrCode ?? ""])));
  const go = async () => { try { await post(`/api/purchases/${p.id}/receive`, { lines: p.lines.map((l) => ({ itemId: l.itemId, alloc: al[l.itemId], batchNo: batch[l.itemId] || undefined, mfrCode: mfr[l.itemId] || undefined })) }); toast("Goods received — stock landed, landed cost recomputed", "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Receive — " + p.invNo} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Post GRN</button></>}>
    {p.lines.map((l) => <div key={l.id} style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 10, marginBottom: 9 }}><div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 7 }}>{l.item.sku} — {l.item.name} · {num(l.qty)} {l.item.uom}</div><AllocInputs godowns={godowns ?? []} alloc={al[l.itemId]} setAlloc={(a) => setAl({ ...al, [l.itemId]: a })} qty={l.qty} /><Field label="Batch (if batch-tracked)"><input value={batch[l.itemId] ?? ""} onChange={(e) => setBatch({ ...batch, [l.itemId]: e.target.value })} /></Field><Field label="Manufacturer QR / label code on the cartons"><input value={mfr[l.itemId] ?? ""} onChange={(e) => setMfr({ ...mfr, [l.itemId]: e.target.value })} placeholder="Scan or type — e.g. SGP-4113" /></Field></div>)}
    <Note style={{ marginTop: 4 }}>Whatever label arrives on the cartons is filed against the item here. It stays scannable even after the office sticks its own code over it.</Note>
  </ModalFrame>;
}

function VendorPayModal({ v }: { v: Vendor }) {
  const { closeModal, toast } = useUI(); const [amt, setAmt] = useState(v.outstanding); const [ref, setRef] = useState(() => "NEFT-" + Math.floor(Math.random() * 90000));
  const go = async () => { try { await post("/api/purchases/vendor-payments", { vendorId: v.id, amount: Number(amt), ref }); toast("Vendor payment recorded", "s"); closeModal(); refresh("/api/masters/vendors"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Pay vendor — " + v.name} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Record payment</button></>}><div className="fg"><Field label="Amount (₹)"><input type="number" value={amt} onChange={(e) => setAmt(Number(e.target.value))} /></Field><Field label="Reference"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div></ModalFrame>;
}
