"use client";
import { money2, num, fDate } from "@vivaha/shared";
import { useState } from "react";
import { useApi, refresh } from "@/lib/hooks";
import { useUI } from "@/lib/ui";
import { post } from "@/lib/api";
import { ModalFrame, Field, Note } from "./ui";
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

function ShareBillModal({ inv, contacts: all, whatsappFrom }: { inv: Invoice & { customer: { name: string; phone?: string }; sentCount?: number; lastSent?: { at: string; by: string; toName: string; toPhone: string } | null }; contacts: BillContact[]; whatsappFrom?: string }) {
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
    "— Vivaha Cards",
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

export function InvoiceModal({ no, orderId }: { no: string; orderId: string }) {
  const { closeModal, openModal } = useUI();
  const { data: inv } = useApi<Invoice & { customer: { name: string; address: string; tehsil: string; gstin: string | null; phone: string; contacts: BillContact[] }; company: { name: string; address: string; gstin: string; state: string }; whatsappFrom?: string }>(`/api/orders/${orderId}/invoice/${encodeURIComponent(no)}`);
  if (!inv) return <ModalFrame title={"Tax Invoice " + no} onClose={closeModal} actions={null}><div className="sm">Loading…</div></ModalFrame>;
  const c = inv.customer, intra = !c.gstin || c.gstin.slice(0, 2) === inv.company.state;
  return <ModalFrame title={"Tax Invoice " + inv.no} onClose={closeModal} actions={<><button className="b b-o" onClick={() => openModal(<ShareBillModal inv={inv} contacts={c.contacts ?? []} whatsappFrom={inv.whatsappFrom} />, "n")}><Icon n="swap" s={13} /> Share on WhatsApp</button><button className="b b-o" onClick={() => window.print()}>Print</button><button className="b b-p" onClick={closeModal}>Done</button></>}>
    <div style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, borderBottom: "1px solid var(--bd)", paddingBottom: 11, marginBottom: 11 }}><div><div style={{ fontSize: 15.5, fontWeight: 700 }}>{inv.company.name}</div><div className="sm" style={{ fontFamily: "inherit" }}>{inv.company.address}</div><div className="sm">GSTIN {inv.company.gstin} · State code {inv.company.state}</div></div><div style={{ textAlign: "right" }}><div className="sm">TAX INVOICE</div><div style={{ fontSize: 14.5, fontWeight: 700 }} className="tab">{inv.no}</div><div className="sm">{fDate(inv.date)}</div></div></div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 12 }}><div><div className="sm">BILL TO</div><div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div><div className="sm" style={{ fontFamily: "inherit" }}>{c.address}, {c.tehsil}, Rajasthan</div><div className="sm">GSTIN {c.gstin ?? "Unregistered"}</div></div><div style={{ textAlign: "right" }}><div className="sm">PLACE OF SUPPLY</div><div style={{ fontSize: 14, fontWeight: 600 }}>{intra ? "08 — Rajasthan (intra-state)" : "Inter-state"}</div><div className="sm">Order {orderId}</div></div></div>
      <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Description</th><th>HSN</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Taxable</th><th className="n">GST</th></tr></thead><tbody>{inv.lines.map((l) => <tr key={l.id} style={{ cursor: "default" }}><td className="w">{l.itemName}<div className="sm">{l.sku}</div></td><td className="sm">{l.hsn}</td><td className="n tab">{num(l.qty)}</td><td className="n tab">{money2(l.rate)}</td><td className="n tab">{money2(l.amount)}</td><td className="n tab">{l.gstPct}%</td></tr>)}</tbody></table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><div style={{ width: 290 }}>{inv.blocks.map((b, i) => <div key={i}><div className="df"><span className="k">Taxable @ {b.gstPct}%</span><span className="v m">{money2(b.taxable)}</span></div>{b.inter ? <div className="df"><span className="k">IGST {b.gstPct}%</span><span className="v m">{money2(b.igst)}</span></div> : <><div className="df"><span className="k">CGST {b.gstPct / 2}%</span><span className="v m">{money2(b.cgst)}</span></div><div className="df"><span className="k">SGST {b.gstPct / 2}%</span><span className="v m">{money2(b.sgst)}</span></div></>}</div>)}<div className="df" style={{ borderTop: "1px solid var(--bd)", marginTop: 6, paddingTop: 8 }}><span className="k"><b>Invoice total</b></span><span className="v m" style={{ fontWeight: 700, fontSize: 15.5 }}>{money2(inv.total)}</span></div></div></div>
      <div className="sm" style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--bd-soft)", fontFamily: "inherit" }}>Rate-wise tax summary above feeds the GSTR-1 export. Certified that the particulars given are true and correct.</div>
    </div>
  </ModalFrame>;
}
