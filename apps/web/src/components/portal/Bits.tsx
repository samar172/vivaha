"use client";
import { num } from "@vivaha/shared";
import { thumb } from "@/lib/art";
import { usePortal, type PItem } from "./PortalContext";
import { useLang, itemName } from "@/lib/i18n";

export function CatGrid({ list }: { list: PItem[] }) {
  const P = usePortal(); const { lang, t } = useLang();
  return <div className="pgrid">{list.map((i) => { const b = i.band; return <div className="pcd" key={i.id} onClick={() => P.openSheet(i.id)}><div className="im"><img className="cw" src={thumb(i, 180, 150)} alt="" /><span className={"bnd bd b-" + ({ ok: "ok", warn: "wa", err: "er", neu: "nu" } as const)[b.cls]}>{b.k === "in" ? "In stock" : b.k === "ltd" || b.k === "low" ? num(b.qty) : b.k === "eta" ? "Soon" : "Out"}</span></div><div className="bo"><div className="dn">{i.designNo || i.sku}</div><div className={"nm" + (lang === "hi" ? " hi" : "")}>{itemName(i, lang)}</div><div className="at">{Object.values(i.attrs).slice(0, 2).map((a) => <span className="atc" key={a}>{a}</span>)}</div><div className="pr"><span className="p">₹{i.rate}<small>/{i.uom.toLowerCase()}</small></span><span className="mq">MOQ {num(i.moq)}</span></div><button className="ab hi" disabled={!b.canBook} onClick={(e) => { e.stopPropagation(); if (b.canBook) P.openSheet(i.id); }}>{b.canBook ? t("book") : (lang === "hi" ? "स्टॉक ख़त्म" : "Out of stock")}</button></div></div>; })}</div>;
}
export const Sect = ({ t, more, onMore }: { t: string; more?: string; onMore?: () => void }) => <div className="sect"><span className="hi">{t}</span>{more && <span className="mo2" onClick={onMore}>{more}</span>}</div>;
export function HitRows({ rows }: { rows: { item: PItem; sold: number; district: number }[] }) {
  const P = usePortal(); const { lang, t } = useLang();
  return <>{rows.map((r, x) => <div className="hitr" key={r.item.id}><div className="rk">{x + 1}</div><img className="th cw" src={thumb(r.item, 56, 72)} alt="" style={{ border: "1px solid var(--bd)", borderRadius: 4 }} /><div style={{ flex: 1, minWidth: 0 }}><div className={lang === "hi" ? "hi" : ""} style={{ fontSize: 14, fontWeight: 600 }}>{itemName(r.item, lang)}</div><div className="sm">{r.item.designNo || r.item.sku} · {r.item.attrs.paper} · ₹{r.item.rate}</div><div className="sm hi" style={{ marginTop: 3 }}>आपने बेचे: {num(r.sold)} · ज़िले में {num(r.district)}</div></div><button className="b b-o b-s hi" onClick={() => P.openSheet(r.item.id)}>{r.item.band.canBook ? t("book") : t("view")}</button></div>)}</>;
}
