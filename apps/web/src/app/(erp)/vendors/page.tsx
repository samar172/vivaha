"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { money, num } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI } from "@/lib/ui";
import { PageHead } from "@/components/PageHead";
import { useFooter, usePager } from "@/components/Shell";
import { KPI, Empty, Note } from "@/components/ui";
import { Icon } from "@/components/icons";
import { exportCsv } from "@/lib/csv";
import { VendorForm } from "@/app/(erp)/purchase/page";

// What we owe our suppliers, and to whom.
//
// This existed only as a tab inside Purchase & GRN, which is where you go to
// key a goods receipt — not where you go to ask who is owed money. It is its
// own screen now, and each row opens the supplier's statement.

interface V { id: string; code: string | null; name: string; gstin: string | null; terms: string; city: string; phone: string; documents: number; purchased: number; invoiced: number; paid: number; outstanding: number; oldestDays: number }

export default function VendorsPage() {
  const { data } = useApi<V[]>("/api/masters/vendors");
  const { can } = useAuth(); const { openModal } = useUI(); const router = useRouter();
  const [q, setQ] = useState("");
  const [owingOnly, setOwingOnly] = useState(false);

  const all = data ?? [];
  const ql = q.trim().toLowerCase();
  let rows = ql ? all.filter((v) => (v.name + (v.code ?? "") + v.city + (v.gstin ?? "") + v.phone).toLowerCase().includes(ql)) : all;
  if (owingOnly) rows = rows.filter((v) => v.outstanding > 0);
  rows = [...rows].sort((a, b) => b.outstanding - a.outstanding);
  const pg = usePager(rows);
  useFooter(rows.length, "", pg.page, pg.pages, pg.setPage);

  const owed = all.reduce((s, v) => s + Math.max(0, v.outstanding), 0);
  const owing = all.filter((v) => v.outstanding > 0).length;
  const overdue = all.filter((v) => v.outstanding > 0 && v.oldestDays > 60).length;

  return <>
    <PageHead
      crumb={["Supply", "Vendor ledger"]}
      title="Vendor ledger"
      sub="What each supplier has billed us, what we have paid, and what is still open. Open a row for the statement behind the figure."
      actions={<><button className="b b-o" onClick={() => exportCsv("vendor-ledger", ["Code", "Vendor", "City", "Terms", "Documents", "Invoiced", "Paid", "Outstanding", "Oldest"], rows.map((v) => [v.code ?? "", v.name, v.city, v.terms, v.documents, v.invoiced, v.paid, v.outstanding, v.oldestDays]))}><Icon n="download" s={13} /> Export</button>{can("purchase.create") && <button className="b b-p" onClick={() => openModal(<VendorForm />)}>+ New vendor</button>}</>}
    />
    <div className="wa">
      <div className="kpis c4">
        <KPI l="Suppliers" v={num(all.length)} d={`${owing} with something open`} />
        <KPI l="Owed to suppliers" v={money(owed)} cls={owed ? "d-wa" : undefined} />
        <KPI l="Billed to us" v={money(all.reduce((s, v) => s + v.invoiced, 0))} />
        <KPI l="Over 60 days" v={num(overdue)} cls={overdue ? "d-er" : undefined} d={overdue ? "suppliers waiting" : "nothing long overdue"} onClick={() => setOwingOnly(true)} />
      </div>

      <div className="tbar">
        <div className="tsr"><Icon n="search" s={13} /><input placeholder="Supplier, code or city…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="sm" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input className="ck" type="checkbox" checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} /> Only those we owe
        </label>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{rows.length} shown</span>
      </div>

      <div className="gw"><table className="dg"><thead><tr>
        <th>Supplier</th><th>Code</th><th>City</th><th>Terms</th><th className="n">Documents</th>
        <th className="n">Billed</th><th className="n">Paid</th><th className="n">Outstanding</th><th className="n">Oldest</th>
      </tr></thead><tbody>
        {pg.rows.length ? pg.rows.map((v) => <tr key={v.id} onClick={() => router.push(`/vendors/${v.id}`)}>
          <td className="w"><span className="rid">{v.name}</span><div className="sm">{v.gstin ?? "Unregistered"}</div></td>
          <td className="tab">{v.code ?? <span className="sm">—</span>}</td>
          <td>{v.city}</td><td>{v.terms}</td>
          <td className="n tab">{v.documents}</td>
          <td className="n tab">{money(v.invoiced)}</td>
          <td className="n tab" style={{ color: "var(--ok)" }}>{money(v.paid)}</td>
          <td className="n tab" style={{ fontWeight: 700, color: v.outstanding > 0 ? "var(--t9)" : "var(--t4)" }}>{money(v.outstanding)}</td>
          <td className="n tab" style={{ color: v.outstanding > 0 && v.oldestDays > 60 ? "var(--er)" : "var(--t6)" }}>{v.outstanding > 0 ? `${v.oldestDays} d` : "—"}</td>
        </tr>) : <tr><td colSpan={9}><Empty t="No suppliers" d="Add one from Purchase & GRN, or with the button above." /></td></tr>}
      </tbody></table></div>

      <Note style={{ marginTop: 11 }}>A supplier&apos;s balance runs the other way from a customer&apos;s: a purchase puts us in credit to them and a payment takes it back. A payment a customer made to them directly on our behalf shows here as an ordinary payment carrying our own reference — the supplier is never told whose money it was.</Note>
    </div>
  </>;
}
