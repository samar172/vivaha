"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { num } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useFooter, usePager } from "@/components/Shell";
import { PageHead } from "@/components/PageHead";
import { KPI, Empty, Note } from "@/components/ui";
import { Icon } from "@/components/icons";
import { exportCsv } from "@/lib/csv";

// Who runs what, across every firm.
//
// The machines have always been on the customer record, which answers "what
// does this firm run". It never answered the question that actually comes up —
// who runs an offset press — which is what you need when a consumable lands, a
// service round is planned, or a machine-specific offer is going out. Same
// data, turned the other way round.

interface Machine {
  id: string; type: string; make: string; model: string; serial: string;
  status: string; colours: string; ink: string; spec: Record<string, string>;
  customer: { id: string; code: string | null; name: string; tehsil: string; phone: string; group: string; contactName: string; salesExec: { name: string } | null };
}

const STATUS_CLS: Record<string, string> = { Running: "b-ok", Idle: "b-nu", "Under repair": "b-wa", Retired: "b-er" };

export default function MachinesPage() {
  const { data } = useApi<Machine[]>("/api/customers/machines");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const all = useMemo(() => data ?? [], [data]);
  const types = useMemo(() => [...new Set(all.map((m) => m.type))].sort(), [all]);
  const statuses = useMemo(() => [...new Set(all.map((m) => m.status).filter(Boolean))].sort(), [all]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter((m) =>
      (type === "ALL" || m.type === type) &&
      (status === "ALL" || m.status === status) &&
      (!t || [m.type, m.make, m.model, m.serial, m.ink, m.colours, m.customer.name, m.customer.tehsil, m.customer.code ?? ""].join(" ").toLowerCase().includes(t)));
  }, [all, q, type, status]);

  const pg = usePager(rows);
  useFooter(rows.length, type === "ALL" ? "" : type, pg.page, pg.pages, pg.setPage);

  // Firms, not machines — one firm with three presses is one customer to ring.
  const firms = new Set(rows.map((m) => m.customer.id)).size;
  const running = rows.filter((m) => m.status === "Running").length;
  const attention = rows.filter((m) => m.status === "Under repair" || m.status === "Idle").length;

  return <>
    <PageHead
      crumb={["Sales", "Machines"]}
      title="Machines on the floor"
      sub="Every press, plotter and binder our customers run — and who runs it. The same records the customer screen holds, turned round to answer who rather than what."
      actions={<button className="b b-o" onClick={() => exportCsv("machines", ["Type", "Make", "Model", "Serial", "Status", "Colours", "Ink", "Firm", "Code", "Tehsil", "Phone", "Sales exec"], rows.map((m) => [m.type, m.make, m.model, m.serial, m.status, m.colours, m.ink, m.customer.name, m.customer.code ?? "", m.customer.tehsil, m.customer.phone, m.customer.salesExec?.name ?? ""]))}><Icon n="download" s={13} /> Export</button>}
    />
    <div className="wa">
      <div className="kpis c4">
        <KPI l="Machines" v={num(rows.length)} d={type === "ALL" ? "across every type" : type} />
        <KPI l="Firms running them" v={num(firms)} d="one firm may run several" />
        <KPI l="Running" v={num(running)} cls={running ? "d-ok" : undefined} />
        <KPI l="Idle or under repair" v={num(attention)} cls={attention ? "d-wa" : undefined} d={attention ? "worth a call" : "nothing down"} />
      </div>

      <div className="tbar" style={{ flexWrap: "wrap" }}>
        <div className="tsr"><Icon n="search" s={13} /><input placeholder="Make, model, serial, firm or town…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="ptab">
          <button className={type === "ALL" ? "on" : ""} onClick={() => setType("ALL")}>All <b>{all.length}</b></button>
          {types.map((t) => <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>{t} <b>{all.filter((m) => m.type === t).length}</b></button>)}
        </span>
        {statuses.length > 0 && <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 8px" }}>
          <option value="ALL">Any condition</option>
          {statuses.map((s) => <option key={s}>{s}</option>)}
        </select>}
        {(q || type !== "ALL" || status !== "ALL") && <button className="b b-g b-s" onClick={() => { setQ(""); setType("ALL"); setStatus("ALL"); }}>Clear <Icon n="x" s={11} /></button>}
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{rows.length} shown</span>
      </div>

      <div className="gw"><table className="dg"><thead><tr>
        <th>Machine</th><th>Make &amp; model</th><th>Serial</th><th>Condition</th><th>Firm</th><th>Town</th><th>Phone</th><th>Sales exec</th>
      </tr></thead><tbody>
        {pg.rows.length ? pg.rows.map((m) => <tr key={m.id} onClick={() => router.push(`/customers/${m.customer.id}`)}>
          <td className="w"><span className="rid">{m.type}</span>{m.colours ? <div className="sm">{m.colours} colour{m.colours === "1" ? "" : "s"}{m.ink ? ` · ${m.ink}` : ""}</div> : null}</td>
          <td className="w">{m.make || <span className="sm">—</span>}{m.model ? <div className="sm">{m.model}</div> : null}</td>
          <td className="sm tab">{m.serial || "—"}</td>
          <td>{m.status ? <span className={"bd " + (STATUS_CLS[m.status] ?? "b-nu")}>{m.status}</span> : <span className="sm">—</span>}</td>
          <td className="w">{m.customer.code ? <span className="tab" style={{ color: "var(--t4)", marginRight: 5 }}>{m.customer.code}</span> : null}{m.customer.name}<div className="sm">{m.customer.contactName} · {m.customer.group}</div></td>
          <td>{m.customer.tehsil}</td>
          <td className="sm tab">{m.customer.phone}</td>
          <td className="sm">{m.customer.salesExec?.name ?? "—"}</td>
        </tr>) : <tr><td colSpan={8}><Empty t="No machines" d={all.length ? "Nothing matches that search." : "Machines are recorded against a firm — add them from the customer screen."} /></td></tr>}
      </tbody></table></div>

      <Note style={{ marginTop: 11 }}>A machine is part of the firm&apos;s record, so it is added and edited from the customer screen — this is the same information read the other way round. A row opens the firm that runs it.</Note>
    </div>
  </>;
}
