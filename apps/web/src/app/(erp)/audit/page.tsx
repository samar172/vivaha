"use client";
import { useState } from "react";
import { fDT } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { exportCsv } from "@/lib/csv";
interface A { id: string; actor: string; action: string; entityType: string; entityId: string; oldValue: string; newValue: string; reason: string; createdAt: string }
export default function AuditPage() {
  const [q, setQ] = useState(""); const { data } = useApi<A[]>(`/api/audit-logs?q=${encodeURIComponent(q)}`); const rows = data ?? []; const pg = usePager(rows, 20); useFooter(rows.length, "", pg.page, pg.pages, pg.setPage);
  return <>
    <PageHead crumb={["Insight", "Audit Log"]} title="Audit log" sub={`${rows.length} recorded events · append-only, cannot be edited or deleted by any role`} actions={<button className="b b-o" onClick={() => exportCsv("audit", ["When", "Actor", "Action", "Entity", "Id", "Before", "After", "Reason"], rows.map((a) => [fDT(a.createdAt), a.actor, a.action, a.entityType, a.entityId, a.oldValue, a.newValue, a.reason]))}>⤓ Export</button>} />
    <div className="wa"><div className="tbar"><div className="tsr">🔍<input placeholder="Actor, action, entity or reason…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="gw"><table className="dg"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Before</th><th>After</th><th>Reason</th></tr></thead><tbody>{pg.rows.map((a) => <tr key={a.id} style={{ cursor: "default" }}><td className="sm">{fDT(a.createdAt)}</td><td>{a.actor}</td><td style={{ color: "var(--t9)", fontWeight: 500 }}>{a.action}</td><td className="w">{a.entityType}<div className="sm">{a.entityId}</div></td><td className="sm" style={{ fontFamily: "inherit" }}>{a.oldValue || "—"}</td><td className="sm" style={{ fontFamily: "inherit" }}>{a.newValue || "—"}</td><td className="w" style={{ whiteSpace: "normal", maxWidth: 260 }}>{a.reason || "—"}</td></tr>)}</tbody></table></div></div>
  </>;
}
