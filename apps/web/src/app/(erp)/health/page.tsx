"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { num } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useFooter } from "@/components/Shell";
import { PageHead } from "@/components/PageHead";
import { KPI, Empty, Note, Bar } from "@/components/ui";
import { Icon } from "@/components/icons";
import { exportCsv } from "@/lib/csv";

// How complete the customer and supplier masters are, as a percentage.
//
// A half-filled master costs money quietly. A bill cannot be raised without a
// GSTIN; a short delivery cannot be chased without a phone number; a firm with
// nobody marked to receive bills has them going nowhere at all. None of it
// announces itself — it surfaces as a delay, one record at a time, and nobody
// ever sits down to fix the class of problem.
//
// So: the number, the fields holding it down, and the records to go and mend —
// in that order, because a score with no worklist under it is decoration.

interface Check { key: string; label: string; weight: number; ok: boolean; na?: boolean; hint: string }
interface Row { id: string; name: string; code: string | null; score: number; missing: Check[]; checks: Check[] }
interface Field { key: string; label: string; weight: number; hint: string; ok: number; applies: number; pct: number }
interface Side { rows: Row[]; overall: number; counted: number; good: number; fair: number; poor: number; fields: Field[] }

const band = (n: number) => (n >= 90 ? { cls: "b-ok", col: "var(--ok)", word: "Good" } : n >= 60 ? { cls: "b-wa", col: "var(--wa)", word: "Fair" } : { cls: "b-er", col: "var(--er)", word: "Poor" });

export default function HealthPage() {
  const { data } = useApi<{ customers: Side; vendors: Side }>("/api/reports/health");
  const [tab, setTab] = useState<"customers" | "vendors">("customers");
  const [only, setOnly] = useState<string | null>(null);
  const router = useRouter();

  const side = data ? data[tab] : null;
  const rows = (side?.rows ?? [])
    .filter((r) => !only || r.missing.some((m) => m.key === only))
    .slice()
    .sort((a, b) => a.score - b.score);
  useFooter(rows.length);

  const open = (r: Row) => router.push(tab === "customers" ? `/customers/${r.id}` : `/vendors/${r.id}`);

  return <>
    <PageHead
      crumb={["Insight", "Data health"]}
      title="Data health"
      sub="How complete the customer and supplier records are. A half-filled master costs money quietly — a bill that cannot be raised, a delivery that cannot be chased — so this is the percentage, what is holding it down, and who to fix first."
      tabs={[{ k: "customers", l: "Customers", n: data?.customers.counted }, { k: "vendors", l: "Suppliers", n: data?.vendors.counted }]}
      tab={tab} onTab={(k) => { setTab(k as "customers" | "vendors"); setOnly(null); }}
      actions={<button className="b b-o" disabled={!side} onClick={() => exportCsv(`health-${tab}`, ["Name", "Code", "Score %", "Missing"], (side?.rows ?? []).map((r) => [r.name, r.code ?? "", r.score, r.missing.map((m) => m.label).join("; ")]))}><Icon n="download" s={13} /> Export</button>}
    />
    <div className="wa">
      {!side ? <div className="sm">Loading…</div> : <>
        <div className="kpis c4">
          <KPI l="Overall" v={`${side.overall}%`} cls={side.overall >= 90 ? "d-ok" : side.overall >= 60 ? "d-wa" : "d-er"} d={`across ${num(side.counted)} record${side.counted === 1 ? "" : "s"}`} />
          <KPI l="Good" v={num(side.good)} d="90% and over" />
          <KPI l="Fair" v={num(side.fair)} cls={side.fair ? "d-wa" : undefined} d="60–89%" />
          <KPI l="Poor" v={num(side.poor)} cls={side.poor ? "d-er" : undefined} d="under 60%" />
        </div>

        <div className="pn" style={{ marginBottom: 12 }}><div className="pnb">
          <div className="st">What is holding the number down</div>
          <div className="sm" style={{ marginBottom: 9 }}>Worst first. Click one to see only the records missing it — a field is usually quicker to fix across forty records than forty records are one at a time.</div>
          <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Field</th><th style={{ width: 230 }}>On file</th><th className="n">Have it</th><th>Why it matters</th><th style={{ width: 90 }}></th></tr></thead><tbody>
            {side.fields.map((f) => <tr key={f.key} style={{ cursor: "default", background: only === f.key ? "var(--ac-bg)" : undefined }}>
              <td className="w">{f.label}{f.weight >= 4 ? <span className="bd b-wa" style={{ marginLeft: 6 }}>counts most</span> : null}</td>
              <td><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1 }}><Bar pct={f.pct} color={band(f.pct).col} /></div><span className="tab" style={{ width: 42, textAlign: "right", fontWeight: 600 }}>{f.pct}%</span></div></td>
              <td className="n tab sm">{f.ok}/{f.applies}</td>
              <td className="sm">{f.hint}</td>
              <td>{f.pct < 100 && <button className="b b-o b-s" onClick={() => setOnly(only === f.key ? null : f.key)}>{only === f.key ? "Clear" : "Show"}</button>}</td>
            </tr>)}
          </tbody></table>
        </div></div>

        <div className="tbar">
          <span className="sm">{only ? <>Showing only the {rows.length} missing <b>{side.fields.find((f) => f.key === only)?.label}</b></> : <>Every record, worst first</>}</span>
          {only && <button className="b b-g b-s" onClick={() => setOnly(null)}>Show all <Icon n="x" s={11} /></button>}
          <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{rows.length} shown</span>
        </div>

        <div className="gw"><table className="dg"><thead><tr>
          <th>{tab === "customers" ? "Firm" : "Supplier"}</th><th>Code</th><th style={{ width: 190 }}>Complete</th><th>What is missing</th>
        </tr></thead><tbody>
          {rows.length ? rows.map((r) => { const rb = band(r.score); return <tr key={r.id} onClick={() => open(r)}>
            <td className="w"><span className="rid">{r.name}</span></td>
            <td className="tab">{r.code ?? <span className="sm">—</span>}</td>
            <td><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1 }}><Bar pct={r.score} color={rb.col} /></div><span className={"bd " + rb.cls} style={{ minWidth: 46, textAlign: "center" }}>{r.score}%</span></div></td>
            <td className="w" style={{ whiteSpace: "normal" }}>{r.missing.length
              ? r.missing.map((m) => <span key={m.key} className="chip" style={{ marginRight: 5 }}>{m.label}</span>)
              : <span className="sm" style={{ color: "var(--ok)" }}>Nothing — this record is complete</span>}</td>
          </tr>; })
            : <tr><td colSpan={4}><Empty t="Nothing to mend" d="Every record here has what it needs." /></td></tr>}
        </tbody></table></div>

        <Note style={{ marginTop: 11 }}>
          The score is <b>weighted</b>: a missing phone number is not the same size of problem as a missing map pin, and averaging them as though they were would make the number useless. A field that genuinely does not apply is left out rather than counted against — an unregistered shop has no GSTIN and is not marked down for it, because a score that can never reach 100 is one everybody learns to ignore.
        </Note>
      </>}
    </div>
  </>;
}
