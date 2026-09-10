"use client";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { useUI } from "@/lib/ui";
import { post } from "@/lib/api";
import { Sect, HitRows } from "@/components/portal/Bits";
import type { PItem } from "@/components/portal/PortalContext";
export default function HitsPage() {
  const { data } = useApi<{ tehsil: string; rows: { item: PItem; sold: number; district: number }[] }>("/api/portal/hits"); const { toast } = useUI(); const [t, setT] = useState("");
  return <><Sect t="इस सीज़न के हिट डिज़ाइन" /><div className="sm hi" style={{ marginBottom: 10 }}>आपके ज़िले में — {data?.tehsil} · सबसे ज़्यादा बिकने वाले</div><div className="blk">{data && <HitRows rows={data.rows} />}</div>
    <div className="blk" style={{ borderColor: "var(--ac-bd)", background: "var(--ac-bg)", marginTop: 11 }}><div className="hi" style={{ fontSize: 15, fontWeight: 700, color: "var(--ac-d)" }}>कोई डिज़ाइन कहीं और से लिया?</div><div className="hi" style={{ fontSize: 14, color: "var(--ac-d)", marginTop: 3 }}>बताइए — 50 पॉइंट मिलेंगे, और आपके ज़िले की रैंकिंग बेहतर होगी</div><input className="scani hi" value={t} onChange={(e) => setT(e.target.value)} placeholder="डिज़ाइन और पार्टी का नाम" style={{ marginTop: 9 }} /><button className="b b-p hi" style={{ width: "100%", marginTop: 8 }} onClick={async () => { if (!t.trim()) return toast("कुछ लिखिए", "e"); await post("/api/portal/hits/competitor", { text: t }); toast("धन्यवाद — 50 पॉइंट जुड़ गए", "s"); setT(""); }}>जोड़ें</button><div className="sm hi" style={{ marginTop: 8 }}>ज़रूरी नहीं है — मर्ज़ी से बताइए</div></div></>;
}
