"use client";
import { useState } from "react";
import { money, money2, num, fDate } from "@vivaha/shared";
import { useApi, useGodowns, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { Pill, DF, ModalFrame, Field, Note } from "@/components/ui";
import { exportCsv } from "@/lib/csv";
import { Icon } from "@/components/icons";

interface Ret { id: string; orderId: string; qty: number; reason: string; hasPhoto: boolean; status: string; outcome: string | null; creditAmount: number | null; creditNoteNo: string | null; createdAt: string; item: { sku: string; name: string; uom: string }; customer: { id: string; name: string } }
export default function ReturnsPage() {
  const { data } = useApi<Ret[]>("/api/returns"); const { can } = useAuth(); const { openModal, toast } = useUI(); const rows = data ?? []; useFooter(rows.length);
  const start = async (r: Ret) => { try { await post(`/api/returns/${r.id}/start-inspection`); toast(`${r.id} received — inspect to decide the bucket`, "s"); refresh("/api/returns"); } catch (e) { toast(errMsg(e), "e"); } };
  return <>
    <PageHead crumb={["Sales", "Returns"]} title="Returns & credit notes" sub="Requested → Received → Inspected → Accepted or Rejected → Credit note. Stock re-enters only on an inspection outcome." actions={<button className="b b-o" onClick={() => exportCsv("returns", ["Return", "Order", "Firm", "Item", "Qty", "Reason", "Status", "Outcome", "Credit"], rows.map((r) => [r.id, r.orderId, r.customer.name, r.item.sku, r.qty, r.reason, r.status, r.outcome, r.creditAmount]))}><Icon n="download" s={13} /> Export</button>} />
    <div className="wa"><div className="gw"><table className="dg"><thead><tr><th>Return</th><th>Order</th><th>Firm</th><th>Item</th><th className="n">Qty</th><th>Reason</th><th>Status</th><th>Outcome</th><th></th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.id} style={{ cursor: "default" }}><td><span className="rid">{r.id}</span><div className="sm">{fDate(r.createdAt)}</div></td><td className="sm">{r.orderId}</td><td className="w">{r.customer.name}</td><td className="w">{r.item.sku}<div className="sm">{r.item.name}</div></td><td className="n tab">{num(r.qty)}</td><td className="w" style={{ whiteSpace: "normal", maxWidth: 250 }}>{r.reason}{r.hasPhoto && <> <span className="bd b-nu"><Icon n="camera" s={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 3 }} />photo</span></>}</td><td><Pill s={r.status} /></td><td>{r.outcome ? <><Pill s={r.outcome} text={r.outcome} /> <span className="sm">{r.creditAmount ? money(r.creditAmount) + " · " + r.creditNoteNo : ""}</span></> : "—"}</td><td>{can("return.process") && r.status === "REQUESTED" && <button className="b b-o b-s" onClick={() => start(r)}>Mark received</button>}{can("return.process") && r.status === "INSPECTION" && <button className="b b-p b-s" onClick={() => openModal(<InspectModal r={r} />, "n")}>Inspect</button>}</td></tr>)}
    </tbody></table></div></div>
  </>;
}
function InspectModal({ r }: { r: Ret }) {
  const { closeModal, toast } = useUI(); const { data: godowns } = useGodowns(); const [f, setF] = useState({ outcome: "Good stock", godownId: "GD-A", note: "" });
  const go = async () => { try { const out = await post<{ creditNoteNo?: string; total?: number; rejected?: boolean }>(`/api/returns/${r.id}/inspect`, f); toast(out.rejected ? "Return rejected" : `Credit note ${out.creditNoteNo} posted · ${money2(out.total)} credited`, out.rejected ? "w" : "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Inspect return — " + r.id} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Post outcome</button></>}>
    <Note style={{ marginBottom: 13 }}>The inspection outcome decides the stock bucket. Nothing re-enters available stock automatically — BR-32.</Note>
    <DF k="Item" v={`${r.item.sku} · ${r.item.name}`} /><DF k="Quantity" v={`${num(r.qty)} ${r.item.uom}`} mono /><div style={{ marginBottom: 13 }}><DF k="Customer reason" v={<span style={{ maxWidth: 280 }}>{r.reason}</span>} /></div>
    <Field label="Outcome"><select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}><option value="Good stock">Accept → back to good stock</option><option value="Damaged">Accept → damaged bucket (write-off)</option><option value="Rejected">Reject → return to customer</option></select></Field>
    <Field label="Godown to receive into"><select value={f.godownId} onChange={(e) => setF({ ...f, godownId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
    <Field label="Inspection note (required)"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. 96 of 120 pcs usable, 24 pcs smudged beyond use" /></Field>
  </ModalFrame>;
}
