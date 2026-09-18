"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { money, money2, num, fDate } from "@vivaha/shared";
import { useApi, useGodowns, useLines, refresh, type Godown } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post, patch } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { Pill, DF, Section, ModalFrame, Field, Note } from "@/components/ui";
import { Qr } from "@/components/Qr";
import type { ItemView } from "@/components/types";
import { exportCsv } from "@/lib/csv";
import { Icon } from "@/components/icons";

interface PO { id: string; invNo: string; date: string; eta: string | null; freight: number; total: number; gstPct: number; status: string; vendor: { id: string; name: string; gstin: string | null; terms: string }; lines: { id: string; itemId: string; qty: number; rate: number; alloc: Record<string, number>; places?: Place[]; batchNo: string | null; mfrCode: string | null; item: { sku: string; name: string; uom: string; landedCost: number; lineId: string } }[] }
/** One putaway: a godown, the rack inside it, and how many went there. */
export interface Place { godownId: string; rack: string; qty: number }

/** The godown roll-up a placement list adds up to — what every screen that has
 *  only ever known about godowns still reads. */
export const placesToAlloc = (places: Place[]) => {
  const a: Record<string, number> = {};
  for (const p of places) if (p.qty > 0) a[p.godownId] = (a[p.godownId] ?? 0) + Number(p.qty);
  return a;
};
/** An older document carries only its godown split; show it as placements with
 *  the rack unrecorded rather than as nothing at all. */
export const allocToPlaces = (alloc: Record<string, number> | undefined, places: Place[] | undefined): Place[] =>
  places?.length ? places.map((p) => ({ godownId: p.godownId, rack: p.rack ?? "", qty: p.qty }))
    : Object.entries(alloc ?? {}).filter(([, q]) => q > 0).map(([godownId, qty]) => ({ godownId, rack: "", qty }));

interface Vendor { id: string; name: string; gstin: string | null; terms: string; city: string; phone: string; documents: number; purchased: number; invoiced: number; paid: number; outstanding: number; oldestDays: number }

export default function PurchasePage() {
  const { line } = useAppState(); const { can } = useAuth(); const { openModal } = useUI(); const router = useRouter();
  const [tab, setTab] = useState("grn"); const [q, setQ] = useState("");
  const { data: pos } = useApi<PO[]>(`/api/purchases?line=${line}&q=${encodeURIComponent(q)}`); const { data: vendors } = useApi<Vendor[]>("/api/masters/vendors");
  const rows = pos ?? []; const pg = usePager(rows); useFooter(tab === "grn" ? rows.length : vendors?.length ?? 0, "", pg.page, pg.pages, pg.setPage);
  return <>
    <PageHead crumb={["Supply", "Purchase & GRN"]} title="Purchase & GRN" sub={`${rows.length} documents · ${vendors?.length ?? 0} vendors · landed cost recomputed on every receipt`} tabs={[{ k: "grn", l: "Purchase invoices", n: rows.length }, { k: "vend", l: "Vendors", n: vendors?.length }, { k: "pay", l: "Vendor payables", n: vendors?.length }]} tab={tab} onTab={setTab}
      actions={<><button className="b b-o" onClick={() => exportCsv("purchase", ["PO", "Invoice", "Vendor", "Date", "Item", "Qty", "Rate", "Freight", "Status"], rows.map((p) => [p.id, p.invNo, p.vendor.name, fDate(p.date), p.lines[0]?.item.sku, p.lines[0]?.qty, p.lines[0]?.rate, p.freight, p.status]))}><Icon n="download" s={13} /> Export</button>{can("purchase.create") && (tab === "grn"
        ? <button className="b b-p" onClick={() => openModal(<PurchaseModal />, "w")}>+ New purchase invoice</button>
        : <button className="b b-p" onClick={() => openModal(<VendorForm />)}>+ New vendor</button>)}</>} />
    <div className="wa">
      {tab === "grn" && <><div className="tbar"><div className="tsr"><Icon n="search" s={13} /><input placeholder="PO or invoice number…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="gw"><table className="dg"><thead><tr><th>Document</th><th>Vendor</th><th>Date</th><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Freight</th><th className="n">Value</th><th>Godown split</th><th>Status</th></tr></thead><tbody>
          {pg.rows.map((p) => { const l = p.lines[0]; return <tr key={p.id} onClick={() => router.push(`/purchase/${p.id}`)}><td><span className="rid">{p.invNo}</span><div className="sm">{p.id}</div></td><td className="w">{p.vendor.name}<div className="sm">{p.vendor.gstin}</div></td><td className="tab">{fDate(p.date)}</td><td className="w">{l?.item.name}<div className="sm">{l?.item.sku}{p.lines.length > 1 ? ` +${p.lines.length - 1}` : ""}</div></td><td className="n tab">{num(l?.qty)}</td><td className="n tab">{money(l?.rate)}</td><td className="n tab">{money(p.freight)}</td><td className="n tab" style={{ fontWeight: 600, color: "var(--t9)" }}>{money(p.total + p.freight)}</td><td className="sm">{l && Object.keys(l.alloc).length ? Object.keys(l.alloc).map((g) => g.replace("GD-", "") + ":" + num(l.alloc[g])).join(" · ") : "—"}</td><td><Pill s={p.status} /></td></tr>; })}
        </tbody></table></div></>}
      {tab === "vend" && <div className="gw"><table className="dg"><thead><tr><th>Vendor</th><th>GSTIN</th><th>City</th><th>Terms</th><th>Phone</th><th className="n">Documents</th><th className="n">Purchased</th><th></th></tr></thead><tbody>{vendors?.map((v) => <tr key={v.id} onClick={() => can("purchase.create") && openModal(<VendorForm vendor={v} />)} style={{ cursor: can("purchase.create") ? "pointer" : "default" }}><td>{v.name}</td><td className="sm">{v.gstin}</td><td>{v.city}</td><td>{v.terms}</td><td className="sm">{v.phone}</td><td className="n tab">{v.documents}</td><td className="n tab">{money(v.purchased)}</td><td>{can("purchase.create") && <button className="b b-o b-s" onClick={(e) => { e.stopPropagation(); openModal(<VendorForm vendor={v} />); }}>Edit</button>}</td></tr>)}</tbody></table></div>}
      {tab === "pay" && <><Note style={{ marginBottom: 11 }}>Vendor payables mirror the customer ledger: an invoice posts a credit, a payment posts a debit, ageing runs from the invoice date.</Note>
        <div className="gw"><table className="dg"><thead><tr><th>Vendor</th><th>Terms</th><th className="n">Invoiced</th><th className="n">Paid</th><th className="n">Outstanding</th><th className="n">Oldest</th><th></th></tr></thead><tbody>{vendors?.map((v) => <tr key={v.id} style={{ cursor: "default" }}><td>{v.name}</td><td>{v.terms}</td><td className="n tab">{money(v.invoiced)}</td><td className="n tab" style={{ color: "var(--ok)" }}>{money(v.paid)}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{money(v.outstanding)}</td><td className="n tab" style={{ color: v.oldestDays > 60 ? "var(--er)" : "var(--t6)" }}>{v.oldestDays} d</td><td>{can("purchase.create") && <button className="b b-o b-s" onClick={() => openModal(<VendorPayModal v={v} />)}>Pay</button>}</td></tr>)}</tbody></table></div></>}
    </div>
  </>;
}

// A purchase document opens on its own page, the way an item, a firm and an
// order do. Goods receipt is a decision made with the document in front of you
// — which godown, which batch, what the carton was labelled — and a panel
// sliding over the register was a poor place to make it.
export function PurchaseDetail({ id }: { id: string }) {
  const { data: p } = useApi<PO>(`/api/purchases/${id}`);
  const { openModal, toast } = useUI(); const { data: godowns } = useGodowns(); const { can } = useAuth();
  const router = useRouter();
  useFooter(null);
  if (!p) return <div className="wa"><div className="sm">Loading…</div></div>;
  const gross = p.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const labelled = p.lines.filter((l) => l.mfrCode);

  return <>
    <PageHead
      crumb={["Catalogue", "Purchase", p.invNo]}
      title={`${p.invNo} — ${p.vendor.name}`}
      sub={<>{p.status === "POSTED" ? "Goods received" : "In transit"} · {p.id} · {fDate(p.date)}{p.eta ? ` · ETA ${fDate(p.eta)}` : ""}</>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/purchase")}><Icon n="chevronL" s={13} /> Back to purchase</button>
        {p.status === "IN_TRANSIT" && can("purchase.create") && <button className="b b-o" onClick={() => openModal(<PurchaseModal po={p} />, "w")}>Edit</button>}
        {p.status === "IN_TRANSIT" && can("purchase.create") && <button className="b b-p" onClick={() => openModal(<ReceiveModal p={p} />, "w")}>Receive goods</button>}
        <button className="b b-o" onClick={() => toast("Printed GRN", "i")}>Print GRN</button>
      </>}
    />
    <div className="wa">
      <div className="idg">
        <div>
          <div className="pn"><div className="pnb">
            <Section t="Lines">
              <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Amount</th><th>Godown</th></tr></thead><tbody>
                {p.lines.map((l) => <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/items/${l.itemId}`)}>
                  <td className="w">{l.item.name}<div className="sm"><span className="rid">{l.item.sku}</span>{l.batchNo ? ` · batch ${l.batchNo}` : ""}</div></td>
                  <td className="n tab">{num(l.qty)}</td>
                  <td className="n tab">{money(l.rate)}</td>
                  <td className="n tab">{money(l.qty * l.rate)}</td>
                  <td className="sm">{placeLabel(l, godowns)}</td>
                </tr>)}
              </tbody></table>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11 }}><div style={{ minWidth: 230 }}>
                <DF k="Goods value" v={money(gross)} mono />
                <DF k="Freight" v={money(p.freight)} mono />
                <DF k="Landed total" v={money(gross + p.freight)} mono strong />
              </div></div>
              <div className="sm" style={{ marginTop: 7 }}>Freight is apportioned across the lines by value when the goods are received, which is what moves each item&apos;s landed cost.</div>
            </Section>
          </div></div>
          <div className="pn"><div className="pnb">
            <Section t="Labels received">
              {labelled.length
                ? labelled.map((l) => <div key={l.id} style={{ display: "flex", gap: 11, alignItems: "center", marginBottom: 9 }}>
                    <Qr value={l.mfrCode!} size={62} />
                    <div><div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 700 }}>{l.mfrCode}</div><div className="sm">{l.item.sku} · manufacturer label, filed on receipt</div></div>
                  </div>)
                : <div className="sm">No manufacturer label was recorded on this document. It is captured at goods receipt, so a carton that arrives under a factory code can still be scanned later.</div>}
            </Section>
          </div></div>
        </div>

        <div>
          <div className="pn"><div className="pnb">
            <Section t="Document">
              <DF k="Vendor" v={p.vendor.name} /><DF k="GSTIN" v={p.vendor.gstin ?? "—"} mono /><DF k="Terms" v={p.vendor.terms} />
              <DF k="PO number" v={p.id} mono /><DF k="Invoice" v={p.invNo} mono /><DF k="Date" v={fDate(p.date)} />
              {p.eta && <DF k="ETA" v={fDate(p.eta)} />}
              <DF k="Status" v={<Pill s={p.status} />} />
            </Section>
          </div></div>
          {p.status === "IN_TRANSIT" && <div className="pn"><div className="pnb">
            <Note k="w">These goods have not landed yet. Receiving them posts the stock into the godowns named on each line, apportions the freight, and moves the landed cost — so receive it when the cartons are actually in.</Note>
          </div></div>}
        </div>
      </div>
    </div>
  </>;
}

// Where the goods are being put away.
//
// This used to be one number box per godown, laid out across the screen: with
// four godowns the operator typed three zeroes to record one delivery, and the
// rack a bundle actually went on had nowhere to go at all — which is why the
// office ended up making a "godown" per rack. Now a placement is a row the
// operator adds: choose the godown, choose the rack inside it, type how many.
// Most receipts are one row.
export function PlaceRows({ godowns, places, setPlaces, qty }: { godowns: Godown[]; places: Place[]; setPlaces: (p: Place[]) => void; qty: number }) {
  const s = places.reduce((a, p) => a + (Number(p.qty) || 0), 0);
  const first = godowns[0]?.id ?? "";
  const set = (i: number, patch: Partial<Place>) => setPlaces(places.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const racksOf = (gid: string) => godowns.find((g) => g.id === gid)?.racks ?? [];
  // Whatever is still unplaced goes into the new row, so the common case —
  // one delivery, one rack — is choose the rack and the quantity is already right.
  const add = () => setPlaces([...places, { godownId: first, rack: "", qty: Math.max(0, qty - s) }]);

  return <>
    {places.map((p, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr 1.3fr 90px auto", gap: 7, alignItems: "center", marginBottom: 6 }}>
      <select value={p.godownId} onChange={(e) => set(i, { godownId: e.target.value, rack: "" })} style={{ height: 30 }}>
        {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <select value={p.rack} onChange={(e) => set(i, { rack: e.target.value })} style={{ height: 30 }} title="Which rack inside that godown">
        <option value="">Rack not recorded</option>
        {racksOf(p.godownId).map((r) => <option key={r.id} value={r.code}>{r.code}{r.name ? ` — ${r.name}` : ""}</option>)}
      </select>
      <input type="number" value={p.qty} onChange={(e) => set(i, { qty: Number(e.target.value) || 0 })} style={{ height: 30, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} />
      {places.length > 1
        ? <button className="b b-g b-s" type="button" onClick={() => setPlaces(places.filter((_, n) => n !== i))} title="Remove"><Icon n="x" s={11} /></button>
        : <span />}
    </div>)}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
      <button className="b b-o b-s" type="button" disabled={!godowns.length} onClick={add}>+ Another godown or rack</button>
      <span className="sm">{s === qty
        ? <span style={{ color: "var(--ok)", fontWeight: 700 }}><Icon n="check" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {num(s)} / {num(qty)} placed</span>
        : <span style={{ color: "var(--er)", fontWeight: 700 }}><Icon n="x" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {num(s)} / {num(qty)} — must equal quantity</span>}</span>
    </div>
    {places.some((p) => !p.rack) && <div className="sm" style={{ marginTop: 5 }}>A row with no rack is stored as unrecorded — fine when the godown does not use racks, but the picker will not be told where to look.</div>}
  </>;
}

// "GD-A R-3:400 · GD-B:100" — where the goods went, rack included when one was
// recorded. Falls back to the godown split for documents raised before racks.
function placeLabel(l: { alloc: Record<string, number>; places?: Place[] }, godowns: Godown[] | undefined) {
  const shortOf = (id: string) => godowns?.find((x) => x.id === id)?.short ?? id;
  const places = allocToPlaces(l.alloc, l.places);
  if (!places.length) return "—";
  return places.map((p) => `${shortOf(p.godownId)}${p.rack ? " " + p.rack : ""}:${num(p.qty)}`).join(" · ");
}

export function PurchaseModal({ po }: { po?: PO } = {}) {
  const { closeModal, toast } = useUI(); const { data: godowns } = useGodowns(); const { data: lines } = useLines(); const { data: vendors, mutate: mutVendors } = useApi<Vendor[]>("/api/masters/vendors");
  const { line: globalLine } = useAppState();
  // A purchase belongs to one module. The item list is scoped to that line and
  // never shows anything from another — cards here, ink there, no crossover.
  const stockLines = (lines ?? []).filter((l) => l.workflow !== "JOBWORK");
  const edit = !!po;
  const [pickedLine, setPickedLine] = useState(po?.lines[0]?.item.lineId ?? "");
  const lineId = pickedLine || (globalLine !== "ALL" ? globalLine : "") || stockLines[0]?.id || "";
  const L = stockLines.find((l) => l.id === lineId);
  const { data: items, mutate: mutItems } = useApi<{ items: ItemView[] }>(lineId ? `/api/items?line=${lineId}` : null);
  const its = items?.items ?? [];
  const [adding, setAdding] = useState(false);
  const [newVendor, setNewVendor] = useState(false);
  // A vendor invoice lists what the lorry brought, which is rarely one item.
  // Each row carries its own quantity, rate, batch, label and godown split;
  // freight is charged once on the document and apportioned across them.
  const [rows, setRows] = useState<PoRow[]>(po
    ? po.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, batchNo: l.batchNo ?? "", mfrCode: l.mfrCode ?? "", places: allocToPlaces(l.alloc, l.places) }))
    : [blankRow()]);
  const [f, setF] = useState(() => ({
    vendorId: po?.vendor.id ?? "",
    invNo: po?.invNo ?? "PINV-" + (7900 + Math.floor(Math.random() * 90)),
    freight: po?.freight ?? 1800,
    status: (po?.status ?? "POSTED") as "POSTED" | "IN_TRANSIT",
    eta: po?.eta ? po.eta.slice(0, 10) : "",
  }));
  const [busy, setBusy] = useState(false);

  const setRow = (i: number, patch: Partial<PoRow>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const dropRow = (i: number) => setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, n) => n !== i)));
  // Changing the line on an existing document would orphan its lines, so it is
  // fixed once the document exists.
  const switchLine = (id: string) => { if (edit) return; setPickedLine(id); setRows([blankRow()]); setAdding(false); };

  const itemOf = (r: PoRow) => its.find((i) => i.id === r.itemId) ?? null;
  const goods = rows.reduce((sum, r) => sum + Number(r.qty) * Number(r.rate), 0);

  const submit = async () => {
    if (!its.length) return toast(`No item in ${L?.name ?? "this line"} yet — add one first`, "e");
    const picked = rows.filter((r) => r.itemId && Number(r.qty) > 0);
    if (!picked.length) return toast("Add at least one item with a quantity", "e");
    const dupes = picked.map((r) => r.itemId).filter((id, i, a) => a.indexOf(id) !== i);
    if (dupes.length) return toast("The same item is on two lines — put the whole quantity on one", "e");
    if (f.status === "POSTED") {
      for (const r of picked) {
        const sum = r.places.reduce((a, pl) => a + (Number(pl.qty) || 0), 0);
        if (sum !== Number(r.qty)) return toast(`${itemOf(r)?.sku ?? "A line"}: what was put away must add up to ${num(Number(r.qty))}`, "e");
        if (L?.batchTracked && !r.batchNo.trim()) return toast(`${itemOf(r)?.sku ?? "A line"} is batch-tracked — enter the batch number`, "e");
      }
    }
    setBusy(true);
    const body = {
      vendorId: f.vendorId || vendors?.[0]?.id, invNo: f.invNo, freight: Number(f.freight), status: f.status,
      eta: f.eta || undefined,
      lines: picked.map((r) => ({
        itemId: r.itemId, qty: Number(r.qty), rate: Number(r.rate), places: r.places, alloc: placesToAlloc(r.places),
        batchNo: r.batchNo || undefined, mfrCode: r.mfrCode || undefined,
      })),
    };
    try {
      if (edit) await patch(`/api/purchases/${po!.id}`, body);
      else await post("/api/purchases", body);
      toast(edit
        ? `${po!.invNo} corrected · ${picked.length} item${picked.length === 1 ? "" : "s"}`
        : f.status === "POSTED"
          ? `Receipt posted · ${picked.length} item${picked.length === 1 ? "" : "s"} · landed cost recalculated`
          : `PO raised · ${picked.length} item${picked.length === 1 ? "" : "s"} — they show 'Arriving' until received`, "s");
      closeModal(); refresh("/api/");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <ModalFrame title={edit ? `Edit — ${po!.invNo}` : `New purchase invoice — ${L?.name ?? "…"}`} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={adding || busy} onClick={submit}>{edit ? "Save changes" : f.status === "POSTED" ? "Post receipt" : "Raise PO"}</button></>}>
    {edit && <Note style={{ marginBottom: 12 }}>This purchase is still in transit, so nothing has landed and the whole document can be corrected. Once it is received the goods are in a godown and the landed cost is recomputed around them — a correction after that is a stock adjustment, not an edit.</Note>}
    <div className="fg">
      <Field label="Business line — the document stays inside it" full>
        <select value={lineId} disabled={edit} onChange={(e) => switchLine(e.target.value)}>{stockLines.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.uom} · GST {l.gstPct}%</option>)}</select>
      </Field>
      <Field label="Vendor">
        <div style={{ display: "flex", gap: 7 }}>
          <select style={{ flex: 1 }} value={f.vendorId || vendors?.[0]?.id || ""} onChange={(e) => setF({ ...f, vendorId: e.target.value })}>{vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          <button className="b b-o" type="button" onClick={() => setNewVendor((v) => !v)}>{newVendor ? "Cancel" : "+ New"}</button>
        </div>
      </Field>
      <Field label="Vendor invoice no"><input value={f.invNo} onChange={(e) => setF({ ...f, invNo: e.target.value })} /></Field>
    </div>

    {newVendor && <VendorInline onDone={async (v) => { await mutVendors(); setF((x) => ({ ...x, vendorId: v.id })); setNewVendor(false); toast(`${v.name} added`, "s"); }} onCancel={() => setNewVendor(false)} />}

    <div className="st" style={{ marginTop: 15 }}>Items on this invoice</div>
    <div className="sm" style={{ marginBottom: 8 }}>Everything the vendor billed on one document, {L?.name ?? "this line"} only. Freight below is charged once and split across the lines by value.</div>

    {rows.map((r, i) => {
      const it = itemOf(r);
      const landed = Number(r.qty) > 0 ? (Number(r.qty) * Number(r.rate) + (goods > 0 ? (Number(f.freight) * (Number(r.qty) * Number(r.rate))) / goods : 0)) / Number(r.qty) : 0;
      return <div key={i} className="pol">
        <div className="polh">
          <span className="sm" style={{ fontWeight: 700 }}>Line {i + 1}</span>
          {it && <span className="sm">{it.sku} · on hand {num(it.available)}</span>}
          <span style={{ marginLeft: "auto" }} />
          {rows.length > 1 && <button className="b b-g b-s" type="button" onClick={() => dropRow(i)} title="Remove this line"><Icon n="x" s={11} /></button>}
        </div>
        <div className="fg">
          <Field label="Item" full>
            <select value={r.itemId} onChange={(e) => setRow(i, { itemId: e.target.value, rate: its.find((x) => x.id === e.target.value)?.landedCost || r.rate })}>
              <option value="">{its.length ? "Choose an item…" : `No ${L?.name} items yet`}</option>
              {its.map((x) => <option key={x.id} value={x.id}>{x.sku} — {x.name}</option>)}
            </select>
          </Field>
          <Field label="Quantity"><input type="number" value={r.qty} onChange={(e) => setRow(i, { qty: Number(e.target.value) })} /></Field>
          <Field label="Rate (₹)"><input type="number" value={r.rate} onChange={(e) => setRow(i, { rate: Number(e.target.value) })} /></Field>
          <Field label={L?.batchTracked ? "Batch (required)" : "Batch (if any)"}><input value={r.batchNo} onChange={(e) => setRow(i, { batchNo: e.target.value })} placeholder="e.g. B2699" /></Field>
          <Field label="Manufacturer label code"><input value={r.mfrCode} onChange={(e) => setRow(i, { mfrCode: e.target.value })} placeholder="e.g. SGP-4113" /></Field>
        </div>
        {f.status === "POSTED" && <div style={{ marginTop: 9 }}>
          <div className="sm" style={{ marginBottom: 6, fontFamily: "inherit" }}>Put away — which godown, which rack, how many</div>
          <PlaceRows godowns={godowns ?? []} places={r.places} setPlaces={(pl) => setRow(i, { places: pl })} qty={Number(r.qty)} />
        </div>}
        {Number(r.qty) > 0 && Number(r.rate) > 0 && <div className="sm" style={{ marginTop: 7 }}>
          goods {money(Number(r.qty) * Number(r.rate))} · landed <b>{money2(landed)}</b> per {it?.uom?.toLowerCase() ?? "unit"} after its share of freight
        </div>}
      </div>;
    })}

    <div style={{ display: "flex", gap: 7, marginTop: 4 }}>
      <button className="b b-o b-s" type="button" disabled={!its.length} onClick={addRow}>+ Add another item</button>
      <button className="b b-o b-s" type="button" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Create a new item"}</button>
    </div>

    {adding && L && <NewItemInline line={L} vendorId={f.vendorId || vendors?.[0]?.id || ""} onDone={async (created) => {
      await mutItems();
      // The item somebody just created is what they meant to buy: drop it into
      // the first empty line, or open a new one.
      setRows((rs) => {
        const blank = rs.findIndex((r) => !r.itemId);
        const filled = { ...blankRow(), itemId: created.id, rate: created.landedCost || 0 };
        return blank >= 0 ? rs.map((r, n) => (n === blank ? filled : r)) : [...rs, filled];
      });
      setAdding(false); toast(`${created.sku} created in ${L.name}`, "s"); refresh("/api/items");
    }} />}

    <div className="fg" style={{ marginTop: 13 }}>
      <Field label="Freight & charges (₹) — whole document"><input type="number" value={f.freight} onChange={(e) => setF({ ...f, freight: Number(e.target.value) })} /></Field>
      <Field label="Status"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "POSTED" })}><option value="POSTED">Received now (GRN)</option><option value="IN_TRANSIT">In transit (PO)</option></select></Field>
      {f.status === "IN_TRANSIT" && <Field label="ETA"><input type="date" value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></Field>}
    </div>

    <div className="pot">
      <div className="df"><span className="k">Goods value · {rows.filter((r) => r.itemId).length} line{rows.filter((r) => r.itemId).length === 1 ? "" : "s"}</span><span className="v m">{money(goods)}</span></div>
      <div className="df"><span className="k">Freight</span><span className="v m">{money(Number(f.freight))}</span></div>
      <div className="df"><span className="k"><b>Document total</b></span><span className="v m" style={{ fontWeight: 700 }}>{money(goods + Number(f.freight))}</span></div>
    </div>
  </ModalFrame>;
}

interface PoRow { itemId: string; qty: number; rate: number; batchNo: string; mfrCode: string; places: Place[] }
const blankRow = (): PoRow => ({ itemId: "", qty: 0, rate: 0, batchNo: "", mfrCode: "", places: [] });

// A vendor the office has not dealt with before, added without losing the
// half-typed invoice behind it. Same fields as the vendor master, because it is
// the vendor master — there is no lighter version of a firm you owe money to.
function VendorInline({ onDone, onCancel }: { onDone: (v: Vendor) => void; onCancel: () => void }) {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ name: "", gstin: "", terms: "Net 30", city: "", phone: "" });
  const save = async () => {
    if (!v.name.trim()) return toast("The vendor needs a name", "e");
    setBusy(true);
    try { onDone(await post<Vendor>("/api/masters/vendors", { ...v, gstin: v.gstin || undefined })); }
    catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };
  return <div className="inl">
    <div className="inlh">New vendor</div>
    <div className="fg">
      <Field label="Vendor name *"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Shubh Kagaz Mills" /></Field>
      <Field label="GSTIN"><input value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value })} placeholder="33AABCS1429K1Z2" /></Field>
      <Field label="City"><input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} placeholder="Sivakasi" /></Field>
      <Field label="Payment terms"><select value={v.terms} onChange={(e) => setV({ ...v, terms: e.target.value })}>{["Advance", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Phone" full><input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="+91 141 2200000" /></Field>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
      <button className="b b-o b-s" type="button" onClick={onCancel}>Cancel</button>
      <button className="b b-p b-s" type="button" disabled={busy} onClick={save}>Save vendor</button>
    </div>
  </div>;
}

// Editing one. A vendor's terms and numbers change; the documents that name it
// keep their own figures, so this never rewrites what was already billed.
export function VendorForm({ vendor }: { vendor?: Vendor } = {}) {
  const { closeModal, toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ name: vendor?.name ?? "", gstin: vendor?.gstin ?? "", terms: vendor?.terms ?? "Net 30", city: vendor?.city ?? "", phone: vendor?.phone ?? "" });
  const save = async () => {
    if (!v.name.trim()) return toast("The vendor needs a name", "e");
    setBusy(true);
    try {
      const body = { ...v, name: v.name.trim(), gstin: v.gstin || undefined };
      if (vendor) { await patch(`/api/masters/vendors/${vendor.id}`, body); toast(`${v.name} updated`, "s"); }
      else { await post("/api/masters/vendors", body); toast(`${v.name} added`, "s"); }
      closeModal(); refresh("/api/masters/vendors");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };
  return <ModalFrame title={vendor ? `Edit vendor — ${vendor.name}` : "New vendor"} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={busy} onClick={save}>{vendor ? "Save changes" : "Add vendor"}</button></>}>
    <div className="fg">
      <Field label="Vendor name *"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="GSTIN"><input value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value })} placeholder="33AABCS1429K1Z2" /></Field>
      <Field label="City"><input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></Field>
      <Field label="Payment terms"><select value={v.terms} onChange={(e) => setV({ ...v, terms: e.target.value })}>{["Advance", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Phone" full><input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
    </div>
    {vendor
      ? <Note style={{ marginTop: 11 }}>{vendor.documents} document{vendor.documents === 1 ? "" : "s"} name this vendor. They keep the figures they were billed at — only the vendor record changes.</Note>
      : <Note style={{ marginTop: 11 }}>A vendor can also be added without leaving a purchase invoice — the <b>+ New</b> beside the vendor picker does the same thing.</Note>}
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

function ReceiveModal({ p }: { p: PO }) { const { closeModal, toast } = useUI(); const { data: godowns } = useGodowns();
  // Opens on whatever the buyer wrote down when the order was raised, and on
  // one blank row otherwise. It used to open on a hard-coded GD-A/GD-B/GD-C
  // split, which is a list of godowns this firm may never have had.
  const [al, setAl] = useState<Record<string, Place[]>>(() => Object.fromEntries(p.lines.map((l) => [l.itemId, allocToPlaces(l.alloc, l.places)])));
  const [batch, setBatch] = useState<Record<string, string>>({});
  const [mfr, setMfr] = useState<Record<string, string>>(() => Object.fromEntries(p.lines.map((l) => [l.itemId, l.mfrCode ?? ""])));
  const go = async () => { try { await post(`/api/purchases/${p.id}/receive`, { lines: p.lines.map((l) => ({ itemId: l.itemId, places: al[l.itemId] ?? [], alloc: placesToAlloc(al[l.itemId] ?? []), batchNo: batch[l.itemId] || undefined, mfrCode: mfr[l.itemId] || undefined })) }); toast("Goods received — stock landed, landed cost recomputed", "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Receive — " + p.invNo} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Post GRN</button></>}>
    {p.lines.map((l) => <div key={l.id} style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 10, marginBottom: 9 }}><div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 7 }}>{l.item.sku} — {l.item.name} · {num(l.qty)} {l.item.uom}</div><PlaceRows godowns={godowns ?? []} places={al[l.itemId] ?? []} setPlaces={(pl) => setAl({ ...al, [l.itemId]: pl })} qty={l.qty} /><Field label="Batch (if batch-tracked)"><input value={batch[l.itemId] ?? ""} onChange={(e) => setBatch({ ...batch, [l.itemId]: e.target.value })} /></Field><Field label="Manufacturer QR / label code on the cartons"><input value={mfr[l.itemId] ?? ""} onChange={(e) => setMfr({ ...mfr, [l.itemId]: e.target.value })} placeholder="Scan or type — e.g. SGP-4113" /></Field></div>)}
    <Note style={{ marginTop: 4 }}>Whatever label arrives on the cartons is filed against the item here. It stays scannable even after the office sticks its own code over it.</Note>
  </ModalFrame>;
}

function VendorPayModal({ v }: { v: Vendor }) {
  const { closeModal, toast } = useUI(); const [amt, setAmt] = useState(v.outstanding); const [ref, setRef] = useState(() => "NEFT-" + Math.floor(Math.random() * 90000));
  const go = async () => { try { await post("/api/purchases/vendor-payments", { vendorId: v.id, amount: Number(amt), ref }); toast("Vendor payment recorded", "s"); closeModal(); refresh("/api/masters/vendors"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Pay vendor — " + v.name} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Record payment</button></>}><div className="fg"><Field label="Amount (₹)"><input type="number" value={amt} onChange={(e) => setAmt(Number(e.target.value))} /></Field><Field label="Reference"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div></ModalFrame>;
}
