"use client";
import { money2, num, fDate } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useUI } from "@/lib/ui";
import { ModalFrame } from "./ui";
import type { Invoice } from "./types";

export function InvoiceModal({ no, orderId }: { no: string; orderId: string }) {
  const { closeModal, toast } = useUI();
  const { data: inv } = useApi<Invoice & { customer: { name: string; address: string; tehsil: string; gstin: string | null }; company: { name: string; address: string; gstin: string; state: string } }>(`/api/orders/${orderId}/invoice/${encodeURIComponent(no)}`);
  if (!inv) return <ModalFrame title={"Tax Invoice " + no} onClose={closeModal} actions={null}><div className="sm">Loading…</div></ModalFrame>;
  const c = inv.customer, intra = !c.gstin || c.gstin.slice(0, 2) === inv.company.state;
  return <ModalFrame title={"Tax Invoice " + inv.no} onClose={closeModal} actions={<><button className="b b-o" onClick={() => toast(`Sent to ${c.name} on WhatsApp`, "s")}>Send on WhatsApp</button><button className="b b-o" onClick={() => window.print()}>Print</button><button className="b b-p" onClick={closeModal}>Done</button></>}>
    <div style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, borderBottom: "1px solid var(--bd)", paddingBottom: 11, marginBottom: 11 }}><div><div style={{ fontSize: 14, fontWeight: 700 }}>{inv.company.name}</div><div className="sm" style={{ fontFamily: "inherit" }}>{inv.company.address}</div><div className="sm">GSTIN {inv.company.gstin} · State code {inv.company.state}</div></div><div style={{ textAlign: "right" }}><div className="sm">TAX INVOICE</div><div style={{ fontSize: 13, fontWeight: 700 }} className="tab">{inv.no}</div><div className="sm">{fDate(inv.date)}</div></div></div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 12 }}><div><div className="sm">BILL TO</div><div style={{ fontWeight: 700, fontSize: 12.5 }}>{c.name}</div><div className="sm" style={{ fontFamily: "inherit" }}>{c.address}, {c.tehsil}, Rajasthan</div><div className="sm">GSTIN {c.gstin ?? "Unregistered"}</div></div><div style={{ textAlign: "right" }}><div className="sm">PLACE OF SUPPLY</div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{intra ? "08 — Rajasthan (intra-state)" : "Inter-state"}</div><div className="sm">Order {orderId}</div></div></div>
      <table className="dg" style={{ fontSize: 11.5 }}><thead><tr><th>Description</th><th>HSN</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Taxable</th><th className="n">GST</th></tr></thead><tbody>{inv.lines.map((l) => <tr key={l.id} style={{ cursor: "default" }}><td className="w">{l.itemName}<div className="sm">{l.sku}</div></td><td className="sm">{l.hsn}</td><td className="n tab">{num(l.qty)}</td><td className="n tab">{money2(l.rate)}</td><td className="n tab">{money2(l.amount)}</td><td className="n tab">{l.gstPct}%</td></tr>)}</tbody></table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><div style={{ width: 290 }}>{inv.blocks.map((b, i) => <div key={i}><div className="df"><span className="k">Taxable @ {b.gstPct}%</span><span className="v m">{money2(b.taxable)}</span></div>{b.inter ? <div className="df"><span className="k">IGST {b.gstPct}%</span><span className="v m">{money2(b.igst)}</span></div> : <><div className="df"><span className="k">CGST {b.gstPct / 2}%</span><span className="v m">{money2(b.cgst)}</span></div><div className="df"><span className="k">SGST {b.gstPct / 2}%</span><span className="v m">{money2(b.sgst)}</span></div></>}</div>)}<div className="df" style={{ borderTop: "1px solid var(--bd)", marginTop: 6, paddingTop: 8 }}><span className="k"><b>Invoice total</b></span><span className="v m" style={{ fontWeight: 700, fontSize: 14 }}>{money2(inv.total)}</span></div></div></div>
      <div className="sm" style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--bd-soft)", fontFamily: "inherit" }}>Rate-wise tax summary above feeds the GSTR-1 export. Certified that the particulars given are true and correct.</div>
    </div>
  </ModalFrame>;
}
