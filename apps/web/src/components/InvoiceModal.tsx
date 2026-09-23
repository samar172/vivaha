"use client";
import { money2, num, fDate, fDT } from "@vivaha/shared";
import { useState } from "react";
import { useApi, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { ModalFrame, Field, Note, Num } from "./ui";
import { Icon } from "./icons";
import type { Invoice } from "./types";

interface BillContact { id: string; name: string; role: string; phone: string; billsTo?: boolean }

// WhatsApp only ever reaches a number someone chose. The firm is on several —
// the owner, the office, accounts — and the bill goes to whichever of them
// actually handles bills, so the number is picked here rather than assumed
// from the one field on the customer record.
//
// The link hands the ready-addressed message to WhatsApp on the operator's
// machine; they press send. That is deliberate: nothing is dispatched on the
// firm's behalf without a person seeing it go.
const waDigits = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  // Indian numbers are stored with and without the country code; wa.me wants it.
  return d.length === 10 ? "91" + d : d.replace(/^0+/, "");
};

function ShareBillModal({ inv, contacts: all, whatsappFrom, firm }: { inv: Invoice & { customer: { name: string; phone?: string }; sentCount?: number; lastSent?: { at: string; by: string; toName: string; toPhone: string } | null }; contacts: BillContact[]; whatsappFrom?: string; firm: string }) {
  const { closeModal, toast } = useUI();
  // The firm says which of its numbers takes the bills. Those come first and
  // one of them is selected, so the common case is press-and-send; the rest are
  // still in the list for the times it has to go somewhere else.
  const contacts = [...all].sort((a, b) => Number(!!b.billsTo) - Number(!!a.billsTo));
  const [sel, setSel] = useState(contacts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const c = contacts.find((x) => x.id === sel);

  if (!contacts.length) return <ModalFrame title="Share bill" onClose={closeModal} actions={<button className="b b-p" onClick={closeModal}>Close</button>}>
    <Note k="w">This firm has no phone numbers on record. Add them from the customer screen — Edit → Numbers &amp; staff — and the bill can then be shared to any of them.</Note>
  </ModalFrame>;

  const text = [
    `${inv.customer.name} — Tax Invoice ${inv.no}`,
    `Amount: Rs ${money2(inv.total)}`,
    `Date: ${fDate(inv.date)}`,
    note.trim(),
    `— ${firm}`,
  ].filter(Boolean).join("\n");

  const send = () => {
    if (!c) return;
    window.open(`https://wa.me/${waDigits(c.phone)}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    // Recorded as sent from here, to this number — which is what we actually
    // know. WhatsApp's own delivery is not visible to us and is not claimed.
    post(`/api/ledger/invoices/${encodeURIComponent(inv.no)}/share`, { channel: "WHATSAPP", toName: `${c.role} — ${c.name}`, toPhone: c.phone })
      .then(() => refresh("/api/ledger"))
      .catch(() => { /* the message still opened; the record is not worth blocking on */ });
    toast(`WhatsApp opened for ${c.name} · ${c.phone}`, "s");
    closeModal();
  };

  return <ModalFrame title={"Share bill " + inv.no} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={send}>Open WhatsApp</button></>}>
    {inv.sentCount ? <Note style={{ marginBottom: 11 }}>
      Already sent {inv.sentCount === 1 ? "once" : `${inv.sentCount} times`}{inv.lastSent ? <> — last on {fDate(inv.lastSent.at)} to {inv.lastSent.toName || inv.lastSent.toPhone}, by {inv.lastSent.by}</> : null}. Sending again is a reminder.
    </Note> : null}
    <Field label="Send to" full hint="The firm marks which of its numbers takes bills">
      <select value={sel} onChange={(e) => setSel(e.target.value)}>
        {contacts.map((x) => <option key={x.id} value={x.id}>{x.role} — {x.name} · {x.phone}{x.billsTo ? " · bills" : ""}</option>)}
      </select>
    </Field>
    <Field label="Add a line (optional)" full><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Kindly clear by the 10th" /></Field>
    <div className="sm" style={{ whiteSpace: "pre-wrap", border: "1px solid var(--bd)", borderRadius: 5, padding: "9px 11px", marginTop: 4 }}>{text}</div>
    <Note style={{ marginTop: 11 }}>
      {whatsappFrom ? <>Send from the office WhatsApp number <b>{whatsappFrom}</b>.</> : <>Sends from whichever WhatsApp account is signed in on this machine. Set the office number under Settings to standardise it.</>}
      {" "}The message opens ready-addressed — you press send.
    </Note>
  </ModalFrame>;
}

// Correcting a bill that has already been raised.
//
// Not an edit box over a tax invoice. The number stays, what it said before is
// kept, and the ledger is put right with a fresh entry — so this screen shows
// the difference it is about to make before it makes it, and will not submit
// without a reason. The quantity ceiling is what actually left the godown,
// which is the one thing a bill has to agree with.
type AmendInvoice = Invoice & { customer: { name: string; gstin: string | null } };
function AmendBillModal({ inv, orderId }: { inv: AmendInvoice; orderId: string }) {
  const { closeModal, toast } = useUI();
  const [rows, setRows] = useState(() => inv.lines.map((l) => ({ id: l.id, sku: l.sku, ref: l.ref ?? l.sku, itemName: l.itemName, gstPct: l.gstPct, job: !!l.jobId, shipped: l.jobId ? Number.MAX_SAFE_INTEGER : l.shipped ?? l.qty, wasQty: l.qty, wasRate: l.rate, qty: l.qty, rate: l.rate })));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  // The same arithmetic the server will do, so the operator sees the number
  // before committing to it. The server's answer is still the one that counts.
  const intra = !inv.customer.gstin || inv.customer.gstin.slice(0, 2) === "08";
  const taxable = rows.reduce((s2, r) => s2 + Number(r.qty) * Number(r.rate), 0);
  const tax = rows.reduce((s2, r) => s2 + (Number(r.qty) * Number(r.rate) * r.gstPct) / 100, 0);
  const total = Math.round((taxable + tax) * 100) / 100;
  const delta = Math.round((total - inv.total) * 100) / 100;
  const changed = rows.filter((r) => Number(r.qty) !== r.wasQty || Number(r.rate) !== r.wasRate);
  const over = rows.filter((r) => Number(r.qty) > r.shipped);
  const qtyMoved = changed.some((r) => Number(r.qty) !== r.wasQty);

  const go = async () => {
    if (over.length) return toast(`${over[0].sku}: only ${num(over[0].shipped)} left the godown — a bill cannot say more went out than did`, "e");
    if (!changed.length) return toast("Nothing is different yet", "e");
    if (reason.trim().length < 4) return toast("Say why the bill is being corrected — it goes on the record", "e");
    setBusy(true);
    try {
      const r = await post<{ oldTotal: number; total: number; delta: number }>(`/api/ledger/invoices/${encodeURIComponent(inv.no)}/amend`, {
        lines: rows.map((x) => ({ id: x.id, qty: Number(x.qty), rate: Number(x.rate) })),
        reason: reason.trim(),
      });
      toast(r.delta === 0
        ? `${inv.no} corrected — the total is unchanged at ${money2(r.total)}`
        : `${inv.no} corrected — ${money2(r.oldTotal)} → ${money2(r.total)}, ${r.delta > 0 ? "a further" : "a credit of"} ${money2(Math.abs(r.delta))} on the ledger`, "s");
      closeModal(); refresh("/api/");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <ModalFrame title={"Correct bill " + inv.no} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={busy} onClick={go}>Post the correction</button></>}>
    <Note k="w" style={{ marginBottom: 12 }}>
      This is a tax invoice: the number <b>{inv.no}</b> stays as it is and is never reused. What the bill says now is kept on the record with your name and reason, and the difference is posted to the firm&apos;s ledger as its own entry — the original debit is not rewritten.
    </Note>
    <table className="dg" style={{ marginBottom: 12, fontSize: 13 }}><thead><tr><th>Item</th><th className="n">Shipped</th><th className="n">Billed qty</th><th className="n">Rate</th><th className="n">Amount</th></tr></thead><tbody>
      {rows.map((r, i) => <tr key={r.id} style={{ cursor: "default" }}>
        <td className="w">{r.itemName}<div className="sm">{r.ref}{(Number(r.qty) !== r.wasQty || Number(r.rate) !== r.wasRate) && <> · was {num(r.wasQty)} × {money2(r.wasRate)}</>}</div></td>
        <td className="n tab">{r.job ? <span className="sm">printing</span> : num(r.shipped)}</td>
        <td className="n"><Num min={1} max={r.shipped} value={r.qty} onChange={(val) => set(i, { qty: val || 0 })} style={{ width: 88, height: 28, border: "1px solid " + (Number(r.qty) > r.shipped ? "var(--er)" : "var(--bd)"), borderRadius: 5, padding: "0 7px", textAlign: "right" }} /></td>
        <td className="n"><Num value={r.rate} onChange={(val) => set(i, { rate: val || 0 })} style={{ width: 92, height: 28, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} /></td>
        <td className="n tab">{money2(Number(r.qty) * Number(r.rate))}</td>
      </tr>)}
    </tbody></table>

    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><div style={{ width: 320 }}>
      <div className="df"><span className="k">Taxable</span><span className="v m">{money2(taxable)}</span></div>
      <div className="df"><span className="k">{intra ? "CGST + SGST" : "IGST"}</span><span className="v m">{money2(tax)}</span></div>
      <div className="df" style={{ borderTop: "1px solid var(--bd)", marginTop: 6, paddingTop: 7 }}><span className="k"><b>New total</b></span><span className="v m" style={{ fontWeight: 700, fontSize: 15.5 }}>{money2(total)}</span></div>
      <div className="df"><span className="k">Was</span><span className="v m">{money2(inv.total)}</span></div>
      <div className="df"><span className="k"><b>{delta === 0 ? "No change" : delta > 0 ? "Further debit to the firm" : "Credit to the firm"}</b></span><span className="v m" style={{ fontWeight: 700, color: delta === 0 ? "var(--t6)" : delta > 0 ? "var(--er)" : "var(--ok)" }}>{money2(Math.abs(delta))}</span></div>
    </div></div>

    {over.length ? <Note k="w" style={{ marginBottom: 11 }}>
      <b>{over[0].sku}</b> is billed for {num(Number(over[0].qty))} but only {num(over[0].shipped)} left the godown on this order. Dispatch the rest first, or reduce the line.
    </Note> : null}
    {qtyMoved ? <Note style={{ marginBottom: 11 }}>
      Changing a billed quantity moves the money, <b>not the stock</b>. The godown still says what it shipped. If the goods came back, raise a return — that is what puts them on the shelf and credits the firm for them.
    </Note> : null}

    <Field label="Why the bill is being corrected (required — it goes on the record)" full>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rate agreed at ₹54 on the phone, billed at the list rate by mistake" />
    </Field>
    {inv.amendments?.length ? <div className="sm" style={{ marginTop: 9 }}>
      Corrected {inv.amendments.length === 1 ? "once" : `${inv.amendments.length} times`} already — last by {inv.amendments[0].by} on {fDate(inv.amendments[0].at)}: {inv.amendments[0].reason}
    </div> : null}
    <div className="sm" style={{ marginTop: 6 }}>Order {orderId}. A line cannot be taken off a bill here; for goods that should not have been billed at all, raise a return.</div>
  </ModalFrame>;
}

export function InvoiceModal({ no, orderId }: { no: string; orderId: string }) {
  const { closeModal, openModal } = useUI(); const { can } = useAuth();
  const { data: inv } = useApi<Invoice & { customer: { name: string; address: string; tehsil: string; gstin: string | null; phone: string; contacts: BillContact[] }; company: { name: string; address: string; gstin: string; state: string }; whatsappFrom?: string }>(`/api/orders/${orderId}/invoice/${encodeURIComponent(no)}`);
  if (!inv) return <ModalFrame title={"Tax Invoice " + no} onClose={closeModal} actions={null}><div className="sm">Loading…</div></ModalFrame>;
  const c = inv.customer, intra = !c.gstin || c.gstin.slice(0, 2) === inv.company.state;
  return <ModalFrame title={"Tax Invoice " + inv.no} onClose={closeModal} actions={<><button className="b b-o" onClick={() => openModal(<ShareBillModal inv={inv} contacts={c.contacts ?? []} whatsappFrom={inv.whatsappFrom} firm={inv.company.name} />, "n")}><Icon n="swap" s={13} /> Share on WhatsApp</button>{can("invoice.amend") && inv.status === "Posted" && <button className="b b-o" onClick={() => openModal(<AmendBillModal inv={inv} orderId={orderId} />, "w")}><Icon n="sliders" s={13} /> Edit bill</button>}<button className="b b-o" onClick={() => window.print()}>Print</button><button className="b b-p" onClick={closeModal}>Done</button></>}>
    <div style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, borderBottom: "1px solid var(--bd)", paddingBottom: 11, marginBottom: 11 }}><div><div style={{ fontSize: 15.5, fontWeight: 700 }}>{inv.company.name}</div><div className="sm" style={{ fontFamily: "inherit" }}>{inv.company.address}</div><div className="sm">GSTIN {inv.company.gstin} · State code {inv.company.state}</div></div><div style={{ textAlign: "right" }}><div className="sm">TAX INVOICE</div><div style={{ fontSize: 14.5, fontWeight: 700 }} className="tab">{inv.no}</div><div className="sm">{fDate(inv.date)}</div></div></div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 12 }}><div><div className="sm">BILL TO</div><div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div><div className="sm" style={{ fontFamily: "inherit" }}>{c.address}, {c.tehsil}, Rajasthan</div><div className="sm">GSTIN {c.gstin ?? "Unregistered"}</div></div><div style={{ textAlign: "right" }}><div className="sm">PLACE OF SUPPLY</div><div style={{ fontSize: 14, fontWeight: 600 }}>{intra ? "08 — Rajasthan (intra-state)" : "Inter-state"}</div><div className="sm">Order {orderId}</div></div></div>
      <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Description</th><th>HSN</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Taxable</th><th className="n">GST</th></tr></thead><tbody>{inv.lines.map((l) => <tr key={l.id} style={{ cursor: "default" }}><td className="w">{l.itemName}<div className="sm">{l.ref ?? l.sku}{l.jobId ? <span className="bd b-nu" style={{ marginLeft: 5 }}>printing</span> : null}</div></td><td className="sm">{l.hsn}</td><td className="n tab">{num(l.qty)}</td><td className="n tab">{money2(l.rate)}</td><td className="n tab">{money2(l.amount)}</td><td className="n tab">{l.gstPct}%</td></tr>)}</tbody></table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><div style={{ width: 290 }}>{inv.blocks.map((b, i) => <div key={i}><div className="df"><span className="k">Taxable @ {b.gstPct}%</span><span className="v m">{money2(b.taxable)}</span></div>{b.inter ? <div className="df"><span className="k">IGST {b.gstPct}%</span><span className="v m">{money2(b.igst)}</span></div> : <><div className="df"><span className="k">CGST {b.gstPct / 2}%</span><span className="v m">{money2(b.cgst)}</span></div><div className="df"><span className="k">SGST {b.gstPct / 2}%</span><span className="v m">{money2(b.sgst)}</span></div></>}</div>)}<div className="df" style={{ borderTop: "1px solid var(--bd)", marginTop: 6, paddingTop: 8 }}><span className="k"><b>Invoice total</b></span><span className="v m" style={{ fontWeight: 700, fontSize: 15.5 }}>{money2(inv.total)}</span></div></div></div>
      {inv.amendments?.length ? <div className="sm" style={{ marginTop: 12, paddingTop: 9, borderTop: "1px solid var(--bd-soft)", fontFamily: "inherit" }}>
        {/* On the bill itself, not tucked away in the audit log: a customer
            holding an earlier copy is entitled to know this one differs. */}
        <b>Corrected {inv.amendments.length === 1 ? "once" : `${inv.amendments.length} times`}.</b>
        {inv.amendments.map((a) => <div key={a.id} style={{ marginTop: 3 }}>
          {fDT(a.at)} · {a.by} · {money2(a.oldTotal)} → {money2(a.newTotal)} — {a.reason}
          {a.detail?.length ? <span> ({a.detail.map((d) => `${d.sku} ${num(d.was.qty)}×${money2(d.was.rate)} → ${num(d.now.qty)}×${money2(d.now.rate)}`).join("; ")})</span> : null}
        </div>)}
      </div> : null}
      <div className="sm" style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--bd-soft)", fontFamily: "inherit" }}>Rate-wise tax summary above feeds the GSTR-1 export. Certified that the particulars given are true and correct.</div>
    </div>
  </ModalFrame>;
}
