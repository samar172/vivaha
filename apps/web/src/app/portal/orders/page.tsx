"use client";
import { useState } from "react";
import { money2, num, fDT, fDate } from "@vivaha/shared";
import { useApi, refresh } from "@/lib/hooks";
import { useUI } from "@/lib/ui";
import { post } from "@/lib/api";
import { Sect } from "@/components/portal/Bits";
import { Hold, ModalFrame, Field, Note } from "@/components/ui";

interface PO { id: string; status: string; statusHi: string; createdAt: string; total: number; holdUntil: string | null; lines: { name: string; sku: string; qty: number; shipped: number }[]; backorder: number; dispatch: { lr: string; transporter: string } | null; invoiceNo: string | null; lastWhy: string }
const CLS: Record<string, string> = { BOOKED: "b-wa", APPROVED: "b-ok", RESERVED: "b-in", ALLOCATED: "b-in", PICKING: "b-wa", PICKED: "b-in", PACKED: "b-in", READY_TO_DISPATCH: "b-wa", DISPATCHED: "b-in", PARTIALLY_DISPATCHED: "b-wa", DELIVERED: "b-ok", LAPSED: "b-er", REJECTED: "b-er", CANCELLED: "b-er" };
export default function POrders() {
  const { data, mutate } = useApi<PO[]>("/api/portal/orders", { refreshInterval: 15000 }); const { openModal } = useUI();
  return <><Sect t="मेरे ऑर्डर" />{data && !data.length && <div className="blk" style={{ textAlign: "center", padding: 36 }}><div className="hi" style={{ fontWeight: 600 }}>अभी कोई ऑर्डर नहीं</div><div className="sm hi" style={{ marginTop: 5 }}>कार्ड स्कैन करके बुकिंग शुरू करें</div></div>}
    {data?.map((o) => <div className="ordc" key={o.id}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><b className="tab" style={{ fontSize: 13 }}>{o.id}</b><span className="sm">{fDT(o.createdAt)}</span><span className={"bd hi " + (CLS[o.status] || "b-nu")} style={{ marginLeft: "auto" }}>{o.statusHi}</span></div>
      <div style={{ fontSize: 12.5, color: "var(--t6)", marginTop: 6 }}>{o.lines.map((l) => `${l.name} × ${num(l.qty)}`).join(" · ")}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}><b className="tab" style={{ fontSize: 14 }}>{money2(o.total)}</b>{o.holdUntil && <span className="hi" style={{ fontSize: 11.5, color: "var(--wa)", fontWeight: 600 }}>⏳ बाकी <Hold until={o.holdUntil} onExpire={() => setTimeout(() => mutate(), 16000)} /></span>}{o.dispatch && <span className="sm">LR {o.dispatch.lr} · {o.dispatch.transporter}</span>}{o.status === "PARTIALLY_DISPATCHED" && <span className="bd b-wa hi">{num(o.backorder)} बाकी</span>}{o.invoiceNo && <button className="b b-g b-s" style={{ marginLeft: "auto", color: "var(--ac)" }} onClick={() => openModal(<PInvoice no={o.invoiceNo!} />, "w")}>बिल देखें</button>}{o.status === "DELIVERED" && <button className="b b-o b-s hi" onClick={() => openModal(<PReturn o={o} />)}>वापसी</button>}</div>
      {(o.status === "REJECTED" || o.status === "LAPSED") && <div className="note w hi" style={{ marginTop: 8 }}>{o.lastWhy}</div>}</div>)}</>;
}
function PInvoice({ no }: { no: string }) {
  const { closeModal, toast } = useUI(); const { data: inv } = useApi<{ no: string; date: string; total: number; blocks: { gstPct: number; taxable: number; inter: boolean; igst: number; cgst: number; sgst: number }[]; lines: { id: string; itemName: string; qty: number; rate: number; amount: number; hsn: string }[]; dispatch: { transporter: string; lr: string; tracking: string; packages: number } | null }>(`/api/portal/invoices/${encodeURIComponent(no)}`);
  if (!inv) return <ModalFrame title={no} onClose={closeModal} actions={null}>…</ModalFrame>;
  return <ModalFrame title={inv.no} onClose={closeModal} actions={<><button className="b b-o hi" style={{ flex: 1 }} onClick={() => toast("WhatsApp पर भेजा गया", "s")}>WhatsApp पर भेजें</button><button className="b b-p hi" onClick={closeModal}>ठीक है</button></>}>
    <div className="blk"><div className="lb">Tax invoice</div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 8 }}><div><b>Vivaha Cards</b><div className="sm">GSTIN 08AAQCV7781K1ZR</div></div><div style={{ textAlign: "right" }}><div className="tab">{inv.no}</div><div className="sm">{fDate(inv.date)}</div></div></div>
      <table className="slabs"><tbody>{inv.lines.map((l) => <tr key={l.id}><td>{l.itemName}<div className="sm">{num(l.qty)} × {money2(l.rate)} · HSN {l.hsn}</div></td><td style={{ textAlign: "right" }} className="tab">{money2(l.amount)}</td></tr>)}</tbody></table>
      <div style={{ marginTop: 10 }}>{inv.blocks.map((b, i) => <div key={i}><div className="tot"><span>Taxable @ {b.gstPct}%</span><span className="tab">{money2(b.taxable)}</span></div>{b.inter ? <div className="tot"><span>IGST {b.gstPct}%</span><span className="tab">{money2(b.igst)}</span></div> : <div className="tot"><span>CGST {b.gstPct / 2}% + SGST {b.gstPct / 2}%</span><span className="tab">{money2(b.cgst + b.sgst)}</span></div>}</div>)}<div className="tot g"><span>कुल</span><span className="tab">{money2(inv.total)}</span></div></div></div>
    {inv.dispatch && <div className="blk"><div className="lb">भेजा गया</div>{[["ट्रांसपोर्टर", inv.dispatch.transporter], ["LR नंबर", inv.dispatch.lr], ["ट्रैकिंग", inv.dispatch.tracking], ["पैकेट", inv.dispatch.packages]].map((r) => <div className="tot" key={String(r[0])}><span className="hi">{r[0]}</span><span className="tab">{r[1]}</span></div>)}</div>}
  </ModalFrame>;
}
function PReturn({ o }: { o: PO }) {
  const { closeModal, toast } = useUI();
  const [f, setF] = useState({ idx: 0, qty: 24, reason: "" });
  const go = async () => { if (!f.reason.trim() || f.qty <= 0) return toast("मात्रा और कारण दोनों भरें", "e"); try { const r = await post<{ id: string }>("/api/portal/returns", { orderId: o.id, itemId: await itemIdFor(o, f.idx), qty: Number(f.qty), reason: f.reason, hasPhoto: true }); toast(`वापसी request भेज दी गई — ${r.id}`, "s"); closeModal(); refresh("/api/portal"); } catch (e) { toast(e instanceof Error ? e.message : "Error", "e"); } };
  return <ModalFrame title="माल वापसी" onClose={closeModal} actions={<button className="b b-p hi" style={{ flex: 1, height: 44 }} onClick={go}>वापसी भेजें</button>}>
    <div className="lb">{o.id}</div><Field label="कौन सा आइटम"><select value={f.idx} onChange={(e) => setF({ ...f, idx: Number(e.target.value) })}>{o.lines.map((l, i) => <option key={l.sku} value={i}>{l.name} — {num(l.shipped || l.qty)} भेजे गए</option>)}</select></Field>
    <Field label="कितने वापस"><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field><Field label="कारण"><textarea className="hi" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="जैसे — छपाई में धब्बा, 24 पीस ख़राब" /></Field>
    <button className="b b-o hi" style={{ width: "100%", marginTop: 4, marginBottom: 10 }} onClick={() => toast("फ़ोटो जोड़ी गई", "s")}>📷 फ़ोटो जोड़ें</button>
    <Note><span className="hi">आपकी request ऑफ़िस जाएगी। जाँच के बाद ही तय होगा कि माल अच्छे स्टॉक में जाएगा या ख़राब में, और उसी हिसाब से credit note बनेगा।</span></Note>
  </ModalFrame>;
}
async function itemIdFor(o: PO, idx: number) { const { apiFetch } = await import("@/lib/api"); const inv = await apiFetch<{ lines: { itemId: string; sku: string }[] }>(`/api/portal/invoices/${encodeURIComponent(o.invoiceNo!)}`); return inv.lines.find((l) => l.sku === o.lines[idx].sku)?.itemId ?? inv.lines[idx]?.itemId; }
