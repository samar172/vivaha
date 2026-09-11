"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money, money2, num, fDT, daysTo } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useUI } from "@/lib/ui";
import { post } from "@/lib/api";
import { usePortal, type PItem } from "./PortalContext";
import { LineChip, Hold } from "../ui";
import { thumb } from "@/lib/art";
import { useLang, itemName } from "@/lib/i18n";

interface SheetData { item: PItem; price: { rate: number; src: string; mult: number }; slabs: { fromQty: number; toQty: number; rate: number; customerRate: number }[]; nextSlab: { addQty: number; rate: number; save: number } | null; openBookings: { orderId: string; qty: number; createdAt: string; holdUntil: string | null }[]; alternates: { item: PItem; avail: number; rate: number }[]; short: boolean; available: number }
const BCOL: Record<string, [string, string, string]> = { in: ["var(--ok-bg)", "var(--ok-bd)", "var(--ok)"], ltd: ["var(--wa-bg)", "var(--wa-bd)", "var(--wa)"], low: ["var(--wa-bg)", "var(--wa-bd)", "#D07A2E"], eta: ["var(--nu-bg)", "var(--nu-bd)", "var(--t6)"], out: ["var(--er-bg)", "var(--er-bd)", "var(--er)"], svc: ["var(--nu-bg)", "var(--nu-bd)", "var(--t6)"] };

export function SheetOverlay() {
  const P = usePortal();
  return <div className={"sheet" + (P.sheet || P.cartOpen ? " on" : "")}><div className="bkd" onClick={P.closeSheet} /><div className="pan">{P.sheet ? <ItemSheet id={P.sheet} /> : P.cartOpen ? <CartSheet /> : null}</div></div>;
}

function ItemSheet({ id }: { id: string }) {
  const P = usePortal(); const { toast } = useUI(); const { lang, t } = useLang();
  const [q, setQ] = useState(0); const [init, setInit] = useState(false);
  const { data } = useApi<SheetData>(`/api/portal/items/${id}?qty=${q}`);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (data && !init) { setQ(P.sheetQty || data.item.moq); setInit(true); } }, [data, init, P.sheetQty]);
  const [req, setReq] = useState(() => new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  if (!data) return <div className="shb"><div className="sm">Loading…</div></div>;
  const it = data.item, b = it.band, pr = data.price, short = data.short, col = BCOL[b.k];
  const book = async () => { const qq = Math.min(q, b.qty); if (qq < it.moq) return toast(`कम से कम ${num(it.moq)} ${it.uom.toLowerCase()} लेने होंगे`, "e"); if (await P.addLine(it.id, qq)) { toast(`${num(qq)} ${it.uom.toLowerCase()} कार्ट में जोड़े गए`, "s"); P.openCart(); } };
  const split = async (alt: PItem, qa: number, qb: number) => { if (await P.addLine(it.id, qa) && await P.addLine(alt.id, qb)) { toast("दोनों कार्ट में जोड़े गए", "s"); P.openCart(); } };
  return <>
    <div className="shh"><button className="b b-g b-s" onClick={P.closeSheet}>←</button><span className="rid" style={{ fontSize: 14.5 }}>{it.designNo || it.sku}</span><LineChip id={it.lineId} /><button className="b b-g b-s" style={{ marginLeft: "auto" }} onClick={P.closeSheet}>✕</button></div>
    <div className="shb">
      <div className="blk" style={{ padding: 0, overflow: "hidden" }}><img className="cw" src={thumb(it, 660, 330)} alt="" style={{ borderRadius: "10px 10px 0 0", width: "100%" }} /></div>
      <div className="blk"><div style={{ fontSize: 17.5, fontWeight: 700, lineHeight: 1.35 }}>{itemName(it, lang)}</div>{it.nameHi && it.nameHi !== itemName(it, lang) && <div className="hi" style={{ fontSize: 15, color: "var(--t6)", marginTop: 2 }}>{it.nameHi}</div>}<div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 9 }}>{Object.values(it.attrs).map((a) => <span className="atc" key={a}>{a}</span>)}</div></div>
      <div className="bandbox hi" style={{ background: col[0], borderColor: col[1], color: col[2] }}><span className="tl" style={{ background: col[2], width: 11, height: 11 }} />{b.hi}{b.k === "eta" && <button className="b b-o b-s" style={{ marginLeft: "auto" }} onClick={() => toast("प्री-बुक दर्ज — स्टॉक आने पर सूचना मिलेगी", "s")}>प्री-बुक</button>}</div>
      <div className="blk"><div className="lb">आपका रेट</div><div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 9 }}><span style={{ fontSize: 28.5, fontWeight: 700 }}>₹{pr.rate}</span><span style={{ fontSize: 14, color: "var(--t6)" }}>प्रति {it.uom.toLowerCase()}</span><span style={{ marginLeft: "auto", fontSize: 13, color: "var(--t4)" }}>MOQ {num(it.moq)}</span></div>
        <table className="slabs"><tbody>{data.slabs.map((s) => <tr key={s.fromQty} className={q >= s.fromQty && q <= s.toQty ? "on" : ""}><td>{num(s.fromQty)}{s.toQty > 1e8 ? "+" : " – " + num(s.toQty)} {it.uom.toLowerCase()}</td><td style={{ textAlign: "right" }} className="tab">₹{s.customerRate}</td></tr>)}</tbody></table>
        {pr.src === "override" && <div className="sm" style={{ marginTop: 7, color: "var(--ac)", fontFamily: "inherit" }}>आपके लिए तय किया गया विशेष रेट</div>}
        {data.nextSlab && q > 0 && <div className="note o hi" style={{ marginTop: 9 }}>{num(data.nextSlab.addQty)} और जोड़ें → ₹{data.nextSlab.rate} प्रति {it.uom.toLowerCase()} · {money(data.nextSlab.save)} बचाएं</div>}</div>
      {data.openBookings.length > 0 && <div className="blk" style={{ borderColor: "var(--wa-bd)", background: "var(--wa-bg)" }}><div className="lb" style={{ color: "var(--wa)" }}>आपकी पिछली बुकिंग</div>{data.openBookings.map((m) => <div key={m.orderId}><div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "var(--wa)" }}><b className="tab">{num(m.qty)} {it.uom.toLowerCase()}</b><span>{fDT(m.createdAt)}</span>{m.holdUntil && <span style={{ marginLeft: "auto" }}>बाकी <b><Hold until={m.holdUntil} /></b></span>}</div><div className="sm" style={{ marginTop: 3 }}>{m.orderId} — अभी ख़रीदा नहीं गया</div></div>)}</div>}
      {b.canBook && <div className="blk"><div className="lb">मात्रा</div><div className="qty"><button onClick={() => setQ(Math.max(0, q - it.moq))}>−</button><input type="number" value={q} onChange={(e) => setQ(Math.max(0, Number(e.target.value) || 0))} /><button onClick={() => setQ(q + it.moq)}>+</button></div><div className="sm hi" style={{ marginTop: 6 }}>{num(it.moq)} के गुणक में · {it.packUom} में {num(it.perPack)}</div><div className="lb" style={{ marginTop: 12 }}>कब चाहिए</div><input type="date" className="scani" value={req} onChange={(e) => setReq(e.target.value)} style={{ marginTop: 0 }} /></div>}
      {short && q > 0 && <div className="blk" style={{ borderColor: "var(--er-bd)" }}><div className="lb" style={{ color: "var(--er)" }}>सिर्फ़ {num(b.qty)} उपलब्ध — {num(q)} चाहिए</div>{b.qty > 0 && <button className="b b-o hi" style={{ width: "100%", marginBottom: 11 }} onClick={() => setQ(b.qty)}>{num(b.qty)} — {t("book")}</button>}<div className="lb">{t("seeAlternatives")}</div>
        {data.alternates.length ? data.alternates.map((a) => <div className="altrow" key={a.item.id}><img className="th cw" src={thumb(a.item, 56, 72)} alt="" style={{ border: "1px solid var(--bd)", borderRadius: 4 }} /><div className="in"><div className={lang === "hi" ? "hi" : ""} style={{ fontSize: 14, fontWeight: 600 }}>{itemName(a.item, lang)}</div><div className="sm">{a.item.designNo || a.item.sku} · {Object.values(a.item.attrs).slice(0, 2).join(" · ")}</div><div style={{ marginTop: 4, fontSize: 14 }}><b>₹{a.rate}</b> · <span style={{ color: a.avail >= q ? "var(--ok)" : "var(--wa)" }}>{num(a.avail)} उपलब्ध</span></div></div><button className="b b-o b-s hi" onClick={() => P.openSheet(a.item.id, q)}>{t("view")}</button></div>) : <div className="sm hi">{t("noAlternatives")}</div>}
        {data.alternates.length > 0 && b.qty > 0 && <div className="split"><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }} className="hi">या मिला-जुला लें</div><div style={{ fontSize: 14, color: "var(--t6)" }}>{num(b.qty)} × {it.designNo || it.sku} + {num(q - b.qty)} × {data.alternates[0].item.designNo || data.alternates[0].item.sku} = {num(q)} {it.uom.toLowerCase()}</div><button className="b b-p hi" style={{ width: "100%", marginTop: 9 }} onClick={() => split(data.alternates[0].item, b.qty, q - b.qty)}>दोनों बुक करें</button></div>}</div>}
    </div>
    <div className="shf"><div style={{ flex: 1 }}><div className="sm">{t("total")}</div><div style={{ fontSize: 18.5, fontWeight: 700 }} className="tab">{money(pr.rate * Math.min(q, short ? b.qty : q))}</div></div>{b.canBook ? <button className="b b-p hi" style={{ height: 44, padding: "0 26px", fontSize: 16.5 }} onClick={book}>{short ? t("bookAvailable") : t("book")}</button> : <button className="b b-o hi" style={{ height: 44, padding: "0 20px" }} onClick={() => { toast("हम आपको सूचित करेंगे", "s"); P.closeSheet(); }}>{t("notifyMe")}</button>}</div>
  </>;
}

function CartSheet() {
  const P = usePortal(); const { toast } = useUI(); const router = useRouter(); const { lang, t } = useLang(); const [req, setReq] = useState(() => new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)); const [busy, setBusy] = useState(false);
  const cart = P.cart, c = P.me!.firm; if (!cart) return null;
  const g = cart.gate; const cc = g.restricted ? (c.gateMode === "BLOCK" ? ["var(--er-bg)", "var(--er-bd)", "var(--er)"] : ["var(--wa-bg)", "var(--wa-bd)", "var(--wa)"]) : ["var(--ok-bg)", "var(--ok-bd)", "var(--ok)"];
  const place = async () => { setBusy(true); try { const r = await post<{ orderId: string; holdMins: number }>("/api/portal/book", { requiredBy: req }); toast(`बुकिंग ${r.orderId} हो गई — स्टॉक ${r.holdMins} मिनट के लिए रुका है`, "s"); P.closeSheet(); P.reload(); router.push("/portal/orders"); } catch (e) { toast(e instanceof Error ? e.message : "Error", "e"); P.reload(); } finally { setBusy(false); } };
  return <>
    <div className="shh"><strong style={{ fontSize: 15.5 }} className="hi">आपकी बुकिंग</strong><button className="b b-g b-s" style={{ marginLeft: "auto" }} onClick={P.closeSheet}>✕</button></div>
    <div className="shb">
      {Object.keys(cart.byLine).map((lid) => { const L = P.me!.lines.find((l) => l.id === lid); const gl = cart.lines.filter((l) => l.item.lineId === lid); const blk = cart.totals.blocks.find((b) => b.gstPct === cart.byLine[lid].gstPct); return <div className="lgrp" key={lid}><div className="hd"><LineChip id={lid} /><span style={{ marginLeft: "auto", color: "var(--t4)", fontWeight: 500 }}>{gl.length} आइटम</span></div><div className="bd2">
        {gl.map((l) => <div className="crow" key={l.item.id}><img className="th cw" src={thumb(l.item, 48, 62)} alt="" style={{ border: "1px solid var(--bd)", borderRadius: 4 }} /><div className="in"><div className={lang === "hi" ? "hi" : ""} style={{ fontSize: 14, fontWeight: 600 }}>{itemName(l.item, lang)}</div><div className="sm">{l.item.designNo || l.item.sku} · ₹{l.rate}/{l.item.uom.toLowerCase()}</div><div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 6 }}><div className="qs"><button onClick={() => P.addLine(l.item.id, -l.item.moq)}>−</button><span className="tab">{num(l.qty)}</span><button onClick={() => P.addLine(l.item.id, l.item.moq)}>+</button></div><b className="tab" style={{ fontSize: 14.5 }}>{money(l.amount)}</b><button className="b b-g b-s" style={{ marginLeft: "auto", color: "var(--t4)" }} onClick={() => P.rmLine(l.item.id)}>{t("remove")}</button></div></div></div>)}
        <div className="tot"><span className="hi">उप-योग</span><span className="tab">{money2(cart.byLine[lid].sub)}</span></div><div className="tot"><span>GST {L?.gstPct ?? cart.byLine[lid].gstPct}%{blk?.inter ? " (IGST)" : ""}</span><span className="tab">{money2(cart.byLine[lid].sub * cart.byLine[lid].gstPct / 100)}</span></div></div></div>; })}
      <div className="blk"><div className="tot"><span className="hi">कुल कर योग्य</span><span className="tab">{money2(cart.totals.taxable)}</span></div><div className="tot"><span>GST</span><span className="tab">{money2(cart.totals.tax)}</span></div><div className="tot g"><span className="hi">कुल</span><span className="tab">{money2(cart.totals.total)}</span></div></div>
      <div className="credbox hi" style={{ background: cc[0], borderColor: cc[1], color: cc[2] }}><div>बकाया {money(g.out)} · सीमा {money(c.creditLimit)}</div><div style={{ marginTop: 4 }}>इस ऑर्डर के बाद <b>{money(g.out + cart.totals.total)}</b>{g.amountBreach ? " ⚠ सीमा से ज़्यादा" : ""}</div>{g.timeBreach && <div style={{ marginTop: 4 }}>⚠ सबसे पुराना बिल {g.oldestAge} दिन का — तय {c.creditDays} दिन</div>}</div>
      <div className="blk"><div className="lb">कब चाहिए</div><input type="date" className="scani" value={req} onChange={(e) => setReq(e.target.value)} style={{ margin: 0 }} /></div>
    </div>
    <div className="shf">{g.restricted && c.gateMode === "BLOCK" ? <button className="b b-o hi" style={{ flex: 1, height: 44 }} onClick={() => toast(`ऑफ़िस को कॉल किया जा रहा है — ${c.salesExec?.name ?? "सेल्स"}`, "i")}>ऑफ़िस से बात करें</button> : <button className="b b-p hi" style={{ flex: 1, height: 44, fontSize: 16.5 }} disabled={busy} onClick={place}>बुकिंग कन्फ़र्म करें</button>}</div>
  </>;
}
