"use client";
import { useState } from "react";
import { money, num, fDate, dueLbl, daysTo, JOB_STATUSES, JOB_STATUS_LABEL, type JobStatus } from "@vivaha/shared";
import { useApi, refresh } from "@/lib/hooks";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { Pill, DF, Section, DrawerFrame, ModalFrame, Field, Note } from "@/components/ui";
import type { Customer, ItemView } from "@/components/types";

interface Job { id: string; status: JobStatus; qty: number; quote: number; requiredBy: string; text: string; proofs: number; createdAt: string; customer: { id: string; name: string }; baseItem: { id: string; sku: string; name: string; landedCost: number; uom: string }; processItem: { id: string; sku: string; name: string }; costing: { wastagePct: number; waste: number; baseCards: number; baseCost: number; processRate: number; processCost: number; setup: number; cost: number; margin: number } }
const FL: JobStatus[] = JOB_STATUSES.filter((s) => s !== "ENQUIRY");

export default function JobsPage() {
  const { data } = useApi<Job[]>("/api/jobs"); const { openDrawer, openModal, toast } = useUI(); const rows = data ?? []; useFooter(rows.length);
  return <>
    <PageHead crumb={["Sales", "Job Work"]} title="Job work" sub="Overprinting party names onto stock cards · no stock of its own, base cards drawn through a normal outward movement" actions={<button className="b b-p" onClick={() => openModal(<JobForm />, "w")}>+ New job</button>} />
    <div className="wa"><Note k="w" style={{ marginBottom: 11 }}>Printing cannot start without a recorded proof approval — this is the single largest source of disputes in the trade.</Note>
      <div className="gw"><table className="dg"><thead><tr><th>Job</th><th>Firm</th><th>Base card</th><th>Process</th><th className="n">Qty</th><th className="n">Quote</th><th>Required by</th><th>Proofs</th><th>Status</th><th></th></tr></thead><tbody>
        {rows.map((j) => { const rd = daysTo(j.requiredBy); return <tr key={j.id} onClick={() => openDrawer(<JobDrawer id={j.id} />)}><td><span className="rid">{j.id}</span><div className="sm">{fDate(j.createdAt)}</div></td><td className="w">{j.customer.name}</td><td className="w">{j.baseItem.sku}<div className="sm">{j.baseItem.name}</div></td><td className="w">{j.processItem.name}</td><td className="n tab">{num(j.qty)}</td><td className="n tab">{money(j.quote)}</td><td style={{ color: rd <= 7 ? "var(--er)" : "inherit" }}>{fDate(j.requiredBy)}<div className="sm">{dueLbl(j.requiredBy)}</div></td><td className="tab">{j.proofs}</td><td><Pill s={j.status} text={JOB_STATUS_LABEL[j.status]} /></td><td>{j.status === "PROOF_SENT" ? <button className="b b-o b-s" onClick={(e) => { e.stopPropagation(); toast("Waiting on customer approval in portal", "i"); }}>Awaiting approval</button> : j.status === "QUOTED" ? <button className="b b-o b-s" onClick={(e) => { e.stopPropagation(); toast("Quote resent on WhatsApp", "s"); }}>Resend quote</button> : null}</td></tr>; })}
      </tbody></table></div></div>
  </>;
}
function JobDrawer({ id }: { id: string }) {
  const { data: j } = useApi<Job>(`/api/jobs/${id}`); const { closeDrawer, toast } = useUI();
  if (!j) return <div className="drb">Loading…</div>;
  const idx = FL.indexOf(j.status), c = j.costing, next = JOB_STATUSES[JOB_STATUSES.indexOf(j.status) + 1];
  const move = async (to: JobStatus) => { try { await post(`/api/jobs/${j.id}/status`, { to }); toast(`${j.id} → ${JOB_STATUS_LABEL[to]}`, "s"); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  const label: Partial<Record<JobStatus, string>> = { ACCEPTED: "Mark accepted", PROOF_SENT: "Upload proof", APPROVED_PROOF: "Record proof approval", PRINTING: "Start printing (draw base cards)", QC: "Move to QC", READY: "Mark ready", DELIVERED: "Delivered" };
  return <DrawerFrame onClose={closeDrawer} head={<><span className="rid" style={{ fontSize: 13 }}>{j.id}</span><Pill s={j.status} text={JOB_STATUS_LABEL[j.status]} /></>} actions={next ? <button className="b b-p b-s" onClick={() => move(next)}>{label[next] ?? JOB_STATUS_LABEL[next]}</button> : null}>
    <Section><div className="stp">{FL.map((s, i) => <span key={s} style={{ display: "contents" }}><div className={"s " + (i < idx ? "dn" : i === idx ? "ac" : "")}><div className="d">{i < idx ? "✓" : i + 1}</div>{i === idx ? JOB_STATUS_LABEL[s] : ""}</div>{i < FL.length - 1 && <div className="ln" />}</span>)}</div></Section>
    <Section t="Job"><DF k="Firm" v={j.customer.name} /><DF k="Base card" v={`${j.baseItem.sku} · ${j.baseItem.name}`} /><DF k="Process" v={j.processItem.name} /><DF k="Quantity" v={num(j.qty) + " pcs"} /><DF k="Wastage allowance" v={`${c.wastagePct}% · ${num(c.waste)} extra base cards`} /><DF k="Base cards to draw" v={num(c.baseCards)} /><DF k="Required by" v={`${fDate(j.requiredBy)} · ${dueLbl(j.requiredBy)}`} /><DF k="Proof revisions" v={j.proofs} /></Section>
    <Section t="Text to print"><div style={{ background: "var(--panel-2)", border: "1px solid var(--bd)", borderRadius: 5, padding: 10, fontSize: 12.5, lineHeight: 1.6 }}>{j.text}</div></Section>
    <Section t="Costing"><DF k={`Base cards ${num(c.baseCards)} × ${money(j.baseItem.landedCost)}`} v={money(c.baseCost)} mono /><DF k={`Process ${num(j.qty)} × ${money(c.processRate)}`} v={money(c.processCost)} mono /><DF k="Setup charge" v={money(c.setup)} mono /><DF k="Quoted" v={money(j.quote)} mono strong /><DF k="Estimated margin" v={<span style={{ color: c.margin < .18 ? "var(--er)" : "var(--ok)" }}>{Math.round(c.margin * 100)}%</span>} mono /></Section>
  </DrawerFrame>;
}
function JobForm() {
  const { closeModal, toast } = useUI(); const { data: custs } = useApi<Customer[]>("/api/customers"); const { data: items } = useApi<{ items: ItemView[] }>("/api/items");
  const bases = (items?.items ?? []).filter((i) => i.lineId === "L1" && i.status === "ACTIVE"), procs = (items?.items ?? []).filter((i) => i.lineId === "L4");
  const [f, setF] = useState(() => ({ customerId: "", baseItemId: "", processItemId: "", qty: 500, requiredBy: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), text: "", quote: 0 }));
  const go = async () => { try { await post("/api/jobs", { ...f, customerId: f.customerId || custs?.[0]?.id, baseItemId: f.baseItemId || bases[0]?.id, processItemId: f.processItemId || procs[0]?.id, qty: Number(f.qty), quote: f.quote || undefined }); toast("Job quoted", "s"); closeModal(); refresh("/api/jobs"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="New job order" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Create quote</button></>}><div className="fg"><Field label="Firm" full><select value={f.customerId || custs?.[0]?.id} onChange={(e) => setF({ ...f, customerId: e.target.value })}>{custs?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Base card"><select value={f.baseItemId || bases[0]?.id} onChange={(e) => setF({ ...f, baseItemId: e.target.value })}>{bases.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></Field><Field label="Process"><select value={f.processItemId || procs[0]?.id} onChange={(e) => setF({ ...f, processItemId: e.target.value })}>{procs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field><Field label="Quantity"><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field><Field label="Required by"><input type="date" value={f.requiredBy} onChange={(e) => setF({ ...f, requiredBy: e.target.value })} /></Field><Field label="Quote (₹, blank = cost + 30%)"><input type="number" value={f.quote || ""} onChange={(e) => setF({ ...f, quote: Number(e.target.value) })} /></Field><Field label="Text to print" full><textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Vikram weds Anjali · 28 Nov 2026 · Hotel Lallgarh Palace, Bikaner" /></Field></div></ModalFrame>;
}
