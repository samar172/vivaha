"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { money } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import { useUI } from "@/lib/ui";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { Pill, LineDot, GateDot } from "@/components/ui";
import { CustomerDrawer, CustomerForm } from "@/components/CustomerDrawer";
import type { Customer } from "@/components/types";
import { exportCsv } from "@/lib/csv";
import { Icon } from "@/components/icons";

export default function CustomersPage() {
  const { line } = useAppState(); const { can } = useAuth(); const { openDrawer, openModal } = useUI(); const sp = useSearchParams();
  const [q, setQ] = useState(""); const [filters, setFilters] = useState<string[]>([]);
  const { data } = useApi<Customer[]>(`/api/customers?line=${line}&q=${encodeURIComponent(q)}&filter=${filters.join(",")}`);
  useEffect(() => { const o = sp.get("open"); if (o) openDrawer(<CustomerDrawer id={o} />); }, [sp, openDrawer]);
  const rows = data ?? []; const pg = usePager(rows); useFooter(rows.length, filters.join(", "), pg.page, pg.pages, pg.setPage);
  const tg = (f: string) => setFilters((fs) => fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]);
  const { data: groups } = useApi<{ name: string; multiplier: number }[]>("/api/masters/pricing-groups"); const mult = (g: string) => groups?.find((x) => x.name === g)?.multiplier ?? "";
  return <>
    <PageHead crumb={["Sales", "Customers"]} title="Customers" sub={`${rows.length} firms · ledger, credit gate and machine profile per firm`} actions={<><button className="b b-o" onClick={() => exportCsv("customers", ["Firm", "Contact", "Tehsil", "Group", "GSTIN", "Limit", "Outstanding", "Oldest days", "Gate"], rows.map((c) => [c.name, c.contactName, c.tehsil, c.group, c.gstin, c.creditLimit, c.gate.out, c.gate.oldestAge, c.gate.restricted ? "Restricted" : "OK"]))}><Icon n="download" s={13} /> Export</button>{can("cust.edit") && <button className="b b-p" onClick={() => openModal(<CustomerForm />, "w")}>+ New customer</button>}</>} />
    <div className="wa">
      <div className="tbar"><div className="tsr"><Icon n="search" s={13} /><input placeholder="Firm, contact, tehsil or GSTIN…" value={q} onChange={(e) => setQ(e.target.value)} /></div><button className="b b-o b-s" onClick={() => tg("gate")}>Past credit gate</button><button className="b b-o b-s" onClick={() => tg("blocked")}>Blocked</button><button className="b b-o b-s" onClick={() => tg("machines")}>Has machines</button>{filters.map((f) => <span className="chip" key={f}>{f}<span className="x" onClick={() => tg(f)}><Icon n="x" s={11} /></span></span>)}</div>
      <div className="gw"><table className="dg"><thead><tr><th>Firm</th><th>Tehsil</th><th>Group</th><th>Lines</th><th>Machines</th><th className="n">Limit</th><th className="n">Outstanding</th><th className="n">Oldest</th><th>Credit gate</th><th>Status</th></tr></thead><tbody>
        {pg.rows.map((c) => { const g = c.gate; return <tr key={c.id} onClick={() => openDrawer(<CustomerDrawer id={c.id} />)}><td className="w"><span className="rid">{c.name}</span><div className="sm">{c.contactName} · {c.gstin ?? "Unregistered"}</div></td><td>{c.tehsil}</td><td>{c.group} ×{mult(c.group)}</td><td>{c.linesEnabled.map((l) => <LineDot key={l} id={l} />)}</td><td className="sm">{c.machines.length ? c.machines.map((m) => m.type).join(", ") : "—"}</td><td className="n tab">{money(c.creditLimit)}</td><td className="n tab" style={{ fontWeight: 600, color: g.out > c.creditLimit ? "var(--er)" : "var(--t9)" }}>{money(g.out)}</td><td className="n tab" style={{ color: g.timeBreach ? "var(--er)" : "var(--t6)" }}>{g.oldestAge ? g.oldestAge + " d" : "—"}</td><td><GateDot status={g.status} /> {g.restricted ? `${g.amountBreach && g.timeBreach ? "Amount + time" : g.amountBreach ? "Amount" : "Time"} · ${g.mode}` : g.status === "near" ? "Near limit" : "OK"}</td><td><Pill s={c.blockReason ? "Blocked" : "Active"} /></td></tr>; })}
      </tbody></table></div>
    </div>
  </>;
}
