"use client";
import { useState } from "react";
import { money, money2, num, fDate } from "@vivaha/shared";
import { useApi, useLines } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useUI } from "@/lib/ui";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { KPI, LineChip, Empty, Note } from "@/components/ui";
import { InvoiceModal } from "@/components/InvoiceModal";
import { exportCsv } from "@/lib/csv";
import { Icon } from "@/components/icons";

interface Inv {
  no: string; orderId: string; date: string; lineId: string | null;
  line: { id: string; name: string } | null;
  customer: { name: string; gstin: string | null; firmType: string; tehsil: string };
  taxable: number; cgst: number; sgst: number; igst: number; tax: number; total: number; status: string;
  sentCount: number;
  lastSent: { at: string; by: string; toName: string; toPhone: string; channel: string } | null;
  amendCount: number;
  lastAmend: { at: string; by: string; reason: string; oldTotal: number; newTotal: number } | null;
}
interface Series { lineId: string; name: string; prefix: string; start: number; fy: string; issued: number; nextNo: string; started: boolean }

// The invoice register, gated by business line the way every other screen is —
// the topbar's line switcher is the same control here. Each line bills on its
// own series, so "all lines" is a genuine mix of series rather than one run of
// numbers with gaps in it.
export default function InvoicesPage() {
  const { line } = useAppState();
  const { data: lines } = useLines();
  const { openModal } = useUI();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unsentOnly, setUnsentOnly] = useState(false);

  const qs = `line=${line}&q=${encodeURIComponent(q)}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const { data } = useApi<Inv[]>(`/api/ledger/invoices?${qs}`);
  const { data: series } = useApi<Series[]>("/api/ledger/invoice-series");

  const all = data ?? [];
  const rows = unsentOnly ? all.filter((r) => !r.sentCount) : all;
  const unsent = all.filter((r) => !r.sentCount).length;
  const pg = usePager(rows);
  const L = lines?.find((l) => l.id === line);
  useFooter(rows.length, line === "ALL" ? "" : L?.name ?? "", pg.page, pg.pages, pg.setPage);

  const taxable = rows.reduce((s, r) => s + r.taxable, 0);
  const tax = rows.reduce((s, r) => s + r.tax, 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const shown = line === "ALL" ? series ?? [] : (series ?? []).filter((s) => s.lineId === line);

  return <>
    <PageHead
      crumb={["Finance", "Invoices"]}
      title="Invoices"
      sub="Every tax invoice raised, newest first. Each business line bills on its own series — the series and the number it starts from are set against the line in Settings."
      actions={<button className="b b-o" onClick={() => exportCsv("invoices", ["Invoice", "Date", "Line", "Firm", "GSTIN", "Order", "Taxable", "CGST", "SGST", "IGST", "Total", "Sent on", "Sent to", "Times sent", "Corrections"], rows.map((r) => [r.no, fDate(r.date), r.line?.name ?? "—", r.customer.name, r.customer.gstin ?? "Unregistered", r.orderId, r.taxable, r.cgst, r.sgst, r.igst, r.total, r.lastSent ? fDate(r.lastSent.at) : "", r.lastSent?.toName ?? "", r.sentCount, r.amendCount]))}><Icon n="download" s={13} /> Export</button>}
    />
    <div className="wa">
      <div className="kpis c5">
        <KPI l="Invoices" v={num(rows.length)} d={line === "ALL" ? "across every line" : L?.name} />
        <KPI l="Taxable value" v={money(taxable)} />
        <KPI l="Tax" v={money(tax)} d="CGST + SGST + IGST" />
        <KPI l="Invoiced" v={money(total)} />
        <KPI l="Not yet sent" v={num(unsent)} cls={unsent ? "d-wa" : undefined} d={unsent ? "click to show only these" : "every bill has gone out"} onClick={() => setUnsentOnly((v) => !v)} />
      </div>

      {shown.length > 0 && <Note k="i" style={{ marginBottom: 11 }}>
        Next number{shown.length === 1 ? "" : "s"} for {shown[0].fy}: {shown.map((s, i) => <span key={s.lineId}>{i ? " · " : ""}<b>{s.nextNo}</b> <span className="sm">({s.name}{s.started ? `, ${num(s.issued)} issued` : ", not yet started"})</span></span>)}
      </Note>}

      <div className="tbar">
        <div className="tsr"><Icon n="search" s={13} /><input placeholder="Invoice number, firm or order…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="sm">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px" }} />
        <span className="sm">to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px" }} />
        {unsentOnly && <button className="b b-o b-s" onClick={() => setUnsentOnly(false)}>Not sent only <Icon n="x" s={11} /></button>}
        {(from || to || q) && <button className="b b-o b-s" onClick={() => { setQ(""); setFrom(""); setTo(""); }}>Clear <Icon n="x" s={11} /></button>}
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{rows.length} shown</span>
      </div>

      <div className="gw"><table className="dg"><thead><tr>
        <th>Invoice</th><th>Line</th><th>Firm</th><th>Order</th>
        <th className="n">Taxable</th><th className="n">Tax</th><th className="n">Total</th><th>Sent</th><th>Status</th>
      </tr></thead><tbody>
        {pg.rows.length ? pg.rows.map((r) => <tr key={r.no} onClick={() => openModal(<InvoiceModal no={r.no} orderId={r.orderId} />, "w")}>
          <td><span className="rid">{r.no}</span><div className="sm">{fDate(r.date)}</div></td>
          <td>{r.lineId ? <LineChip id={r.lineId} /> : <span className="sm">—</span>}</td>
          <td className="w">{r.customer.name}<div className="sm">{r.customer.tehsil} · {r.customer.gstin ?? "Unregistered"}</div></td>
          <td><span className="rid">{r.orderId}</span></td>
          <td className="n tab">{money2(r.taxable)}</td>
          <td className="n tab">{money2(r.tax)}</td>
          <td className="n tab" style={{ fontWeight: 700, color: "var(--t9)" }}>{money2(r.total)}</td>
          <td>{r.lastSent
            ? <><span className="bd b-ok">Sent</span><div className="sm">{fDate(r.lastSent.at)} · {r.lastSent.toName || r.lastSent.toPhone}{r.sentCount > 1 ? ` · ${r.sentCount}×` : ""}</div></>
            : <span className="bd b-wa">Not sent</span>}</td>
          <td>{r.status === "Posted" ? <span className="bd b-ok">Posted</span> : <span className="bd b-er">{r.status}</span>}
            {/* A corrected bill says so here, not only in the audit log. */}
            {r.amendCount ? <div className="sm" style={{ color: "var(--wa)" }}>corrected {r.amendCount === 1 ? "once" : `${r.amendCount}×`}{r.lastAmend ? ` · ${money2(r.lastAmend.oldTotal)} → ${money2(r.lastAmend.newTotal)}` : ""}</div> : null}</td>
        </tr>) : <tr><td colSpan={9}><Empty t="No invoices" d={line === "ALL" ? "No invoice has been raised yet. One is raised automatically when an order is dispatched." : `No invoice on the ${L?.name ?? "selected"} line for this search.`} /></td></tr>}
      </tbody></table></div>

      <Note style={{ marginTop: 11 }}>An invoice is raised automatically when an order is dispatched, on the business line that order was for. A number is never reused — a cancelled invoice keeps its number and its place in the series.</Note>
      <Note k="i" style={{ marginTop: 9 }}><b>Corrected</b> means the bill was put right after it was raised. The number stays, what it said before is kept with the reason and who changed it, and the difference is posted to the firm&apos;s ledger as its own entry. Opening the bill shows the whole trail. Who may do it is set per person under Settings → Users &amp; logins → Capabilities.</Note>
      <Note k="i" style={{ marginTop: 9 }}><b>Sent</b> records that the bill was sent from here, to that number, by that person — it is written when Share on WhatsApp opens the message. WhatsApp does not tell us whether it was delivered or read, so this never claims the firm received it.</Note>
    </div>
  </>;
}
