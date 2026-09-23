"use client";
import { useRouter } from "next/navigation";
import { money, money2, fDate } from "@vivaha/shared";
import { useApi, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { DF, Section, ModalFrame, Field, Note, Bar, Num } from "./ui";
import { PageHead } from "./PageHead";
import { useFooter } from "./Shell";
import { Icon } from "./icons";
import { useState } from "react";
import { VendorForm } from "@/app/(erp)/purchase/page";

// A supplier's account: what they billed, what we paid, what is open.
//
// Reads like the customer ledger on purpose — same statement, same ageing
// buckets — except the balance runs the other way: a purchase puts us in credit
// to them and a payment takes it back.

interface Line { id: string; date: string; kind: "PURCHASE" | "PAYMENT"; ref: string; particular: string; debit: number; credit: number; bal: number }
interface Led {
  vendor: { id: string; code: string | null; name: string; gstin: string | null; terms: string; city: string; phone: string; upiId: string | null; items: number };
  statement: Line[]; invoiced: number; paid: number; outstanding: number;
  ageing: { buckets: number[]; labels: string[] }; documents: number;
}

export function VendorLedger({ id }: { id: string }) {
  const { data } = useApi<Led>(`/api/masters/vendors/${id}/ledger`);
  const { can } = useAuth(); const { openModal } = useUI();
  const router = useRouter();
  useFooter(null);
  if (!data) return <div className="wa"><div className="sm">Loading…</div></div>;
  const v = data.vendor;

  return <>
    <PageHead
      crumb={["Supply", "Vendor ledger", v.name]}
      title={v.name}
      sub={<>{v.code ? <><span className="tab">{v.code}</span> · </> : null}{v.city || "—"} · {v.terms} · {v.gstin ?? "Unregistered"}</>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/vendors")}><Icon n="chevronL" s={13} /> Back to suppliers</button>
        {can("purchase.create") && <button className="b b-o" onClick={() => openModal(<VendorForm vendor={{ ...v, documents: data.documents, purchased: data.invoiced, invoiced: data.invoiced, paid: data.paid, outstanding: data.outstanding, oldestDays: 0 }} />)}>Edit supplier</button>}
        {can("purchase.create") && data.outstanding > 0 && <button className="b b-p" onClick={() => openModal(<PayVendorModal v={v} outstanding={data.outstanding} />)}>Record payment</button>}
      </>}
    />
    <div className="wa">
      <div className="idg">
        <div>
          <div className="pn"><div className="pnb">
            <Section t="Statement">
              {data.statement.length
                ? <table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Date</th><th>Particulars</th><th className="n">Billed to us</th><th className="n">Paid</th><th className="n">Balance</th></tr></thead><tbody>
                  {data.statement.slice().reverse().map((l) => <tr key={l.kind + l.id} style={{ cursor: "default" }}>
                    <td className="tab sm">{fDate(l.date)}</td>
                    <td className="w">{l.particular}<div className="sm">{l.ref}</div></td>
                    <td className="n tab">{l.credit ? money2(l.credit) : ""}</td>
                    <td className="n tab" style={{ color: "var(--ok)" }}>{l.debit ? money2(l.debit) : ""}</td>
                    <td className="n tab" style={{ fontWeight: 600 }}>{money2(l.bal)}</td>
                  </tr>)}
                </tbody></table>
                : <div className="sm">Nothing on this supplier&apos;s account yet.</div>}
              <div className="sm" style={{ marginTop: 8 }}>Newest first. A purchase puts us in credit to them; a payment takes it back.</div>
            </Section>
          </div></div>
        </div>
        <div>
          <div className="pn"><div className="pnb">
            <Section t="Account">
              <DF k="Billed to us" v={money(data.invoiced)} mono />
              <DF k="Paid" v={money(data.paid)} mono />
              <DF k="Outstanding" v={<span style={{ color: data.outstanding > 0 ? "var(--er)" : "var(--ok)" }}>{money(data.outstanding)}</span>} mono strong />
              <DF k="Documents" v={data.documents} mono />
              <DF k="Items supplied" v={v.items} mono />
              <div style={{ marginTop: 8 }}><Bar pct={data.invoiced ? (data.paid / data.invoiced) * 100 : 100} color="var(--ok)" /></div>
              <div className="sm" style={{ marginTop: 5 }}>{data.invoiced ? Math.round((data.paid / data.invoiced) * 100) : 100}% of what they have billed is settled</div>
            </Section>
            <Section t="Ageing of what is open">
              {data.ageing.labels.map((l, i) => <DF key={l} k={l} v={<span style={{ color: i >= 3 && data.ageing.buckets[i] ? "var(--er)" : undefined }}>{money(data.ageing.buckets[i])}</span>} mono />)}
            </Section>
          </div></div>
          <div className="pn"><div className="pnb">
            <Section t="Supplier">
              <DF k="Our number" v={v.code ?? "—"} mono />
              <DF k="Phone" v={v.phone || "—"} mono />
              <DF k="GSTIN" v={v.gstin ?? "—"} mono />
              <DF k="Terms" v={v.terms} />
              <DF k="UPI" v={v.upiId ?? "—"} mono />
              {v.upiId && <div className="sm" style={{ marginTop: 6 }}>A customer can be asked to settle their own bill by paying this supplier directly — from Record payment on the customer screen.</div>}
            </Section>
          </div></div>
        </div>
      </div>
    </div>
  </>;
}

function PayVendorModal({ v, outstanding }: { v: { id: string; name: string }; outstanding: number }) {
  const { closeModal, toast } = useUI();
  const [f, setF] = useState({ amount: outstanding, ref: "", date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!f.amount) return toast("Enter the amount paid", "e");
    if (f.amount > outstanding) return toast(`We only owe ${v.name} ${money(outstanding)}`, "e");
    setBusy(true);
    try {
      await post("/api/purchases/vendor-payments", { vendorId: v.id, amount: Number(f.amount), ref: f.ref, date: new Date(f.date).toISOString() });
      toast(`${money(f.amount)} paid to ${v.name}`, "s"); closeModal(); refresh("/api/");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };
  return <ModalFrame title={`Pay ${v.name}`} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={busy} onClick={go}>Record payment</button></>}>
    <div className="fg">
      <Field label="Amount (₹)" hint={`Open: ${money(outstanding)}`}><Num value={f.amount} step="0.01" onChange={(val) => setF({ ...f, amount: val })} /></Field>
      <Field label="Reference"><input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="UTR or cheque number" /></Field>
      <Field label="Date" full><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
    </div>
    <Note style={{ marginTop: 11 }}>This is money we sent them. A customer paying them directly on our behalf is recorded from the customer&apos;s own Record payment, which moves both ledgers at once.</Note>
  </ModalFrame>;
}
