"use client";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { usePortal, type PItem } from "@/components/portal/PortalContext";
import { CatGrid } from "@/components/portal/Bits";
export default function CatPage() {
  const P = usePortal(); const [q, setQ] = useState(""); const [val, setVal] = useState("ALL"); const L = P.me!.lines.find((l) => l.id === P.line);
  const { data } = useApi<{ facet: string; values: string[]; items: PItem[] }>(`/api/portal/catalogue?line=${P.line}&q=${encodeURIComponent(q)}&value=${encodeURIComponent(val)}`);
  return <><input className="scani hi" placeholder="कार्ड खोजें…" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: "0 0 12px" }} />
    <div className="cats"><button className={val === "ALL" ? "on" : ""} onClick={() => setVal("ALL")}>सब</button>{data?.values.map((v) => <button key={v} className={val === v ? "on" : ""} onClick={() => setVal(v)}>{v}</button>)}</div>
    <div className="sm" style={{ marginBottom: 9, fontFamily: "inherit" }}>{data?.items.length ?? 0} items · {L?.name}</div>
    {data && (data.items.length ? <CatGrid list={data.items} /> : <div className="blk" style={{ textAlign: "center", padding: 34 }}><div className="hi" style={{ fontWeight: 600 }}>कुछ नहीं मिला</div></div>)}</>;
}
