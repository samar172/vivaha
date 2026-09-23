"use client";
import Link from "next/link";
import { money, money2, fDate, type CreditGate } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useLang } from "@/lib/i18n";
import { useUI } from "@/lib/ui";
import { Sect } from "@/components/portal/Bits";
import { Bar } from "@/components/ui";
import { InstallButton } from "@/components/InstallApp";
const SPEC: Record<string, string> = { colours: "रंग", ink: "स्याही", company: "कंपनी", roller: "रोलर क्लॉथ", chem: "केमिकल", industry: "इंडस्ट्री", model: "मॉडल" };
export default function AccountPage() {
  const { data } = useApi<{ firm: { name: string; contactName: string; phone: string; tehsil: string; gstin: string | null; group: string; creditLimit: number; creditDays: number; salesExec: { name: string } | null; machines: { id: string; type: string; spec: Record<string, string> }[] }; gate: CreditGate; ageing: { buckets: number[]; labels: string[] }; statement: { id: string; date: string; particular: string; debit: number; credit: number; bal: number }[] }>("/api/portal/account"); const { toast } = useUI(); const { user } = useAuth(); const { lang, t } = useLang();
  if (!data) return null; const { firm: c, gate: g, ageing: a } = data;
  return <><Sect t="खाता" /><div className="blk"><div style={{ display: "flex", gap: 12 }}>{[["सीमा", money(c.creditLimit)], ["बकाया", money(g.out)], ["बाकी सीमा", money(c.creditLimit - g.out)]].map((r) => <div key={r[0]} style={{ flex: 1 }}><div className="lb">{r[0]}</div><div className="tab" style={{ fontSize: 16.5, fontWeight: 700 }}>{r[1]}</div></div>)}</div><div style={{ marginTop: 10 }}><Bar pct={g.util * 100} color={g.restricted ? "var(--er)" : g.util > .85 ? "var(--wa)" : "var(--ok)"} /></div>{g.timeBreach && <div className="note w hi" style={{ marginTop: 9 }}>सबसे पुराना बिल {g.oldestAge} दिन का है — तय {c.creditDays} दिन। नए ऑर्डर रुक सकते हैं।</div>}</div>
    <div className="blk"><div className="lb">उम्र के हिसाब से</div>{a.labels.map((l, i) => <div className="tot" key={l}><span>{l}</span><span className="tab" style={{ color: i >= 3 && a.buckets[i] ? "var(--er)" : "inherit" }}>{money(a.buckets[i])}</span></div>)}</div>
    <Sect t="खाता विवरण" more="PDF भेजें" onMore={() => toast("PDF statement भेजा गया", "s")} /><div className="blk">{data.statement.length ? data.statement.map((e) => <div className="ledr" key={e.id}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14 }}>{e.particular}</div><div className="sm">{fDate(e.date)}</div></div><div style={{ textAlign: "right" }}><div className="tab" style={{ fontWeight: 600, color: e.credit ? "var(--ok)" : "var(--t9)" }}>{e.credit ? "−" + money2(e.credit) : money2(e.debit)}</div><div className="sm">{money2(e.bal)}</div></div></div>) : <div className="sm hi">कोई एंट्री नहीं</div>}</div>
    <div className="blk" style={{ marginTop: 11 }}><div className="lb">फ़र्म की जानकारी</div>{[["फ़र्म", c.name], ["मालिक", c.contactName], ["फ़ोन", c.phone], ["तहसील", c.tehsil], ["GSTIN", c.gstin ?? "—"], ["ग्रुप", c.group], ["सेल्स एग्ज़ीक्यूटिव", c.salesExec?.name ?? "—"]].map((r) => <div className="tot" key={r[0]}><span className="hi">{r[0]}</span><span>{r[1]}</span></div>)}{c.machines.length > 0 && <><div className="lb" style={{ marginTop: 12 }}>आपकी मशीनें</div>{c.machines.map((m) => <div key={m.id} style={{ border: "1px solid var(--bd)", borderRadius: 6, padding: "9px 11px", marginTop: 6 }}><b style={{ fontSize: 14 }}>{m.type}</b>{Object.keys(m.spec).map((k) => <div className="tot" key={k} style={{ fontSize: 13 }}><span>{SPEC[k] ?? k}</span><span>{m.spec[k]}</span></div>)}</div>)}</>}<div className="sm hi" style={{ marginTop: 10 }}>जानकारी बदलवाने के लिए ऑफ़िस से संपर्क करें।</div></div>
    {user?.authority === "Owner" && <Link href="/portal/staff" className="blk" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
      <div style={{ flex: 1 }}>
        <div className={lang === "hi" ? "hi" : ""} style={{ fontSize: 15, fontWeight: 700 }}>{t("staffAndLogins")}</div>
        <div className={"sm" + (lang === "hi" ? " hi" : "")}>{t("billsNote")}</div>
      </div>
      <span style={{ fontSize: 18, opacity: .5 }}>›</span>
    </Link>}
    {/* A retailer who waved the card away a fortnight ago still wants the app;
        this is the door that is always there. */}
    <div className="blk">
      <div className={"lb" + (lang === "hi" ? " hi" : "")}>{lang === "hi" ? "ऐप इंस्टॉल करें" : "Install the app"}</div>
      <div className={"sm" + (lang === "hi" ? " hi" : "")} style={{ margin: "4px 0 9px" }}>
        {lang === "hi"
          ? "दुकान को फ़ोन की होम स्क्रीन पर लगाएँ — पूरी स्क्रीन पर खुलेगी, बिना एड्रेस बार।"
          : "Put the shop on your phone's home screen — it opens full screen, without the address bar."}
      </div>
      <InstallButton hindi={lang === "hi"} className="b b-p b-f" />
    </div></>;
}
