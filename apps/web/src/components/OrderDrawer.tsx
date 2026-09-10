"use client";
import { useState } from "react";
import { money, money2, num, fDate, fDT, dueLbl, daysTo, type OrderStatus } from "@vivaha/shared";
import { useApi, useGodowns, useLines, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { Pill, LineChip, DF, Section, DrawerFrame, ModalFrame, Field, Note, Hold, Timeline } from "./ui";
import type { Order, Invoice } from "./types";
import { InvoiceModal } from "./InvoiceModal";
import { Icon } from "./icons";

export function useOrderActions() {
  const { toast, closeModal, closeDrawer, openModal } = useUI(); const { can, user } = useAuth();
  const done = (msg: string, k: "s" | "w" = "s") => { toast(msg, k); closeModal(); closeDrawer(); refresh("/api/"); };
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

export function OrderDrawer({ id }: { id: string }) {
  const { data: o, mutate } = useApi<Order & { company: { name: string } }>(`/api/orders/${id}`); const { closeDrawer, openModal } = useUI(); const { can } = useAuth(); const { data: lines } = useLines();
  const A = useOrderActions();
  if (!o) return <div className="drb"><div className="sm">Loading…</div></div>;
  const c = o.customer, g = o.gate; const groups: Record<string, typeof o.lines> = {}; o.lines.forEach((l) => (groups[l.lineId] = groups[l.lineId] || []).push(l));
  const blocks = (() => { const inv = o.invoices; if (inv.length) return null; return null; })();
  void blocks;
  return <DrawerFrame onClose={closeDrawer} head={<><span className="rid" style={{ fontSize: 14.5 }}>{o.id}</span><Pill s={o.status} /></>}
    actions={<>{A.actionBtn(o, false)}{o.status === "BOOKED" && can("order.approve") && <button className="b b-d b-s" onClick={() => A.reject(o)}>Reject</button>}{["RESERVED", "ALLOCATED"].includes(o.status) && can("order.allocate") && <button className="b b-o b-s" onClick={() => A.allocate(o)}>Re-allocate</button>}{["APPROVED", "RESERVED", "ALLOCATED"].includes(o.status) && can("order.approve") && <button className="b b-g b-s" onClick={() => A.cancel(o)}>Cancel order</button>}{o.invoices.map((i) => <button key={i.no} className="b b-o b-s" onClick={() => openModal(<InvoiceModal no={i.no} orderId={o.id} />, "w")}>Invoice {i.no.split("/").pop()}</button>)}</>}>
    {o.holdUntil && <Section style={{ background: "var(--wa-bg)" }}><div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "var(--wa)", fontWeight: 600 }}>⏳ Hold expires in <span style={{ fontSize: 16.5 }}><Hold until={o.holdUntil} onExpire={() => setTimeout(() => mutate(), 16000)} /></span><span style={{ marginLeft: "auto", fontWeight: 500 }}>then stock releases and an alert is raised</span></div></Section>}
    <Section t="Firm"><DF k="Customer" v={c.name} /><DF k="Booked by" v={o.bookedBy} /><DF k="Tehsil" v={c.tehsil} /><DF k="Required by" v={<span style={{ color: daysTo(o.requiredBy) <= 7 ? "var(--er)" : undefined }}>{fDate(o.requiredBy)} <span className="sm">{dueLbl(o.requiredBy)}</span></span>} /><DF k="Credit position" mono v={<span style={{ color: g.restricted ? "var(--er)" : "var(--ok)" }}>{money(g.out)} / {money(c.creditLimit)}{g.timeBreach ? ` · ${g.oldestAge}d` : ""}</span>} /></Section>
    {Object.keys(groups).map((lid) => <Section key={lid} t={<>{lines?.find((l) => l.id === lid)?.name} · GST {groups[lid][0].gstPct}%</>}><table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Amount</th><th>Godown</th></tr></thead><tbody>{groups[lid].map((l) => <tr key={l.id} style={{ cursor: "default" }}><td className="w">{l.item.sku}<div className="sm">{l.item.name}</div></td><td className="n tab">{num(l.qty)}{l.shipped > 0 && l.shipped < l.qty && <div className="sm" style={{ color: "var(--wa)" }}>{num(l.shipped)} shipped</div>}</td><td className="n tab">{money(l.rate)}<div className="sm">{l.priceSrc === "override" ? "override" : `slab ${money(l.slabRate)} ×${l.mult}`}</div></td><td className="n tab">{money(l.amount)}</td><td className="sm">{Object.keys(l.alloc).length ? Object.keys(l.alloc).map((gd) => gd.replace("GD-", "") + ":" + num(l.alloc[gd])).join(" ") : "—"}</td></tr>)}</tbody></table></Section>)}
    <Section t="Invoice value"><DF k="Taxable" v={money2(o.subtotal)} mono /><DF k="GST" v={money2(o.tax)} mono /><DF k="Total" v={money2(o.total)} mono strong />{o.invoices.length ? <div className="sm" style={{ marginTop: 6 }}>{o.invoices.map((i) => <span key={i.no}>Tax invoice <b>{i.no}</b> posted {fDate(i.date)} · <a href="#" onClick={(e) => { e.preventDefault(); openModal(<InvoiceModal no={i.no} orderId={o.id} />, "w"); }}>view</a><br /></span>)}</div> : <div className="sm" style={{ marginTop: 6 }}>Invoice is raised on dispatch, for the shipped quantity only.</div>}</Section>
    {o.dispatches.map((d) => <Section key={d.id} t="Dispatch"><DF k="Transporter" v={d.transporter} mono /><DF k="LR number" v={d.lr} mono /><DF k="Tracking" v={d.tracking} mono /><DF k="Packages" v={d.packages} mono /><DF k="Freight" v={money(d.freight)} mono /><DF k="Dispatched" v={fDate(d.at)} mono /></Section>)}
    {o.status === "PARTIALLY_DISPATCHED" && <Note k="w">Backorder open — {num(o.backorder)} units still reserved and dispatchable.</Note>}
    <Section t="History"><Timeline rows={o.events.slice().reverse().map((h) => ({ t: <span className="wo">{h.from ? h.from.replace(/_/g, " ") + " → " : ""}{h.to.replace(/_/g, " ")}</span>, n: `${fDT(h.at)} · ${h.by}${h.why ? " · " + h.why : ""}` }))} /></Section>
  </DrawerFrame>;
}

function GateModal({ o, canOv }: { o: Order; canOv: boolean }) {
  const { closeModal, toast, closeDrawer } = useUI(); const [r, setR] = useState(""); const { user } = useAuth(); const A = useOrderActions();
  const c = o.customer, g = o.gate;
  const go = async () => { if (!r.trim()) return toast("A reason is required to override the credit gate", "e"); try { await post(`/api/orders/${o.id}/approve`, { reason: r }); toast("Approved with override — logged in audit", "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Credit gate — " + c.name} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button>{canOv && <button className="b b-p" onClick={go}>Approve with override</button>}<button className="b b-d" onClick={() => { closeModal(); A.reject(o); }}>Reject order</button></>}>
    <Note k={c.gateMode === "BLOCK" ? "w" : undefined} style={{ marginBottom: 13 }}>{g.amountBreach && <div><b>Amount breached.</b> Outstanding {money(g.out)} + this order {money(o.total)} = {money(g.out + o.total)} against a limit of {money(c.creditLimit)}.</div>}{g.timeBreach && <div style={{ marginTop: 6 }}><b>Credit days exceeded.</b> Oldest unpaid invoice is {g.oldestAge} days old against agreed terms of {c.creditDays} days.</div>}<div style={{ marginTop: 7 }}>Gate mode for this firm is <b>{c.gateMode}</b>.</div></Note>
    {canOv ? <Field label="Reason for proceeding (required, audited)"><textarea value={r} onChange={(e) => setR(e.target.value)} placeholder="e.g. Cheque in hand, clearing Monday — approved by owner" /></Field> : <Note k="w">Your role ({user?.role}) cannot override a BLOCK gate. An Accounts Manager or Super Admin must approve this order.</Note>}
  </ModalFrame>;
}

export function ReasonModal({ title, label, ph, btn, danger, onSubmit, extra }: { title: string; label: string; ph?: string; btn: string; danger?: boolean; onSubmit: (r: string) => void; extra?: React.ReactNode }) {
  const { closeModal, toast } = useUI(); const [r, setR] = useState("");
  return <ModalFrame title={title} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className={"b " + (danger ? "b-d" : "b-p")} onClick={() => r.trim() ? onSubmit(r.trim()) : toast("A reason is required", "e")}>{btn}</button></>}>{extra}<Field label={label}><textarea value={r} onChange={(e) => setR(e.target.value)} placeholder={ph} /></Field></ModalFrame>;
}

function AllocModal({ o }: { o: Order }) {
  const { closeModal, closeDrawer, toast } = useUI(); const { data: godowns } = useGodowns(); const { data: items } = useApi<{ items: { id: string; godowns: { godownId: string; available: number }[] }[] }>("/api/items");
  const [al, setAl] = useState<Record<string, Record<string, number>>>(Object.fromEntries(o.lines.map((l) => [l.itemId, { ...l.alloc }])));
  const sum = (iid: string) => Object.values(al[iid] || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const save = async () => { if (o.lines.some((l) => sum(l.itemId) !== l.qty)) return toast("Every line must allocate to exactly its ordered quantity", "e"); try { await post(`/api/orders/${o.id}/allocate`, { alloc: al }); toast("Allocation saved", "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Godown allocation — " + o.id} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={save}>Confirm allocation</button></>}>
    <Note style={{ marginBottom: 13 }}>Auto-proposed by highest availability. Every line must allocate to exactly its ordered quantity before you can confirm.</Note>
    {o.lines.map((l) => <div key={l.id} style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 10, marginBottom: 9 }}><div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 7 }}>{l.item.sku} — {l.item.name} · need {num(l.qty)} {l.item.uom}</div><div style={{ display: "flex", gap: 8 }}>{godowns?.map((g) => { const av = (items?.items.find((i) => i.id === l.itemId)?.godowns.find((x) => x.godownId === g.id)?.available ?? 0) + (l.alloc[g.id] || 0); return <div key={g.id} style={{ flex: 1 }}><div className="sm" style={{ marginBottom: 3 }}>{g.short} · avail {num(av)}</div><input type="number" value={al[l.itemId]?.[g.id] ?? 0} onChange={(e) => setAl({ ...al, [l.itemId]: { ...al[l.itemId], [g.id]: Number(e.target.value) || 0 } })} style={{ width: "100%", height: 30, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px" }} /></div>; })}</div><div className="sm" style={{ marginTop: 6 }}>{sum(l.itemId) === l.qty ? <span style={{ color: "var(--ok)", fontWeight: 700 }}><Icon n="check" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {num(sum(l.itemId))} / {num(l.qty)} allocated</span> : <span style={{ color: "var(--er)", fontWeight: 700 }}><Icon n="x" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {num(sum(l.itemId))} / {num(l.qty)} — must equal the ordered quantity</span>}</div></div>)}
  </ModalFrame>;
}

function DispatchModal({ o }: { o: Order }) {
  const { closeModal, closeDrawer, toast, openModal } = useUI();
  const [ship, setShip] = useState<Record<string, number>>(Object.fromEntries(o.lines.map((l) => [l.itemId, l.qty - l.shipped])));
  const [f, setF] = useState(() => ({ transporter: "Rajasthan Roadways Cargo", lr: "LR-" + (56000 + Math.floor(Math.random() * 3000)), tracking: "TRK" + (905000 + Math.floor(Math.random() * 9000)), packages: o.lines.length + 1, freight: 650, ewb: o.total > 50000 ? "EWB-" + (721400 + Math.floor(Math.random() * 900)) : "" }));
  const go = async () => { try { const r = await post<{ invoiceNo: string; total: number; full: boolean }>(`/api/orders/${o.id}/dispatch`, { ship, ...f, packages: Number(f.packages), freight: Number(f.freight), ewb: f.ewb || undefined }); toast(r.full ? `Dispatched · invoice ${r.invoiceNo} posted for ${money2(r.total)}` : `Partially dispatched · invoice ${r.invoiceNo} for shipped quantity only, backorder stays reserved`, "s"); closeModal(); closeDrawer(); refresh("/api/"); setTimeout(() => openModal(<InvoiceModal no={r.invoiceNo} orderId={o.id} />, "w"), 300); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Dispatch — " + o.id} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Confirm dispatch</button></>}>
    <Note style={{ marginBottom: 13 }}>Enter the quantity actually shipped per line. Anything short creates a <b>backorder</b> that stays reserved — the invoice is raised only for what leaves the godown.</Note>
    <table className="dg" style={{ marginBottom: 14 }}><thead><tr><th>Item</th><th className="n">Ordered</th><th className="n">Already shipped</th><th className="n">Ship now</th></tr></thead><tbody>{o.lines.map((l) => <tr key={l.id} style={{ cursor: "default" }}><td className="w">{l.item.sku}<div className="sm">{l.item.name}</div></td><td className="n tab">{num(l.qty)}</td><td className="n tab">{num(l.shipped)}</td><td className="n"><input type="number" value={ship[l.itemId]} min={0} max={l.qty - l.shipped} onChange={(e) => setShip({ ...ship, [l.itemId]: Number(e.target.value) || 0 })} style={{ width: 92, height: 29, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} /></td></tr>)}</tbody></table>
    <div className="fg"><Field label="Transporter"><input value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })} /></Field><Field label="LR number"><input value={f.lr} onChange={(e) => setF({ ...f, lr: e.target.value })} /></Field><Field label="Tracking"><input value={f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.value })} /></Field><Field label="Packages"><input type="number" value={f.packages} onChange={(e) => setF({ ...f, packages: Number(e.target.value) })} /></Field><Field label="Freight (₹)"><input type="number" value={f.freight} onChange={(e) => setF({ ...f, freight: Number(e.target.value) })} /></Field><Field label="E-way bill"><input value={o.total > 50000 ? f.ewb : "Not required (< ₹50,000)"} disabled={o.total <= 50000} onChange={(e) => setF({ ...f, ewb: e.target.value })} /></Field></div>
  </ModalFrame>;
}
export type { Invoice, OrderStatus };
