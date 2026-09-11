"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { money, money2, num, fDate, AGEING_LABELS, type CreditGate } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI } from "@/lib/ui";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { KPI, DF, Section, Note, Panel } from "@/components/ui";
import { Icon } from "@/components/icons";
import { PaymentModal } from "@/components/CustomerDetail";
import { InvoiceModal } from "@/components/InvoiceModal";
import { exportCsv } from "@/lib/csv";

const HSN_DESC: Record<string, string> = { "4817": "Envelopes, letter cards, printed stationery", "3215": "Printing ink", "3814": "Organic composite solvents", "5911": "Textile products for technical use", "3701": "Photographic plates", "3707": "Chemical preparations for photographic use", "3921": "Plastic sheets, film, foil", "7606": "Aluminium plates, sheets", "3920": "Acrylic sheets", "5603": "Non-wovens", "9989": "Other manufacturing services" };
interface OutRow { id: string; name: string; tehsil: string; creditDays: number; gateMode: string; creditLimit: number; gate: CreditGate; ageing: number[] }
interface Inv { no: string; date: string; orderId: string; taxable: number; cgst: number; sgst: number; igst: number; total: number; customer: { name: string; gstin: string | null } }
interface Pay { id: string; date: string; method: string; ref: string; amount: number; by: string; customerId: string; customer: { name: string } }

export default function AccountsPage() {
  const { can } = useAuth(); const { openModal } = useUI(); const sp = useSearchParams(); const router = useRouter();
  const [tab, setTab] = useState(() => sp.get("tab") ?? "out");
  // The dashboard's ageing bars link in with a bucket, e.g. /accounts?tab=out&bucket=3.
  const [bucket, setBucket] = useState<number | null>(() => { const b = sp.get("bucket"); return b == null ? null : Number(b); });
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const t = sp.get("tab"); if (t) setTab(t); const b = sp.get("bucket"); setBucket(b == null ? null : Number(b)); }, [sp]);
  const { data: out } = useApi<{ rows: OutRow[]; total: number; buckets: number[] }>("/api/ledger/outstanding"); const { data: invs } = useApi<Inv[]>("/api/ledger/invoices"); const { data: pays } = useApi<Pay[]>("/api/ledger/payments"); const { data: gst } = useApi<{ invoices: number; taxable: number; tax: number; b2b: number; b2c: number; hsn: { hsn: string; gstPct: number; qty: number; taxable: number; tax: number }[] }>("/api/ledger/gst-summary");
  const outRows = bucket == null ? out?.rows ?? [] : (out?.rows ?? []).filter((r) => (r.ageing[bucket] ?? 0) > 0);
  const list = tab === "out" ? outRows : tab === "inv" ? invs ?? [] : tab === "pay" ? pays ?? [] : gst?.hsn ?? [];
  const pg = usePager(list as unknown[]); useFooter(list.length, "", pg.page, pg.pages, pg.setPage);
  const gstr1 = () => exportCsv("gstr1", ["Invoice", "Date", "Firm", "GSTIN", "Taxable", "CGST", "SGST", "IGST", "Total"], (invs ?? []).map((i) => [i.no, fDate(i.date), i.customer.name, i.customer.gstin, i.taxable.toFixed(2), i.cgst.toFixed(2), i.sgst.toFixed(2), i.igst.toFixed(2), i.total.toFixed(2)]));
  return <>
    <PageHead crumb={["Finance", "Ledger & GST"]} title="Ledger & GST" sub="The ledger is the only source of truth for outstanding — no screen stores or edits a balance" actions={<><button className="b b-o" onClick={gstr1}><Icon n="download" s={13} /> GSTR-1 data</button>{can("payment.create") && <button className="b b-p" onClick={() => openModal(<PaymentModal />)}>+ Record payment</button>}</>} tabs={[{ k: "out", l: "Outstanding", n: out?.rows.length }, { k: "inv", l: "Invoice register", n: invs?.length }, { k: "pay", l: "Receipts", n: pays?.length }, { k: "gst", l: "GST summary" }]} tab={tab} onTab={(k) => { setTab(k); setBucket(null); }} />
    <div className="wa">
      {tab === "out" && out && <><div className="kpis c5"><KPI l="Total receivable" v={money(out.total)} onClick={() => setBucket(null)} />{AGEING_LABELS.slice(1).map((l, i) => <KPI key={l} l={l + " days"} v={<span style={{ color: i >= 2 ? "var(--er)" : undefined }}>{money(out.buckets[i + 1])}</span>} d={Math.round((out.buckets[i + 1] / Math.max(1, out.total)) * 100) + "% of book"} onClick={() => setBucket(i + 1)} />)}</div>
        {bucket != null && <div className="tbar"><button className="b b-o b-s" onClick={() => setBucket(null)}>{AGEING_LABELS[bucket]} days only — {outRows.length} firm{outRows.length === 1 ? "" : "s"} <Icon n="x" s={11} style={{ display: "inline", verticalAlign: "-1px", marginLeft: 3 }} /></button></div>}
        <div className="gw"><table className="dg"><thead><tr><th>Firm</th><th>Terms</th><th className="n">Limit</th><th className="n">Outstanding</th><th className="n">Available</th>{AGEING_LABELS.map((l) => <th className="n" key={l}>{l}</th>)}<th>Gate</th><th></th></tr></thead><tbody>
          {(pg.rows as OutRow[]).map((r) => <tr key={r.id} onClick={() => router.push(`/accounts/${r.id}`)}><td className="w"><span className="rid">{r.name}</span><div className="sm">{r.tehsil}</div></td><td className="sm">{r.creditDays ? "Net " + r.creditDays : "Advance"} · {r.gateMode}</td><td className="n tab">{money(r.creditLimit)}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{money(r.gate.out)}</td><td className="n tab" style={{ color: r.creditLimit - r.gate.out < 0 ? "var(--er)" : "var(--ok)" }}>{money(r.creditLimit - r.gate.out)}</td>{r.ageing.map((b, i) => <td key={i} className="n tab" style={{ color: i >= 3 && b ? "var(--er)" : b ? "var(--t6)" : "var(--t4)" }}>{b ? money(b) : "—"}</td>)}<td>{r.gate.restricted ? <span className="bd b-er">{r.gate.amountBreach ? "Amount" : ""}{r.gate.amountBreach && r.gate.timeBreach ? " + " : ""}{r.gate.timeBreach ? "Time" : ""}</span> : <span className="bd b-ok">OK</span>}</td><td>{can("payment.create") && <button className="b b-o b-s" onClick={(e) => { e.stopPropagation(); openModal(<PaymentModal customerId={r.id} />); }}>Receipt</button>}</td></tr>)}
        </tbody></table></div></>}
      {tab === "inv" && <><div className="gw"><table className="dg"><thead><tr><th>Invoice</th><th>Date</th><th>Firm</th><th>GSTIN</th><th>Order</th><th className="n">Taxable</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">IGST</th><th className="n">Total</th></tr></thead><tbody>{(pg.rows as Inv[]).map((i) => <tr key={i.no} onClick={() => openModal(<InvoiceModal no={i.no} orderId={i.orderId} />, "w")}><td><span className="rid">{i.no}</span></td><td className="tab">{fDate(i.date)}</td><td className="w">{i.customer.name}</td><td className="sm">{i.customer.gstin}</td><td className="sm">{i.orderId}</td><td className="n tab">{money2(i.taxable)}</td><td className="n tab">{i.cgst ? money2(i.cgst) : "—"}</td><td className="n tab">{i.sgst ? money2(i.sgst) : "—"}</td><td className="n tab">{i.igst ? money2(i.igst) : "—"}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{money2(i.total)}</td></tr>)}</tbody></table></div><Note k="i" style={{ marginTop: 11 }}>Numbering is sequential and gapless per financial year per series. A cancelled invoice keeps its number and is marked cancelled — never reused.</Note></>}
      {tab === "pay" && <div className="gw"><table className="dg"><thead><tr><th>Receipt</th><th>Date</th><th>Firm</th><th>Method</th><th>Reference</th><th className="n">Amount</th><th>Recorded by</th></tr></thead><tbody>{(pg.rows as Pay[]).map((p) => <tr key={p.id} onClick={() => router.push(`/accounts/${p.customerId}`)}><td><span className="rid">{p.id}</span></td><td className="tab">{fDate(p.date)}</td><td className="w">{p.customer.name}</td><td>{p.method}</td><td className="sm">{p.ref}</td><td className="n tab" style={{ fontWeight: 700, color: "var(--ok)" }}>{money(p.amount)}</td><td className="sm">{p.by}</td></tr>)}</tbody></table></div>}
      {tab === "gst" && gst && <><div className="kpis"><KPI l="Invoices" v={gst.invoices} /><KPI l="Taxable value" v={money(gst.taxable)} /><KPI l="Output tax" v={money(gst.tax)} /><KPI l="B2B / B2C" v={<span style={{ fontSize: 17.5 }}>{gst.b2b} / {gst.b2c}</span>} /></div>
        <Panel t="HSN-wise summary" h="the shape GSTR-1 needs"><div className="gw" style={{ border: "none", borderRadius: 0 }}><table className="dg"><thead><tr><th>HSN</th><th>Description</th><th className="n">Rate</th><th className="n">Quantity</th><th className="n">Taxable value</th><th className="n">Tax</th></tr></thead><tbody>{gst.hsn.map((r) => <tr key={r.hsn + r.gstPct} style={{ cursor: "default" }}><td className="rid">{r.hsn}</td><td>{HSN_DESC[r.hsn] ?? "—"}</td><td className="n tab">{r.gstPct}%</td><td className="n tab">{num(r.qty)}</td><td className="n tab">{money2(r.taxable)}</td><td className="n tab" style={{ fontWeight: 600, color: "var(--t9)" }}>{money2(r.tax)}</td></tr>)}</tbody></table></div></Panel></>}
    </div>
  </>;
}
// A firm's ledger opens on its own page. It is read alongside a statement and
// a phone call, so it keeps everything the drawer had — position, ageing and
// the running statement — with room to read the statement rather than scroll it.
export function LedgerDetail({ id }: { id: string }) {
  const { data } = useApi<{ customer: { name: string; creditLimit: number; tehsil?: string; phone?: string }; gate: CreditGate; ageing: { buckets: number[]; labels: string[] }; statement: { id: string; date: string; particular: string; debit: number; credit: number; bal: number }[] }>(`/api/ledger/customers/${id}`);
  const { openModal, toast } = useUI(); const { can } = useAuth();
  const router = useRouter();
  useFooter(null);
  if (!data) return <div className="wa"><div className="sm">Loading…</div></div>;
  const { customer: c, gate: g, ageing: a } = data;

  return <>
    <PageHead
      crumb={["Finance", "Ledger & GST", c.name]}
      title={`${c.name} — ledger`}
      sub={<>Outstanding {money(g.out)} of {money(c.creditLimit)}{g.oldestAge ? ` · oldest unpaid ${g.oldestAge} days` : ""}</>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/accounts")}><Icon n="chevronL" s={13} /> Back to ledger</button>
        <button className="b b-o" onClick={() => router.push(`/customers/${id}`)}>Open the firm</button>
        {can("payment.create") && <button className="b b-p" onClick={() => openModal(<PaymentModal customerId={id} />)}>Record payment</button>}
        <button className="b b-o" onClick={() => toast("Statement sent on WhatsApp", "s")}>Send statement</button>
      </>}
    />
    <div className="wa">
      {g.restricted && <Note k="w" style={{ marginBottom: 13 }}>
        Credit gate is <b>{g.mode === "BLOCK" ? "blocking" : "warning"}</b> — {g.amountBreach ? "the limit is breached" : ""}{g.amountBreach && g.timeBreach ? " and " : ""}{g.timeBreach ? `the oldest invoice is ${g.oldestAge} days old` : ""}.
      </Note>}
      <div className="idg">
        <div>
          <div className="pn"><div className="pnb">
            <Section t="Statement">
              <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Date</th><th>Particular</th><th className="n">Debit</th><th className="n">Credit</th><th className="n">Balance</th></tr></thead><tbody>
                {data.statement.map((e) => <tr key={e.id} style={{ cursor: "default" }}>
                  <td className="tab">{fDate(e.date)}</td>
                  <td className="w">{e.particular}</td>
                  <td className="n tab">{e.debit ? money(e.debit) : "—"}</td>
                  <td className="n tab" style={{ color: e.credit ? "var(--ok)" : undefined }}>{e.credit ? money(e.credit) : "—"}</td>
                  <td className="n tab" style={{ fontWeight: 600 }}>{money(e.bal)}</td>
                </tr>)}
              </tbody></table>
              <div className="sm" style={{ marginTop: 7 }}>The ledger is the only source of truth for what a firm owes — no screen stores or edits a balance, it is derived from these lines.</div>
            </Section>
          </div></div>
        </div>
        <div>
          <div className="pn"><div className="pnb">
            <Section t="Position">
              <DF k="Outstanding" v={<span style={{ fontWeight: 700, color: g.restricted ? "var(--er)" : undefined }}>{money(g.out)}</span>} mono />
              <DF k="Credit limit" v={money(c.creditLimit)} mono />
              <DF k="Headroom" v={<span style={{ color: c.creditLimit - g.out < 0 ? "var(--er)" : "var(--ok)" }}>{money(c.creditLimit - g.out)}</span>} mono />
              <DF k="Oldest unpaid" v={g.oldestAge ? `${g.oldestAge} days` : "—"} mono />
              <DF k="Gate" v={g.restricted ? <span className="bd b-er">{g.mode}</span> : <span className="bd b-ok">OK</span>} />
            </Section>
            <Section t="Ageing">{a.labels.map((l, i) => <DF key={l} k={l} v={<span style={{ color: i >= 3 && a.buckets[i] ? "var(--er)" : undefined }}>{money(a.buckets[i])}</span>} mono />)}</Section>
          </div></div>
        </div>
      </div>
    </div>
  </>;
}

