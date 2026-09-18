"use client";
import { useState } from "react";
import { money, money2, num, fDate, fDT, dueLbl, daysTo, ORDER_STATUS_LABEL, type OrderStatus } from "@vivaha/shared";
import { useRouter } from "next/navigation";
import { useApi, useGodowns, useLines, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { DF, Section, ModalFrame, Field, Note, Hold, Timeline } from "./ui";
import { PageHead } from "./PageHead";
import { useFooter } from "./Shell";
import { Icon } from "./icons";
import type { Order, Invoice } from "./types";
import { InvoiceModal } from "./InvoiceModal";

export function useOrderActions() { const { toast, closeModal, openModal } = useUI(); const { can, user } = useAuth();
  const done = (msg: string, k: "s" | "w" = "s") => { toast(msg, k); closeModal(); refresh("/api/"); };
  const run = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); done(msg); } catch (e) { toast(errMsg(e), "e"); } };
  const approve = (o: Order) => {
    if (o.gate.restricted) { if (o.gate.mode === "BLOCK" && !can("credit.override")) return openModal(<GateModal o={o} canOv={false} />, "n"); return openModal(<GateModal o={o} canOv />, "n"); }
    run(() => post(`/api/orders/${o.id}/approve`), "Approved — hold stays until stock is reserved");
  };
  const reject = (o: Order) => openModal(<ReasonModal title={"Reject order — " + o.id} label="Reason (required — sent to the customer on WhatsApp)" ph="e.g. Credit limit exceeded, please clear invoice VC/26-27/0388" btn="Reject and release hold" danger onSubmit={(r) => run(() => post(`/api/orders/${o.id}/reject`, { reason: r }), "Rejected — hold released, customer notified")} />, "n");
  const cancel = (o: Order) => openModal(<ReasonModal title={"Cancel order — " + o.id} label="Reason (required)" ph="e.g. Customer cancelled — wedding date changed" btn="Cancel order" danger onSubmit={(r) => run(() => post(`/api/orders/${o.id}/cancel`, { reason: r }), "Order cancelled — stock released")} />, "n");
  const reserve = (o: Order) => run(() => post(`/api/orders/${o.id}/reserve`), `Stock reserved for ${o.id}`);
  const status = (o: Order, to: string, why: string) => run(() => post(`/api/orders/${o.id}/status`, { to }), `${o.id} → ${why}`);
  const revive = (o: Order) => run(() => post(`/api/orders/${o.id}/revive`), "Revived — original rates kept, hold restarted");
  const allocate = (o: Order) => openModal(<AllocModal o={o} />, "w");
  const dispatch = (o: Order) => openModal(<DispatchModal o={o} />, "w");
  const actionBtn = (o: Order, stop = true) => {
    const e = (fn: () => void) => (ev: React.MouseEvent) => { if (stop) ev.stopPropagation(); fn(); };
    const s = o.status;
    if (s === "BOOKED" && can("order.approve")) return <button className="b b-p b-s" onClick={e(() => approve(o))}>Approve</button>;
    if (s === "APPROVED" && (can("order.approve") || can("order.allocate"))) return <button className="b b-o b-s" onClick={e(() => reserve(o))}>Reserve</button>;
    if (s === "RESERVED" && can("order.allocate")) return <button className="b b-o b-s" onClick={e(() => allocate(o))}>Allocate</button>;
    if (s === "ALLOCATED" && can("order.pick")) return <button className="b b-o b-s" onClick={e(() => status(o, "PICKING", "Picking"))}>Start picking</button>;
    if (s === "PICKING" && can("order.pick")) return <button className="b b-o b-s" onClick={e(() => status(o, "PICKED", "Picked"))}>Mark picked</button>;
    if (s === "PICKED" && can("order.pick")) return <button className="b b-o b-s" onClick={e(() => status(o, "PACKED", "Packed"))}>Pack</button>;
    if (s === "PACKED" && can("order.pick")) return <button className="b b-o b-s" onClick={e(() => status(o, "READY_TO_DISPATCH", "Ready to Dispatch"))}>Stage</button>;
    if ((s === "READY_TO_DISPATCH" || s === "PARTIALLY_DISPATCHED") && can("order.dispatch")) return <button className="b b-p b-s" onClick={e(() => dispatch(o))}>Dispatch</button>;
    if (s === "DISPATCHED" && can("order.dispatch")) return <button className="b b-o b-s" onClick={e(() => status(o, "DELIVERED", "Delivered"))}>Delivered</button>;
    if (s === "LAPSED" && can("order.approve")) return <button className="b b-o b-s" onClick={e(() => revive(o))}>Revive</button>;
    return null;
  };
  return { approve, reject, cancel, reserve, status, revive, allocate, dispatch, actionBtn, user };
}

// An order opens on its own page, the way a card and a firm do. The order is
// the busiest record in the business — lines, credit, allocation, invoices,
// dispatch and its whole history — and a drawer made all of it a scroll over
// the queue it came from.
export function OrderDetail({ id }: { id: string }) {
  const { data: o, mutate } = useApi<Order & { company: { name: string } }>(`/api/orders/${id}`);
  const { openModal } = useUI(); const { can } = useAuth(); const { data: lines } = useLines();
  const router = useRouter();
  const A = useOrderActions();
  // The footer's count belongs to the queue behind this; an order has none.
  useFooter(null);
  if (!o) return <div className="wa"><div className="sm">Loading…</div></div>;
  const c = o.customer, g = o.gate;
  const groups: Record<string, typeof o.lines> = {};
  o.lines.forEach((l) => (groups[l.lineId] = groups[l.lineId] || []).push(l));

  return <>
    <PageHead
      crumb={["Sales", "Orders", o.id]}
      title={`${o.id} — ${c.name}`}
      sub={<>{ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status} · booked by {o.bookedBy} · {c.tehsil} · required {fDate(o.requiredBy)}</>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/orders")}><Icon n="chevronL" s={13} /> Back to orders</button>
        {A.actionBtn(o, false)}
        {o.status === "BOOKED" && can("order.approve") && <button className="b b-d" onClick={() => A.reject(o)}>Reject</button>}
        {["RESERVED", "ALLOCATED"].includes(o.status) && can("order.allocate") && <button className="b b-o" onClick={() => A.allocate(o)}>Re-allocate</button>}
        {["APPROVED", "RESERVED", "ALLOCATED"].includes(o.status) && can("order.approve") && <button className="b b-g" onClick={() => A.cancel(o)}>Cancel order</button>}
        {o.invoices.map((i) => <button key={i.no} className="b b-o" onClick={() => openModal(<InvoiceModal no={i.no} orderId={o.id} />, "w")}>Invoice {i.no.split("/").pop()}</button>)}
      </>}
    />
    <div className="wa">
      {o.holdUntil && <Note k="w" style={{ marginBottom: 13 }}>
        <b>Hold expires in <Hold until={o.holdUntil} onExpire={() => setTimeout(() => mutate(), 16000)} /></b> — then the stock releases and an alert is raised to the firm&apos;s sales executive.
      </Note>}
      {o.status === "PARTIALLY_DISPATCHED" && <Note k="w" style={{ marginBottom: 13 }}>Backorder open — {num(o.backorder)} units still reserved and dispatchable.</Note>}

      <div className="idg">
        <div>
          {Object.keys(groups).map((lid) => <div className="pn" key={lid}><div className="pnb">
            <Section t={<>{lines?.find((l) => l.id === lid)?.name} · GST {groups[lid][0].gstPct}%</>}>
              <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Amount</th><th>Godown</th></tr></thead><tbody>
                {groups[lid].map((l) => <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/items/${l.itemId}`)}>
                  <td className="w"><span className="rid">{l.item.sku}</span><div className="sm">{l.item.name}</div></td>
                  <td className="n tab">{num(l.qty)}{l.shipped > 0 && l.shipped < l.qty && <div className="sm" style={{ color: "var(--wa)" }}>{num(l.shipped)} shipped</div>}</td>
                  <td className="n tab">{money(l.rate)}<div className="sm">{l.priceSrc === "override" ? "override" : `slab ${money(l.slabRate)} ×${l.mult}`}</div></td>
                  <td className="n tab">{money(l.amount)}</td>
                  <td className="sm">{Object.keys(l.alloc).length ? Object.keys(l.alloc).map((gd) => gd.replace("GD-", "") + ":" + num(l.alloc[gd])).join(" ") : "—"}</td>
                </tr>)}
              </tbody></table>
            </Section>
          </div></div>)}
          <div className="pn"><div className="pnb">
            <Section t="History"><Timeline rows={o.events.slice().reverse().map((h) => ({ t: <span className="wo">{h.from ? h.from.replace(/_/g, " ") + " → " : ""}{h.to.replace(/_/g, " ")}</span>, n: `${fDT(h.at)} · ${h.by}${h.why ? " · " + h.why : ""}` }))} /></Section>
          </div></div>
        </div>

        <div>
          <div className="pn"><div className="pnb">
            <Section t="Invoice value">
              <DF k="Taxable" v={money2(o.subtotal)} mono /><DF k="GST" v={money2(o.tax)} mono /><DF k="Total" v={money2(o.total)} mono strong />
              {o.invoices.length
                ? <div className="sm" style={{ marginTop: 6 }}>{o.invoices.map((i) => <span key={i.no}>Tax invoice <b>{i.no}</b> posted {fDate(i.date)} · <a href="#" onClick={(e) => { e.preventDefault(); openModal(<InvoiceModal no={i.no} orderId={o.id} />, "w"); }}>view</a><br /></span>)}</div>
                : <div className="sm" style={{ marginTop: 6 }}>Invoice is raised on dispatch, for the shipped quantity only.</div>}
            </Section>
          </div></div>
          <div className="pn"><div className="pnb">
            <Section t="Firm">
              <DF k="Customer" v={<a href={`/customers/${c.id}`} onClick={(e) => { e.preventDefault(); router.push(`/customers/${c.id}`); }}>{c.name}</a>} />
              <DF k="Tehsil" v={c.tehsil} /><DF k="Booked by" v={o.bookedBy} />
              <DF k="Required by" v={<span style={{ color: daysTo(o.requiredBy) <= 7 ? "var(--er)" : undefined }}>{fDate(o.requiredBy)} <span className="sm">{dueLbl(o.requiredBy)}</span></span>} />
              <DF k="Credit position" mono v={<span style={{ color: g.restricted ? "var(--er)" : "var(--ok)" }}>{money(g.out)} / {money(c.creditLimit)}{g.timeBreach ? ` · ${g.oldestAge}d` : ""}</span>} />
            </Section>
          </div></div>
          {o.dispatches.map((d) => <div className="pn" key={d.id}><div className="pnb">
            <Section t={d.mode === "BUS" ? "Dispatch · by bus" : "Dispatch"}>
              {d.mode === "BUS"
                ? <>
                  <DF k="Bus number" v={d.busNo} mono /><DF k="Driver / conductor" v={d.driverPhone} mono />
                  {d.transporter && d.transporter !== "By bus" && <DF k="Operator / route" v={d.transporter} />}
                  <DF k="Loaded at" v={d.loadedAt ? fDT(d.loadedAt) : "—"} mono />
                </>
                : <><DF k="Transporter" v={d.transporter} mono /><DF k="LR number" v={d.lr} mono /><DF k="Tracking" v={d.tracking} mono /></>}
              <DF k="Packages" v={d.packages} mono /><DF k="Freight" v={money(d.freight)} mono /><DF k="Dispatched" v={fDate(d.at)} mono />
              {!!d.photos?.length && <div style={{ display: "flex", gap: 7, margin: "8px 0 4px" }}>
                {d.photos.map((src, i) => <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Loaded bundle ${i + 1}`} style={{ width: 92, height: 68, objectFit: "cover", borderRadius: 5, border: "1px solid var(--bd)" }} /></a>)}
              </div>}
              {/* The last step of sending goods is telling the firm they are coming. */}
              <button className="b b-o b-s" style={{ marginTop: 7 }} onClick={() => openModal(<ShareDispatchModal orderId={o.id} dispatchId={d.id} />, "n")}>Send details to the firm</button>
            </Section>
          </div></div>)}
        </div>
      </div>
    </div>
  </>;
}

function GateModal({ o, canOv }: { o: Order; canOv: boolean }) {
  const { closeModal, toast } = useUI(); const [r, setR] = useState(""); const { user } = useAuth(); const A = useOrderActions();
  const c = o.customer, g = o.gate;
  const go = async () => { if (!r.trim()) return toast("A reason is required to override the credit gate", "e"); try { await post(`/api/orders/${o.id}/approve`, { reason: r }); toast("Approved with override — logged in audit", "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Credit gate — " + c.name} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button>{canOv && <button className="b b-p" onClick={go}>Approve with override</button>}<button className="b b-d" onClick={() => { closeModal(); A.reject(o); }}>Reject order</button></>}>
    <Note k={c.gateMode === "BLOCK" ? "w" : undefined} style={{ marginBottom: 13 }}>{g.amountBreach && <div><b>Amount breached.</b> Outstanding {money(g.out)} + this order {money(o.total)} = {money(g.out + o.total)} against a limit of {money(c.creditLimit)}.</div>}{g.timeBreach && <div style={{ marginTop: 6 }}><b>Credit days exceeded.</b> Oldest unpaid invoice is {g.oldestAge} days old against agreed terms of {c.creditDays} days.</div>}<div style={{ marginTop: 7 }}>Gate mode for this firm is <b>{c.gateMode}</b>.</div></Note>
    {canOv ? <Field label="Reason for proceeding (required, audited)"><textarea value={r} onChange={(e) => setR(e.target.value)} placeholder="e.g. Cheque in hand, clearing Monday — approved by owner" /></Field> : <Note k="w">Your role ({user?.role}) cannot override a BLOCK gate. An Accounts Manager or Super Admin must approve this order.</Note>}
  </ModalFrame>;
}

export function ReasonModal({ title, label, ph, btn, danger, onSubmit, extra }: { title: string; label: string; ph?: string; btn: string; danger?: boolean; onSubmit: (r: string) => void; extra?: React.ReactNode }) {
  const { closeModal, toast } = useUI(); const [r, setR] = useState("");
  return <ModalFrame title={title} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className={"b " + (danger ? "b-d" : "b-p")} onClick={() => r.trim() ? onSubmit(r.trim()) : toast("A reason is required", "e")}>{btn}</button></>}>{extra}<Field label={label}><textarea value={r} onChange={(e) => setR(e.target.value)} placeholder={ph} /></Field></ModalFrame>;
}

function AllocModal({ o }: { o: Order }) { const { closeModal, toast } = useUI(); const { data: godowns } = useGodowns(); const { data: items } = useApi<{ items: { id: string; godowns: { godownId: string; available: number; oldestAt?: string | null }[] }[] }>("/api/items");
  const [al, setAl] = useState<Record<string, Record<string, number>>>(Object.fromEntries(o.lines.map((l) => [l.itemId, { ...l.alloc }])));
  const sum = (iid: string) => Object.values(al[iid] || {}).reduce((s, v) => s + (Number(v) || 0), 0);

  // First in, first out. The godown holding the oldest stock of this item is
  // emptied first, then the next — which is how a card that has been sitting
  // since last season leaves before the one that landed in June, instead of the
  // office picking whichever godown has the most and ageing the rest forever.
  //
  // A godown whose stock has no recorded arrival sorts last: we do not know
  // when it landed, and guessing would push it in front of stock we do know
  // about. The quantity already allocated to this line is available to it, so
  // re-running this on a saved allocation does not report a shortfall.
  const fifo = (iid: string) => {
    const line = o.lines.find((l) => l.itemId === iid);
    if (!line) return;
    const here = items?.items.find((i) => i.id === iid)?.godowns ?? [];
    const pool = (godowns ?? []).map((g) => {
      const row = here.find((x) => x.godownId === g.id);
      return { id: g.id, short: g.short, free: (row?.available ?? 0) + (line.alloc[g.id] ?? 0), oldestAt: row?.oldestAt ?? null };
    }).filter((x) => x.free > 0);
    pool.sort((a, b) => (a.oldestAt ?? "9999").localeCompare(b.oldestAt ?? "9999"));
    const next: Record<string, number> = {};
    let need = line.qty;
    for (const g of pool) { if (need <= 0) break; const take = Math.min(g.free, need); next[g.id] = take; need -= take; }
    setAl((a) => ({ ...a, [iid]: next }));
    if (need > 0) toast(`Only ${line.qty - need} of ${line.qty} available across the godowns for ${line.item.sku}`, "w");
  };
  const fifoAll = () => o.lines.forEach((l) => fifo(l.itemId));

  const save = async () => { if (o.lines.some((l) => sum(l.itemId) !== l.qty)) return toast("Every line must allocate to exactly its ordered quantity", "e"); try { await post(`/api/orders/${o.id}/allocate`, { alloc: al }); toast("Allocation saved", "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Godown allocation — " + o.id} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-o" onClick={fifoAll}>Auto-allocate · oldest stock first</button><button className="b b-p" onClick={save}>Confirm allocation</button></>}>
    <Note style={{ marginBottom: 13 }}>Opened on the split the booking took, which is by highest availability. <b>Auto-allocate</b> re-does every line first-in-first-out — the godown holding the oldest stock is emptied first — and each line can be re-done on its own. Whatever you settle on, every line must allocate to exactly its ordered quantity before you can confirm.</Note>
    {o.lines.map((l) => <div key={l.id} style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 10, marginBottom: 9 }}><div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>{l.item.sku} — {l.item.name} · need {num(l.qty)} {l.item.uom}</div><button className="b b-o b-s" style={{ marginLeft: "auto" }} onClick={() => fifo(l.itemId)}>Oldest first</button></div><div style={{ display: "flex", gap: 8 }}>{godowns?.map((g) => { const row = items?.items.find((i) => i.id === l.itemId)?.godowns.find((x) => x.godownId === g.id); const av = (row?.available ?? 0) + (l.alloc[g.id] || 0); return <div key={g.id} style={{ flex: 1 }}><div className="sm" style={{ marginBottom: 3 }}>{g.short} · avail {num(av)}{row?.oldestAt ? <> · since {fDate(row.oldestAt)}</> : null}</div><input type="number" value={al[l.itemId]?.[g.id] ?? 0} onChange={(e) => setAl({ ...al, [l.itemId]: { ...al[l.itemId], [g.id]: Number(e.target.value) || 0 } })} style={{ width: "100%", height: 30, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px" }} /></div>; })}</div><div className="sm" style={{ marginTop: 6 }}>{sum(l.itemId) === l.qty ? <span style={{ color: "var(--ok)", fontWeight: 700 }}><Icon n="check" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {num(sum(l.itemId))} / {num(l.qty)} allocated</span> : <span style={{ color: "var(--er)", fontWeight: 700 }}><Icon n="x" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {num(sum(l.itemId))} / {num(l.qty)} — must equal the ordered quantity</span>}</div></div>)}
  </ModalFrame>;
}

// A phone camera makes four thousand pixels and several megabytes of it; what
// is wanted is a photograph of a bundle on a bus, taken on a godown 4G
// connection. Redrawing it through a canvas before it leaves the browser is the
// difference between an upload that works at the bus stand and one that times
// out. Same treatment an item photograph gets.
const PHOTO_EDGE = 1400;
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read that file"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image we can read"));
      img.onload = () => {
        const scale = Math.min(1, PHOTO_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("Could not process that image"));
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

// Local time as an <input type="datetime-local"> wants it.
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function DispatchModal({ o }: { o: Order }) { const { closeModal, toast, openModal } = useUI();
  const [ship, setShip] = useState<Record<string, number>>(Object.fromEntries(o.lines.map((l) => [l.itemId, l.qty - l.shipped])));
  // Two ways goods leave this building, and they are not variations of one
  // form: a transport company issues an LR, a bus does not. Picking the mode
  // swaps the fields rather than showing both and leaving half of them blank.
  const [mode, setMode] = useState<"TRANSPORT" | "BUS">("TRANSPORT");
  const [f, setF] = useState(() => ({ transporter: "Rajasthan Roadways Cargo", lr: "LR-" + (56000 + Math.floor(Math.random() * 3000)), tracking: "TRK" + (905000 + Math.floor(Math.random() * 9000)), packages: o.lines.length + 1, freight: 650, ewb: o.total > 50000 ? "EWB-" + (721400 + Math.floor(Math.random() * 900)) : "" }));
  const [bus, setBus] = useState(() => ({ operator: "", busNo: "", driverPhone: "", loadedAt: localNow() }));
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (photos.length >= 2) return toast("Two photographs are enough — remove one to add another", "e");
    try { const src = await shrink(file); setPhotos((p) => [...p, src]); }
    catch (e) { toast(errMsg(e), "e"); }
  };

  const go = async () => {
    if (mode === "BUS") {
      if (!bus.busNo.trim()) return toast("Enter the bus number — there is no LR to trace a bus consignment by", "e");
      if (!bus.driverPhone.trim()) return toast("Enter the driver or conductor's phone — the customer rings it to collect", "e");
      if (!photos.length) return toast("Photograph the bundle on the bus — it is the only proof of handover there is", "e");
    }
    setBusy(true);
    const body = mode === "BUS"
      ? { ship, mode, transporter: bus.operator.trim() || "By bus", busNo: bus.busNo.trim(), driverPhone: bus.driverPhone.trim(), loadedAt: new Date(bus.loadedAt).toISOString(), photos, packages: Number(f.packages), freight: Number(f.freight), ewb: o.total > 50000 ? f.ewb || undefined : undefined }
      : { ship, mode, ...f, packages: Number(f.packages), freight: Number(f.freight), ewb: f.ewb || undefined };
    try {
      const r = await post<{ invoiceNo: string; total: number; full: boolean; dispatchId: string }>(`/api/orders/${o.id}/dispatch`, body);
      toast(r.full ? `Dispatched · invoice ${r.invoiceNo} posted for ${money2(r.total)}` : `Partially dispatched · invoice ${r.invoiceNo} for shipped quantity only, backorder stays reserved`, "s");
      closeModal(); refresh("/api/");
      // The last step of sending goods is telling the firm they are coming.
      setTimeout(() => openModal(<ShareDispatchModal orderId={o.id} dispatchId={r.dispatchId} />, "n"), 300);
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  const tab = (k: "TRANSPORT" | "BUS", label: string) => <button type="button" className={"b b-s " + (mode === k ? "b-p" : "b-o")} onClick={() => setMode(k)}>{label}</button>;

  return <ModalFrame title={"Dispatch — " + o.id} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={busy} onClick={go}>Confirm dispatch</button></>}>
    <Note style={{ marginBottom: 13 }}>Enter the quantity actually shipped per line. Anything short creates a <b>backorder</b> that stays reserved — the invoice is raised only for what leaves the godown.</Note>
    <table className="dg" style={{ marginBottom: 14 }}><thead><tr><th>Item</th><th className="n">Ordered</th><th className="n">Already shipped</th><th className="n">Ship now</th></tr></thead><tbody>{o.lines.map((l) => <tr key={l.id} style={{ cursor: "default" }}><td className="w">{l.item.sku}<div className="sm">{l.item.name}</div></td><td className="n tab">{num(l.qty)}</td><td className="n tab">{num(l.shipped)}</td><td className="n"><input type="number" value={ship[l.itemId]} min={0} max={l.qty - l.shipped} onChange={(e) => setShip({ ...ship, [l.itemId]: Number(e.target.value) || 0 })} style={{ width: 92, height: 29, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} /></td></tr>)}</tbody></table>

    <div className="st">How it is going</div>
    <div style={{ display: "flex", gap: 7, margin: "7px 0 11px" }}>{tab("TRANSPORT", "Transport company")}{tab("BUS", "By bus")}</div>

    {mode === "TRANSPORT"
      ? <div className="fg"><Field label="Transporter"><input value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })} /></Field><Field label="LR number"><input value={f.lr} onChange={(e) => setF({ ...f, lr: e.target.value })} /></Field><Field label="Tracking"><input value={f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.value })} /></Field><Field label="Packages"><input type="number" value={f.packages} onChange={(e) => setF({ ...f, packages: Number(e.target.value) })} /></Field><Field label="Freight (₹)"><input type="number" value={f.freight} onChange={(e) => setF({ ...f, freight: Number(e.target.value) })} /></Field><Field label="E-way bill"><input value={o.total > 50000 ? f.ewb : "Not required (< ₹50,000)"} disabled={o.total <= 50000} onChange={(e) => setF({ ...f, ewb: e.target.value })} /></Field></div>
      : <>
        <Note style={{ marginBottom: 11 }}>There is no LR on a bus and nobody to chase, so the bus number, the driver&apos;s phone and a photograph of the bundle on board are the consignment note. They go to the firm in one message as soon as this is saved.</Note>
        <div className="fg">
          <Field label="Bus number *" hint="As painted on the bus — RJ 07 PA 4412"><input value={bus.busNo} onChange={(e) => setBus({ ...bus, busNo: e.target.value.toUpperCase() })} placeholder="RJ 07 PA 4412" /></Field>
          <Field label="Driver / conductor phone *" hint="The customer rings this to collect"><input value={bus.driverPhone} onChange={(e) => setBus({ ...bus, driverPhone: e.target.value })} placeholder="98290 00000" inputMode="numeric" /></Field>
          <Field label="Bus operator / route"><input value={bus.operator} onChange={(e) => setBus({ ...bus, operator: e.target.value })} placeholder="e.g. Jodhpur–Bikaner evening" /></Field>
          <Field label="Loaded at"><input type="datetime-local" value={bus.loadedAt} onChange={(e) => setBus({ ...bus, loadedAt: e.target.value })} /></Field>
          <Field label="Packages"><input type="number" value={f.packages} onChange={(e) => setF({ ...f, packages: Number(e.target.value) })} /></Field>
          <Field label="Freight (₹)"><input type="number" value={f.freight} onChange={(e) => setF({ ...f, freight: Number(e.target.value) })} /></Field>
        </div>
        <div className="st" style={{ marginTop: 13 }}>Photographs of the loaded bundle</div>
        <div className="sm" style={{ marginBottom: 8 }}>Two: one of the bundle on the bus, one close enough to read the bus number. This is the only proof of handover a bus consignment has.</div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
          {photos.map((src, i) => <div key={i} style={{ position: "relative" }}>
            <img src={src} alt={`Loaded bundle ${i + 1}`} style={{ width: 118, height: 88, objectFit: "cover", borderRadius: 6, border: "1px solid var(--bd)" }} />
            <button className="b b-g b-s" style={{ position: "absolute", top: 3, right: 3 }} onClick={() => setPhotos((p) => p.filter((_, n) => n !== i))} title="Remove"><Icon n="x" s={10} /></button>
          </div>)}
          {photos.length < 2 && <label className="b b-o b-s" style={{ cursor: "pointer" }}>
            + Add photo ({photos.length}/2)
            <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { addPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          </label>}
        </div>
      </>}
  </ModalFrame>;
}

// Indian numbers are stored with and without the country code; wa.me wants it.
const waDigits = (phone: string) => { const d = phone.replace(/\D/g, ""); return d.length === 10 ? "91" + d : d.replace(/^0+/, ""); };

interface DispatchRow {
  id: string; mode: "TRANSPORT" | "BUS"; transporter: string; lr: string; tracking: string; packages: number; freight: number;
  busNo: string; driverPhone: string; loadedAt: string | null; photos: string[]; invoiceNo: string | null; at: string; by: string;
  sentCount: number; lastSent: { at: string; by: string; toName: string; toPhone: string } | null;
}
interface DispatchBundle {
  id: string;
  customer: { id: string; name: string; phone: string; tehsil: string; contacts: { id: string; name: string; role: string; phone: string; billsTo: boolean }[] };
  dispatches: DispatchRow[];
  invoices: { no: string; total: number }[];
  company: { name: string };
  whatsappFrom?: string;
}

// "The goods have gone, here is how to collect them."
//
// Everything the firm needs is already recorded by the time the consignment is
// saved, so the message writes itself — and it is handed to WhatsApp
// ready-addressed rather than sent on the firm's behalf. A person presses send,
// the same rule the bill follows.
export function ShareDispatchModal({ orderId, dispatchId }: { orderId: string; dispatchId?: string }) {
  const { closeModal, toast } = useUI();
  const { data } = useApi<DispatchBundle>(`/api/orders/${orderId}/dispatches`);
  const [sel, setSel] = useState("");
  const [note, setNote] = useState("");

  if (!data) return <ModalFrame title="Dispatch details" onClose={closeModal} actions={<button className="b b-p" onClick={closeModal}>Close</button>}><div className="sm">Loading…</div></ModalFrame>;

  const d = data.dispatches.find((x) => x.id === dispatchId) ?? data.dispatches[data.dispatches.length - 1];
  if (!d) return <ModalFrame title="Dispatch details" onClose={closeModal} actions={<button className="b b-p" onClick={closeModal}>Close</button>}>
    <Note k="w">Nothing has been dispatched on this order yet.</Note>
  </ModalFrame>;

  // Whoever the firm marked for bills comes first — it is the number that
  // actually gets read — but any of its numbers can take this.
  const contacts = [...data.customer.contacts].sort((a, b) => Number(!!b.billsTo) - Number(!!a.billsTo));
  const c = contacts.find((x) => x.id === sel) ?? contacts[0] ?? null;
  const inv = data.invoices.find((i) => i.no === d.invoiceNo);

  const text = [
    `${data.customer.name} — order ${orderId} dispatched`,
    d.mode === "BUS"
      ? `Sent by bus${d.transporter && d.transporter !== "By bus" ? ` (${d.transporter})` : ""}`
      : `Sent by ${d.transporter}`,
    d.mode === "BUS" ? `Bus no: ${d.busNo}` : `LR no: ${d.lr}`,
    d.mode === "BUS" ? `Driver / conductor: ${d.driverPhone}` : d.tracking ? `Tracking: ${d.tracking}` : "",
    d.mode === "BUS" && d.loadedAt ? `Loaded at: ${fDT(d.loadedAt)}` : "",
    `Packages: ${num(d.packages)}`,
    inv ? `Invoice ${inv.no} — Rs ${money2(inv.total)}` : "",
    d.photos.length ? `Photo of the loaded bundle: ${d.photos[0]}` : "",
    note.trim(),
    `— ${data.company.name}`,
  ].filter(Boolean).join("\n");

  const send = () => {
    if (!c) return;
    window.open(`https://wa.me/${waDigits(c.phone)}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    post(`/api/orders/${orderId}/dispatch/${d.id}/share`, { channel: "WHATSAPP", toName: `${c.role} — ${c.name}`, toPhone: c.phone })
      .then(() => refresh(`/api/orders/${orderId}`))
      .catch(() => { /* the message still opened; the record is not worth blocking on */ });
    toast(`WhatsApp opened for ${c.name} · ${c.phone}`, "s");
    closeModal();
  };

  return <ModalFrame title={`Send dispatch details — ${data.customer.name}`} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Not now</button><button className="b b-p" disabled={!c} onClick={send}>Open WhatsApp</button></>}>
    {d.sentCount ? <Note style={{ marginBottom: 11 }}>
      Already sent {d.sentCount === 1 ? "once" : `${d.sentCount} times`}{d.lastSent ? <> — last on {fDate(d.lastSent.at)} to {d.lastSent.toName || d.lastSent.toPhone}, by {d.lastSent.by}</> : null}. Sending again is a reminder.
    </Note> : null}
    {!contacts.length
      ? <Note k="w">This firm has no phone numbers on record. Add them from the customer screen — Edit → Numbers &amp; staff — and the dispatch can then be sent to any of them.</Note>
      : <Field label="Send to" full hint="The firm marks which of its numbers takes bills; that one comes first">
        <select value={c?.id ?? ""} onChange={(e) => setSel(e.target.value)}>
          {contacts.map((x) => <option key={x.id} value={x.id}>{x.role} — {x.name} · {x.phone}{x.billsTo ? " · bills" : ""}</option>)}
        </select>
      </Field>}
    <Field label="Add a line (optional)" full><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please collect by tomorrow evening" /></Field>
    <div className="sm" style={{ whiteSpace: "pre-wrap", border: "1px solid var(--bd)", borderRadius: 5, padding: "9px 11px", marginTop: 4 }}>{text}</div>
    {d.photos.length ? <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      {d.photos.map((src, i) => <img key={i} src={src} alt={`Loaded bundle ${i + 1}`} style={{ width: 110, height: 82, objectFit: "cover", borderRadius: 6, border: "1px solid var(--bd)" }} />)}
    </div> : null}
    <Note style={{ marginTop: 11 }}>
      {data.whatsappFrom ? <>Send from the office WhatsApp number <b>{data.whatsappFrom}</b>.</> : <>Sends from whichever WhatsApp account is signed in on this machine.</>}
      {" "}The message opens ready-addressed — you press send. The photographs go as links; attach the pictures themselves in WhatsApp if the firm wants them inline.
    </Note>
  </ModalFrame>;
}
export type { Invoice, OrderStatus };
