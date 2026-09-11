"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { money, num, fDate, dueLbl, daysTo, JOB_STATUSES, JOB_STATUS_LABEL, type JobStatus } from "@vivaha/shared";
import { useApi, useGodowns, refresh, useLines } from "@/lib/hooks";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { Pill, DF, Section, ModalFrame, Field, Note } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { Customer, ItemView } from "@/components/types";

interface Job { id: string; status: JobStatus; qty: number; quote: number; requiredBy: string; text: string; proofs: number; createdAt: string; customer: { id: string; name: string }; baseItem: { id: string; sku: string; name: string; landedCost: number; uom: string }; processItem: { id: string; sku: string; name: string }; costing: { wastagePct: number; waste: number; baseCards: number; baseCost: number; processRate: number; processCost: number; setup: number; cost: number; margin: number } }
const FL: JobStatus[] = JOB_STATUSES.filter((s) => s !== "ENQUIRY");

export default function JobsPage() {
  const { data } = useApi<Job[]>("/api/jobs"); const { openModal, toast } = useUI(); const router = useRouter(); const rows = data ?? []; useFooter(rows.length);
  return <>
    <PageHead crumb={["Sales", "Job Work"]} title="Job work" sub="Overprinting party names onto stock cards · no stock of its own, base cards drawn through a normal outward movement" actions={<button className="b b-p" onClick={() => openModal(<JobForm />, "w")}>+ New job</button>} />
    <div className="wa"><Note k="w" style={{ marginBottom: 11 }}>Printing cannot start without a recorded proof approval — this is the single largest source of disputes in the trade.</Note>
      <div className="gw"><table className="dg"><thead><tr><th>Job</th><th>Firm</th><th>Base card</th><th>Process</th><th className="n">Qty</th><th className="n">Quote</th><th>Required by</th><th>Proofs</th><th>Status</th><th></th></tr></thead><tbody>
        {rows.map((j) => { const rd = daysTo(j.requiredBy); return <tr key={j.id} onClick={() => router.push(`/jobs/${j.id}`)}><td><span className="rid">{j.id}</span><div className="sm">{fDate(j.createdAt)}</div></td><td className="w">{j.customer.name}</td><td className="w">{j.baseItem.sku}<div className="sm">{j.baseItem.name}</div></td><td className="w">{j.processItem.name}</td><td className="n tab">{num(j.qty)}</td><td className="n tab">{money(j.quote)}</td><td style={{ color: rd <= 7 ? "var(--er)" : "inherit" }}>{fDate(j.requiredBy)}<div className="sm">{dueLbl(j.requiredBy)}</div></td><td className="tab">{j.proofs}</td><td><Pill s={j.status} text={JOB_STATUS_LABEL[j.status]} /></td><td>{j.status === "PROOF_SENT" ? <button className="b b-o b-s" onClick={(e) => { e.stopPropagation(); toast("Waiting on customer approval in portal", "i"); }}>Awaiting approval</button> : j.status === "QUOTED" ? <button className="b b-o b-s" onClick={(e) => { e.stopPropagation(); toast("Quote resent on WhatsApp", "s"); }}>Resend quote</button> : null}</td></tr>; })}
      </tbody></table></div></div>
  </>;
}
export function JobDetail({ id }: { id: string }) {
  const { data: j } = useApi<Job>(`/api/jobs/${id}`); const { toast } = useUI();
  const router = useRouter();
  useFooter(null);
  const { data: godowns } = useGodowns();
  const { data: base } = useApi<ItemView>(j ? `/api/items/${j.baseItem.id}` : null);
  const [gd, setGd] = useState("");
  if (!j) return <div className="wa"><div className="sm">Loading…</div></div>;
  const idx = FL.indexOf(j.status), c = j.costing, next = JOB_STATUSES[JOB_STATUSES.indexOf(j.status) + 1];
  const move = async (to: JobStatus) => { try { await post(`/api/jobs/${j.id}/status`, { to, godownId: to === "PRINTING" && gd ? gd : undefined }); toast(`${j.id} → ${JOB_STATUS_LABEL[to]}`, "s"); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  const label: Partial<Record<JobStatus, string>> = { ACCEPTED: "Mark accepted", PROOF_SENT: "Upload proof", APPROVED_PROOF: "Record proof approval", PRINTING: "Start printing (draw base cards)", QC: "Move to QC", READY: "Mark ready", DELIVERED: "Delivered" };
  return <>
    <PageHead
      crumb={["Sales", "Job Work", j.id]}
      title={`${j.id} — ${j.customer.name}`}
      sub={<>{JOB_STATUS_LABEL[j.status]} · {j.baseItem.sku} through {j.processItem.name} · {num(j.qty)} {j.baseItem.uom.toLowerCase()}</>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/jobs")}><Icon n="chevronL" s={13} /> Back to job work</button>
        {next ? <button className="b b-p" onClick={() => move(next)}>{label[next] ?? JOB_STATUS_LABEL[next]}</button> : null}
      </>}
    />
    <div className="wa">
    <Section><div className="stp">{FL.map((s, i) => <span key={s} style={{ display: "contents" }}><div className={"s " + (i < idx ? "dn" : i === idx ? "ac" : "")}><div className="d">{i < idx ? <Icon n="check" s={11} /> : i + 1}</div>{i === idx ? JOB_STATUS_LABEL[s] : ""}</div>{i < FL.length - 1 && <div className="ln" />}</span>)}</div></Section>
    {next === "PRINTING" && <Section t="Base cards to draw">
      <DF k="Needed for this run" v={`${num(c.baseCards)} ${j.baseItem.uom.toLowerCase()}`} mono />
      {base?.godowns.map((g) => <DF key={g.godownId} k={godowns?.find((x) => x.id === g.godownId)?.name ?? g.godownId} v={num(g.available) + " available"} mono />)}
      {base && <DF k="Total available" v={<span style={{ color: base.available < c.baseCards ? "var(--er)" : "var(--ok)" }}>{num(base.available)}</span>} mono strong />}
      <Field label="Draw from"><select value={gd} onChange={(e) => setGd(e.target.value)}><option value="">Split across godowns, deepest first</option>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      {base && base.available < c.baseCards
        ? <Note k="w" style={{ marginTop: 9 }}>Short by {num(c.baseCards - base.available)} {j.baseItem.uom.toLowerCase()} across every godown — receive stock before starting this run.</Note>
        : <Note style={{ marginTop: 9 }}>Leave this on the split and the run draws from the deepest godown first. Name one godown only if the whole run has to be picked from that floor.</Note>}
    </Section>}
    <Section t="Job"><DF k="Firm" v={j.customer.name} /><DF k="Base card" v={`${j.baseItem.sku} · ${j.baseItem.name}`} /><DF k="Process" v={j.processItem.name} /><DF k="Quantity" v={num(j.qty) + " pcs"} /><DF k="Wastage allowance" v={`${c.wastagePct}% · ${num(c.waste)} extra base cards`} /><DF k="Base cards to draw" v={num(c.baseCards)} /><DF k="Required by" v={`${fDate(j.requiredBy)} · ${dueLbl(j.requiredBy)}`} /><DF k="Proof revisions" v={j.proofs} /></Section>
    <Section t="Text to print"><div style={{ background: "var(--panel-2)", border: "1px solid var(--bd)", borderRadius: 5, padding: 10, fontSize: 14, lineHeight: 1.6 }}>{j.text}</div></Section>
    <Section t="Costing"><DF k={`Base cards ${num(c.baseCards)} × ${money(j.baseItem.landedCost)}`} v={money(c.baseCost)} mono /><DF k={`Process ${num(j.qty)} × ${money(c.processRate)}`} v={money(c.processCost)} mono /><DF k="Setup charge" v={money(c.setup)} mono /><DF k="Quoted" v={money(j.quote)} mono strong /><DF k="Estimated margin" v={<span style={{ color: c.margin < .18 ? "var(--er)" : "var(--ok)" }}>{Math.round(c.margin * 100)}%</span>} mono /></Section>
    </div>
  </>;
}
function JobForm() {
  const { closeModal, toast } = useUI(); const { data: custs } = useApi<Customer[]>("/api/customers"); const { data: items } = useApi<{ items: ItemView[] }>("/api/items"); const { data: lines } = useLines();
  // Job work overprints a stock card with a process. Both sides are found by
  // what the line *is* — the cards line, and whichever line does job work —
  // rather than by an id that happens to be L1 and L4 today.
  const cardsLineId = lines?.find((l) => l.code === "cards")?.id;
  const jobLineIds = new Set((lines ?? []).filter((l) => l.workflow === "JOBWORK").map((l) => l.id));
  const bases = (items?.items ?? []).filter((i) => i.lineId === cardsLineId && i.status === "ACTIVE");
  const procs = (items?.items ?? []).filter((i) => jobLineIds.has(i.lineId));
  const [f, setF] = useState(() => ({ customerId: "", baseItemId: "", processItemId: "", qty: 500, requiredBy: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), text: "", quote: 0 }));
  const go = async () => { try { await post("/api/jobs", { ...f, customerId: f.customerId || custs?.[0]?.id, baseItemId: f.baseItemId || bases[0]?.id, processItemId: f.processItemId || procs[0]?.id, qty: Number(f.qty), quote: f.quote || undefined }); toast("Job quoted", "s"); closeModal(); refresh("/api/jobs"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="New job order" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Create quote</button></>}><div className="fg"><Field label="Firm" full><select value={f.customerId || custs?.[0]?.id} onChange={(e) => setF({ ...f, customerId: e.target.value })}>{custs?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Base card"><select value={f.baseItemId || bases[0]?.id} onChange={(e) => setF({ ...f, baseItemId: e.target.value })}>{bases.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></Field><Field label="Process"><select value={f.processItemId || procs[0]?.id} onChange={(e) => setF({ ...f, processItemId: e.target.value })}>{procs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field><Field label="Quantity"><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field><Field label="Required by"><input type="date" value={f.requiredBy} onChange={(e) => setF({ ...f, requiredBy: e.target.value })} /></Field><Field label="Quote (₹, blank = cost + 30%)"><input type="number" value={f.quote || ""} onChange={(e) => setF({ ...f, quote: Number(e.target.value) })} /></Field><Field label="Text to print" full><textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Vikram weds Anjali · 28 Nov 2026 · Hotel Lallgarh Palace, Bikaner" /></Field></div></ModalFrame>;
}
