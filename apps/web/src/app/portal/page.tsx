"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { money, num } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useUI } from "@/lib/ui";
import { apiFetch, post } from "@/lib/api";
import { usePortal, type PItem } from "@/components/portal/PortalContext";
import { CatGrid, Sect, HitRows } from "@/components/portal/Bits";
import { LineChip } from "@/components/ui";
import { thumb } from "@/lib/art";

interface Home { reorder: { orderId: string; lines: { item: PItem; qty: number }[] } | null; nudge: { item: PItem; qty: number; amount: number; machine: string | null } | null; ad: { id: string; title: string; sub: string } | null; newItems: PItem[]; hits: { item: PItem; sold: number; district: number }[] }
export default function PortalHome() {
  const P = usePortal(); const { toast } = useUI(); const router = useRouter(); const [scan, setScan] = useState<PItem[] | null>(null); const [sv, setSv] = useState("");
  const { data } = useApi<Home>(`/api/portal/home?line=${P.line}`); const c = P.me!.firm, L = P.me!.lines.find((l) => l.id === P.line);
  const doScan = async () => { const r = await apiFetch<PItem[]>(`/api/portal/scan?q=__random__&line=${P.line}`); if (r[0]) { toast(`Scanned ${r[0].designNo || r[0].sku}`, "s"); P.openSheet(r[0].id); } };
  const type = async (v: string) => { setSv(v); if (v.trim().length < 2) return setScan(null); setScan(await apiFetch<PItem[]>(`/api/portal/scan?q=${encodeURIComponent(v)}`)); };
  const reorder = async (oid: string) => { const r = await post<{ added: number; short: number }>(`/api/portal/cart/reorder/${oid}`); P.reload(); toast(`${r.added} item(s) added${r.short ? ` · ${r.short} not available at the old quantity` : ""}`, r.short ? "w" : "s"); };
  return <>
    {c.blockReason && <div className="blk" style={{ borderColor: "var(--er)", background: "var(--er-bg)" }}><div style={{ fontSize: 15, fontWeight: 700, color: "var(--er)", marginBottom: 4 }} className="hi">खाता अस्थायी रूप से रोका गया है</div><div style={{ fontSize: 14, color: "var(--er)" }} className="hi">{c.blockReason} — बकाया चुकाने पर रोक अपने आप हट जाएगी। खाता और भुगतान खुला है।</div></div>}
    <div className="scan"><button className="scanb" onClick={doScan}>📷 <span className="hi">कार्ड स्कैन करें</span></button><input className="scani hi" value={sv} placeholder="या डिज़ाइन नंबर टाइप करें — DSN-2451" onChange={(e) => type(e.target.value)} />
      {scan && (scan.length ? <div style={{ marginTop: 9 }}>{scan.map((i) => <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--bd-soft)", cursor: "pointer" }} onClick={() => P.openSheet(i.id)}><img className="cw" src={thumb(i, 42, 54)} alt="" style={{ width: 34, border: "1px solid var(--bd)" }} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{i.name}</div><div className="sm">{i.designNo || i.sku} · <LineChip id={i.lineId} /></div></div><span className={"bd b-" + ({ ok: "ok", warn: "wa", err: "er", neu: "nu" } as const)[i.band.cls]}>{i.band.label}</span></div>)}</div> : <div className="sm hi" style={{ marginTop: 9 }}>कोई कार्ड नहीं मिला — नंबर दोबारा देखिए</div>)}</div>
    {data?.reorder && <><Sect t="फिर से ऑर्डर करें" more="सब जोड़ें" onMore={() => reorder(data.reorder!.orderId)} /><div className="strip">{data.reorder.lines.map((l) => <div className="it" key={l.item.id} onClick={() => P.openSheet(l.item.id, l.qty)}><img className="cw" src={thumb(l.item, 80, 100)} alt="" /><div className="n">{l.item.designNo || l.item.sku}</div><div className="q">{num(l.qty)} {l.item.uom.toLowerCase()}</div></div>)}</div></>}
    {data?.nudge && <div className="nudge"><img className="cw" src={thumb(data.nudge.item, 54, 54)} alt="" style={{ width: 44 }} /><div className="b1"><div className="t hi">स्याही ख़त्म होने वाली है</div><div className="s">{data.nudge.item.name} · {data.nudge.qty} {data.nudge.item.uom} · {money(data.nudge.amount)}</div><div className="sm" style={{ marginTop: 3, fontFamily: "inherit" }}>{data.nudge.machine ?? "your machine"} — 5 दिन में लगेगी</div></div><button className="b b-p b-s" onClick={async () => { if (await P.addLine(data.nudge!.item.id, data.nudge!.qty)) toast("Added to cart", "s"); }}><span className="hi">जोड़ें</span></button></div>}
    {data?.ad && <div className="adslot"><div style={{ flex: 1 }}><div className="l">विज्ञापन</div><div className="t">{data.ad.title}</div><div className="s">{data.ad.sub}</div></div><button className="b b-o b-s" style={{ background: "rgba(255,255,255,.14)", borderColor: "rgba(255,255,255,.24)", color: "#fff" }} onClick={() => toast("Advertiser landing page", "i")}>देखें</button></div>}
    <Sect t={`${L?.nameHi ?? ""} — नया माल`} more="सब देखें" onMore={() => router.push("/portal/cat")} />{data && <CatGrid list={data.newItems} />}
    <Sect t="इस सीज़न के हिट डिज़ाइन" more="सब देखें" onMore={() => router.push("/portal/hits")} /><div className="blk">{data && <HitRows rows={data.hits} />}</div>
    <div className="blk" style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 11 }}><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700 }} className="hi">रेफ़र करें और कमाएं</div><div style={{ fontSize: 13.5, color: "var(--t6)" }} className="hi">हर नए ग्राहक के पहले भुगतान पर ₹2,000 खाते में जमा</div></div><button className="b b-o b-s" onClick={() => router.push("/portal/refer")}><span className="hi">खोलें</span></button></div>
  </>;
}
