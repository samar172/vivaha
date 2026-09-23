"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { money, money2, num, fDate, fDT, itemRef } from "@vivaha/shared";
import { useApi, useGodowns, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { Pill, DF, ModalFrame, Field, Note, Section, Timeline, LineChip } from "@/components/ui";
import { exportCsv } from "@/lib/csv";
import { Icon } from "@/components/icons";

interface Ret { id: string; orderId: string; qty: number; reason: string; hasPhoto: boolean; status: string; outcome: string | null; creditAmount: number | null; creditNoteNo: string | null; createdAt: string; item: { sku: string; name: string; uom: string }; customer: { id: string; name: string } }
export default function ReturnsPage() {
  const { data } = useApi<Ret[]>("/api/returns"); const { can } = useAuth(); const { openModal, toast } = useUI(); const router = useRouter(); const rows = data ?? []; useFooter(rows.length);
  const start = async (r: Ret) => { try { await post(`/api/returns/${r.id}/start-inspection`); toast(`${r.id} received — inspect to decide the bucket`, "s"); refresh("/api/returns"); } catch (e) { toast(errMsg(e), "e"); } };
  return <>
    <PageHead crumb={["Sales", "Returns"]} title="Returns & credit notes" sub="Requested → Received → Inspected → Accepted or Rejected → Credit note. Stock re-enters only on an inspection outcome." actions={<button className="b b-o" onClick={() => exportCsv("returns", ["Return", "Order", "Firm", "Item", "Qty", "Reason", "Status", "Outcome", "Credit"], rows.map((r) => [r.id, r.orderId, r.customer.name, r.item.sku, r.qty, r.reason, r.status, r.outcome, r.creditAmount]))}><Icon n="download" s={13} /> Export</button>} />
    <div className="wa"><div className="gw"><table className="dg"><thead><tr><th>Return</th><th>Order</th><th>Firm</th><th>Item</th><th className="n">Qty</th><th>Reason</th><th>Status</th><th>Outcome</th><th></th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.id} onClick={() => router.push(`/returns/${r.id}`)}><td><span className="rid">{r.id}</span><div className="sm">{fDate(r.createdAt)}</div></td><td className="sm">{r.orderId}</td><td className="w">{r.customer.name}</td><td className="w">{itemRef(r.item)}<div className="sm">{r.item.name}</div></td><td className="n tab">{num(r.qty)}</td><td className="w" style={{ whiteSpace: "normal", maxWidth: 250 }}>{r.reason}{r.hasPhoto && <> <span className="bd b-nu"><Icon n="camera" s={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 3 }} />photo</span></>}</td><td><Pill s={r.status} /></td><td>{r.outcome ? <><Pill s={r.outcome} text={r.outcome} /> <span className="sm">{r.creditAmount ? money(r.creditAmount) + " · " + r.creditNoteNo : ""}</span></> : "—"}</td><td>{can("return.process") && r.status === "REQUESTED" && <button className="b b-o b-s" onClick={(e) => { e.stopPropagation(); start(r); }}>Mark received</button>}{can("return.process") && r.status === "INSPECTION" && <button className="b b-p b-s" onClick={(e) => { e.stopPropagation(); openModal(<InspectModal r={r} />, "n"); }}>Inspect</button>}</td></tr>)}
    </tbody></table></div></div>
  </>;
}
type Inspectable = { id: string; qty: number; reason: string; item: { sku: string; name: string; uom: string } };
function InspectModal({ r }: { r: Inspectable }) {
  const { closeModal, toast } = useUI(); const { data: godowns } = useGodowns(); const [f, setF] = useState({ outcome: "Good stock", godownId: "GD-A", note: "" });
  const go = async () => { try { const out = await post<{ creditNoteNo?: string; total?: number; rejected?: boolean }>(`/api/returns/${r.id}/inspect`, f); toast(out.rejected ? "Return rejected" : `Credit note ${out.creditNoteNo} posted · ${money2(out.total)} credited`, out.rejected ? "w" : "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Inspect return — " + r.id} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Post outcome</button></>}>
    <Note style={{ marginBottom: 13 }}>The inspection outcome decides the stock bucket. Nothing re-enters available stock automatically — BR-32.</Note>
    <DF k="Item" v={`${itemRef(r.item)} · ${r.item.name}`} /><DF k="Quantity" v={`${num(r.qty)} ${r.item.uom}`} mono /><div style={{ marginBottom: 13 }}><DF k="Customer reason" v={<span style={{ maxWidth: 280 }}>{r.reason}</span>} /></div>
    <Field label="Outcome"><select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}><option value="Good stock">Accept → back to good stock</option><option value="Damaged">Accept → damaged bucket (write-off)</option><option value="Rejected">Reject → return to customer</option></select></Field>
    <Field label="Godown to receive into"><select value={f.godownId} onChange={(e) => setF({ ...f, godownId: e.target.value })}>{godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
    <Field label="Inspection note (required)"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. 96 of 120 pcs usable, 24 pcs smudged beyond use" /></Field>
  </ModalFrame>;
}

interface RetFull extends Ret {
  note: string | null;
  resolvedAt: string | null;
  soldRate: number | null;
  soldQty: number | null;
  item: { id: string; sku: string; name: string; uom: string; gstPct: number; lineId: string };
  customer: { id: string; name: string; gstin: string | null; tehsil: string; contactName: string; phone: string };
  order: { id: string; status: string; createdAt: string; total: number };
  godown: { id: string; name: string; short: string } | null;
  credit: { id: string; date: string; ref: string; particular: string; credit: number } | null;
  trail: { at: string; actor: string; action: string; from: string | null; to: string | null; why: string | null }[];
}

// A return is a small document with a long argument behind it — what came back,
// what the firm paid for it, what the inspector decided and why. That reads as a
// page, next to the order it came off, not as a strip down the side of the list.
export function ReturnDetail({ id }: { id: string }) {
  const { data: r } = useApi<RetFull>(`/api/returns/${id}`);
  const { can } = useAuth(); const { openModal, toast } = useUI(); const router = useRouter();
  useFooter(null);
  const start = async () => { try { await post(`/api/returns/${id}/start-inspection`); toast(`${id} received — inspect to decide the bucket`, "s"); refresh("/api/returns"); } catch (e) { toast(errMsg(e), "e"); } };
  if (!r) return <div className="wa"><div className="sm">Loading…</div></div>;

  // What the firm was charged for these pieces. The credit note is worked out
  // from the original order rate, so that is the figure at stake here — not
  // today's rate, which may have moved since.
  const atStake = r.soldRate == null ? null : r.qty * r.soldRate;
  const open = r.status === "REQUESTED" || r.status === "INSPECTION";

  return <>
    <PageHead
      crumb={["Sales", "Returns", r.id]}
      title={`${r.id} — ${r.customer.name}`}
      sub={<>{r.qty} {r.item.uom} of {itemRef(r.item)} off {r.orderId} · raised {fDate(r.createdAt)}{r.resolvedAt ? ` · closed ${fDate(r.resolvedAt)}` : ""}</>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/returns")}><Icon n="chevronL" s={13} /> Back to returns</button>
        <button className="b b-o" onClick={() => router.push(`/orders/${r.orderId}`)}>Open order</button>
        {can("return.process") && r.status === "REQUESTED" && <button className="b b-p" onClick={start}>Mark received</button>}
        {can("return.process") && r.status === "INSPECTION" && <button className="b b-p" onClick={() => openModal(<InspectModal r={r} />, "n")}>Inspect</button>}
      </>}
    />
    <div className="wa">
      <div className="idg">
        <div>
          <div className="pn"><div className="pnb">
            <Section t="What came back">
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start", marginBottom: 13, cursor: "pointer" }} onClick={() => router.push(`/items/${r.item.id}`)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{r.item.name}</div>
                  <div className="sm"><span className="rid">{itemRef(r.item)}</span> · <LineChip id={r.item.lineId} /></div>
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{num(r.qty)} <span className="sm">{r.item.uom}</span></div>
                  {r.soldQty != null && <div className="sm">of {num(r.soldQty)} shipped</div>}
                </div>
              </div>
              <DF k="Reason given" v={<span style={{ whiteSpace: "normal" }}>{r.reason}</span>} />
              <DF k="Photograph" v={r.hasPhoto ? <span className="bd b-nu"><Icon n="camera" s={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 3 }} />sent with the request</span> : "none"} />
              <DF k="Rate charged" v={r.soldRate == null ? "—" : money2(r.soldRate) + " / " + r.item.uom} mono />
              <DF k="Value at stake" v={atStake == null ? "—" : money(atStake)} mono strong />
              <div className="sm" style={{ marginTop: 7 }}>A credit note is raised at the rate on the original order line, plus tax — never at today&apos;s rate.</div>
            </Section>
          </div></div>

          <div className="pn"><div className="pnb">
            <Section t="Inspection">
              {r.outcome
                ? <>
                    <DF k="Outcome" v={<Pill s={r.outcome} text={r.outcome} />} />
                    <DF k="Received into" v={r.godown ? r.godown.name : "—"} />
                    <DF k="Inspector's note" v={<span style={{ whiteSpace: "normal" }}>{r.note ?? "—"}</span>} />
                  </>
                : r.status === "INSPECTION"
                  ? <Note k="w">The goods are in and awaiting inspection. The outcome decides the stock bucket — nothing re-enters available stock on its own (BR-32).</Note>
                  : <Note>Not yet received. Mark it received when the carton is physically in, then inspect it to decide the bucket.</Note>}
            </Section>
          </div></div>

          <div className="pn"><div className="pnb">
            <Section t="History">
              <Timeline rows={[
                { t: <span className="wo">Requested by {r.customer.name}</span>, n: fDT(r.createdAt) },
                ...r.trail.map((t) => ({
                  t: <span className="wo">{t.action}{t.from && t.to ? ` · ${t.from} → ${t.to}` : ""}</span>,
                  n: `${fDT(t.at)} · ${t.actor}${t.why ? " · " + t.why : ""}`,
                })),
              ]} />
            </Section>
          </div></div>
        </div>

        <div>
          <div className="pn"><div className="pnb">
            <Section t="Document">
              <DF k="Return" v={r.id} mono />
              <DF k="Status" v={<Pill s={r.status} />} />
              <DF k="Raised" v={fDate(r.createdAt)} />
              {r.resolvedAt && <DF k="Closed" v={fDate(r.resolvedAt)} />}
              <DF k="Against order" v={<span className="rid" style={{ cursor: "pointer" }} onClick={() => router.push(`/orders/${r.orderId}`)}>{r.orderId}</span>} />
              <DF k="Order value" v={money(r.order.total)} mono />
            </Section>
          </div></div>

          <div className="pn"><div className="pnb">
            <Section t="Firm">
              <DF k="Name" v={<span style={{ cursor: "pointer" }} onClick={() => router.push(`/customers/${r.customer.id}`)}>{r.customer.name}</span>} />
              <DF k="Contact" v={`${r.customer.contactName} · ${r.customer.phone}`} />
              <DF k="Tehsil" v={r.customer.tehsil} />
              <DF k="GSTIN" v={r.customer.gstin ?? "unregistered"} mono />
            </Section>
          </div></div>

          {r.credit && <div className="pn"><div className="pnb">
            <Section t="Credit note">
              <DF k="Number" v={r.creditNoteNo ?? "—"} mono />
              <DF k="Credited" v={money2(r.credit.credit)} mono strong />
              <DF k="Posted" v={fDate(r.credit.date)} />
              <div className="sm" style={{ marginTop: 7 }}>Posted to the firm&apos;s ledger — it settles against the oldest open invoice.</div>
              <button className="b b-o b-s" style={{ marginTop: 9 }} onClick={() => router.push(`/accounts/${r.customer.id}`)}>Open ledger</button>
            </Section>
          </div></div>}

          {open && <div className="pn"><div className="pnb">
            <Note k="w">This return is still open. Stock is not back in the godown and no credit has been raised against it.</Note>
          </div></div>}
        </div>
      </div>
    </div>
  </>;
}
