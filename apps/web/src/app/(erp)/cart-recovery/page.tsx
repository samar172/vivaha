"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { money, num, fDate, rate, itemRef } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { KPI, Empty, Note, Field, ModalFrame } from "@/components/ui";
import { NewOrderModal } from "@/components/NewOrderModal";
import { Icon } from "@/components/icons";

interface CartLine { itemId: string; sku: string; name: string; qty: number; rate: number; amount: number; available: number; short: boolean; gone: boolean }
interface CartContact { id: string; name: string; role: string; phone: string }
interface AbandonedCart {
  customer: { id: string; name: string; tehsil: string; phone: string; group: string; salesExec: { name: string } | null };
  contacts: CartContact[];
  updatedAt: string; ageDays: number; count: number; value: number; issues: number;
  lines: CartLine[];
  chases: number;
  lastChase: { at: string; by: string; channel: string; toName: string; note: string } | null;
  recovered: boolean;
  recoveredOrder: { id: string; total: number; status: string; createdAt: string } | null;
}

const waDigits = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d.replace(/^0+/, "");
};

// The portal has always written a Cart row per firm and nobody in the office
// could see one. A firm that filled a basket and walked away is the warmest
// lead there is — this is that queue, and the work it takes to actually chase
// it: who to ring, what they were going to buy, whether anyone has rung
// already, and whether the ringing worked.
export default function CartRecoveryPage() {
  const { data, mutate } = useApi<AbandonedCart[]>("/api/orders/abandoned-carts", { refreshInterval: 60000 });
  const rows = data ?? [];
  useFooter(rows.length);
  return <>
    <PageHead
      crumb={["Sales", "Cart recovery"]}
      title="Cart recovery"
      sub="Firms that filled a basket in the portal and did not book it. The warmest lead there is — this is who to ring, what they were going to buy, and whether anyone has rung already."
    />
    <div className="wa"><AbandonedCarts rows={rows} onChanged={mutate} /></div>
  </>;
}

function AbandonedCarts({ rows, onChanged }: { rows: AbandonedCart[]; onChanged: () => void }) {
  const { openModal } = useUI();
  const router = useRouter();
  const [hideChased, setHideChased] = useState(false);
  if (!rows.length) return <Empty t="No baskets left open" d="Every firm that started a basket in the portal has either ordered or emptied it." />;

  const shown = hideChased ? rows.filter((r) => !r.chases) : rows;
  const value = rows.reduce((s, r) => s + r.value, 0);
  const chased = rows.filter((r) => r.chases).length;
  const won = rows.filter((r) => r.recovered).length;

  return <>
    <div className="kpis" style={{ marginBottom: 11 }}>
      <KPI l="Baskets left open" v={num(rows.length)} d={`${money(value)} sitting in them`} />
      <KPI l="Chased" v={num(chased)} d={rows.length ? `${Math.round((chased / rows.length) * 100)}% followed up` : undefined} onClick={() => setHideChased((v) => !v)} />
      <KPI l="Recovered" v={num(won)} cls={won ? "d-ok" : undefined} d={chased ? `${Math.round((won / chased) * 100)}% of those chased ordered` : "nothing chased yet"} />
      <KPI l="Needs attention" v={num(rows.filter((r) => r.issues).length)} cls="d-wa" d="basket has gone short or stale" />
    </div>

    <div className="tbar">
      <span style={{ fontSize: 12.5, color: "var(--t4)" }}>Biggest basket first — that is the order worth ringing in.</span>
      {hideChased && <button className="b b-o b-s" onClick={() => setHideChased(false)}>Not yet chased only <Icon n="x" s={11} /></button>}
      <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--t4)" }}>{shown.length} shown</span>
    </div>

    <div className="gw"><table className="dg"><thead><tr>
      <th>Firm</th><th>Left in the basket</th><th className="n">Value</th><th className="n">Idle</th><th>Chased</th><th>Sales executive</th><th></th>
    </tr></thead><tbody>
      {shown.map((r) => <tr key={r.customer.id} onClick={() => openModal(<BasketModal cart={r} onChanged={onChanged} />, "w")} title="See the whole basket">
        <td className="w" onClick={(e) => e.stopPropagation()}><a href={`/customers/${r.customer.id}`} onClick={(e) => { e.preventDefault(); router.push(`/customers/${r.customer.id}`); }}>{r.customer.name}</a><div className="sm">{r.customer.tehsil} · {r.customer.phone}</div></td>
        <td className="w">
          {r.lines.slice(0, 3).map((l) => <div key={l.itemId} className="sm">
            <span className="rid">{itemRef(l)}</span> × {num(l.qty)}
            {l.gone ? <span style={{ color: "var(--er)" }}> · no longer sold</span> : l.short ? <span style={{ color: "var(--wa)" }}> · only {num(l.available)} left</span> : null}
          </div>)}
          {r.lines.length > 3 ? <div className="sm">+{r.lines.length - 3} more</div> : null}
        </td>
        <td className="n tab" style={{ fontWeight: 700 }}>{money(r.value)}</td>
        <td className="n tab" style={{ color: r.ageDays > 3 ? "var(--er)" : "var(--t6)" }}>{r.ageDays === 0 ? "today" : r.ageDays + "d"}</td>
        <td>
          {r.recovered ? <><span className="bd b-ok">Recovered</span><div className="sm">{r.recoveredOrder?.id}</div></>
            : r.lastChase ? <><span className="bd b-nu">{r.chases}×</span><div className="sm">{fDate(r.lastChase.at)} · {r.lastChase.by}</div></>
            : <span className="bd b-wa">Not yet</span>}
        </td>
        <td className="sm">{r.customer.salesExec?.name ?? "—"}</td>
        <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
          <button className="b b-o b-s" onClick={() => openModal(<ChaseModal cart={r} onDone={onChanged} />, "n")}>Chase</button>{" "}
          <button className="b b-o b-s" onClick={() => openModal(<NewOrderModal customerId={r.customer.id} />, "w")}>Book it</button>
        </td>
      </tr>)}
    </tbody></table></div>

    <Note k="i" style={{ marginTop: 11 }}>These are live portal baskets, not orders — no stock is held against them, and a basket can go short or stale while it sits. Chasing records who rang and when, so two people do not ring the same firm; booking raises an ordinary office order, which does hold stock.</Note>
  </>;
}

// The whole basket, which is what the row is about. Three lines fit on a row
// and a firm can have a dozen — and before ringing anybody you want to see all
// of it, including the lines that have gone short since they filled it.
function BasketModal({ cart, onChanged }: { cart: AbandonedCart; onChanged: () => void }) {
  const { closeModal, openModal } = useUI();
  const router = useRouter();
  const total = cart.lines.reduce((s, l) => s + l.amount, 0);
  const fulfilable = cart.lines.reduce((s, l) => s + Math.min(l.qty, l.available) * l.rate, 0);

  return <ModalFrame
    title={`Basket — ${cart.customer.name}`}
    onClose={closeModal}
    actions={<>
      <button className="b b-o" onClick={closeModal}>Close</button>
      <button className="b b-o" onClick={() => { closeModal(); openModal(<ChaseModal cart={cart} onDone={onChanged} />, "n"); }}>Chase</button>
      <button className="b b-p" onClick={() => { closeModal(); openModal(<NewOrderModal customerId={cart.customer.id} />, "w"); }}>Book it for them</button>
    </>}>
    <div className="sm" style={{ marginBottom: 10 }}>
      Filled {cart.ageDays === 0 ? "today" : `${cart.ageDays} day${cart.ageDays === 1 ? "" : "s"} ago`} · {cart.customer.tehsil} · {cart.customer.phone}
      {cart.customer.salesExec ? ` · covered by ${cart.customer.salesExec.name}` : ""}
      {" · "}<a href={`/customers/${cart.customer.id}`} onClick={(e) => { e.preventDefault(); closeModal(); router.push(`/customers/${cart.customer.id}`); }}>open the firm</a>
    </div>

    {cart.lastChase && <Note style={{ marginBottom: 11 }}>
      Chased {cart.chases === 1 ? "once" : `${cart.chases} times`} — last on {fDate(cart.lastChase.at)} by {cart.lastChase.by}{cart.lastChase.toName ? ` to ${cart.lastChase.toName}` : ""}.
      {cart.lastChase.note ? <> Note: “{cart.lastChase.note}”</> : null}
    </Note>}
    {cart.recovered && <Note k="o" style={{ marginBottom: 11 }}>Already recovered — {cart.recoveredOrder?.id} was placed after the last chase.</Note>}

    <div className="gw"><table className="dg"><thead><tr>
      <th>Item</th><th className="n">Wanted</th><th className="n">Available</th><th className="n">Rate</th><th className="n">Amount</th>
    </tr></thead><tbody>
      {cart.lines.map((l) => <tr key={l.itemId} style={{ cursor: "pointer" }} onClick={() => { closeModal(); router.push(`/items/${l.itemId}`); }}>
        <td className="w"><span className="rid">{itemRef(l)}</span><div className="sm">{l.name}</div></td>
        <td className="n tab">{num(l.qty)}</td>
        <td className="n tab" style={{ color: l.gone ? "var(--er)" : l.short ? "var(--wa)" : undefined }}>
          {l.gone ? "no longer sold" : num(l.available)}
          {l.short && !l.gone ? <div className="sm" style={{ color: "var(--wa)" }}>short by {num(l.qty - l.available)}</div> : null}
        </td>
        <td className="n tab">{rate(l.rate)}</td>
        <td className="n tab" style={{ fontWeight: 600 }}>{money(l.amount)}</td>
      </tr>)}
    </tbody></table></div>

    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><div style={{ minWidth: 230 }}>
      <div className="df"><span className="k">Basket value</span><span className="v m">{money(total)}</span></div>
      {fulfilable !== total && <div className="df"><span className="k">Fulfilable today</span><span className="v m" style={{ color: "var(--wa)" }}>{money(fulfilable)}</span></div>}
    </div></div>

    {!!cart.issues && <Note k="w" style={{ marginTop: 11 }}>
      {cart.issues === 1 ? "One line" : `${cart.issues} lines`} cannot be filled as it stands. Worth knowing before you ring — the alternatives on the item page are the conversation to have.
    </Note>}
    <Note k="i" style={{ marginTop: 9 }}>This is a live portal basket, not an order — no stock is held against it, and it can change or go short while it sits. Booking raises an ordinary office order, which does hold stock.</Note>
  </ModalFrame>;
}

// Chasing is a phone call or a WhatsApp message, not a system action. The
// message opens ready-addressed to a number the operator picks and a person
// sends it; what is recorded here is that the firm was contacted.
function ChaseModal({ cart, onDone }: { cart: AbandonedCart; onDone: () => void }) {
  const { closeModal, toast } = useUI();
  const contacts = cart.contacts?.length ? cart.contacts : [{ id: "primary", name: cart.customer.name, role: "Owner", phone: cart.customer.phone }];
  const [sel, setSel] = useState(contacts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const c = contacts.find((x) => x.id === sel) ?? contacts[0];

  const text = [
    `${cart.customer.name} — आपकी कार्ट में ${cart.count} आइटम हैं`,
    cart.lines.slice(0, 3).map((l) => `${itemRef(l)} × ${l.qty}`).join(", "),
    `कुल ${money(cart.value)}`,
    note.trim(),
    "— Vivaha Cards",
  ].filter(Boolean).join("\n");

  const go = async (channel: "WHATSAPP" | "CALL") => {
    setBusy(true);
    try {
      if (channel === "WHATSAPP") window.open(`https://wa.me/${waDigits(c.phone)}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      await post(`/api/orders/abandoned-carts/${cart.customer.id}/chase`, { channel, toName: `${c.role} — ${c.name}`, toPhone: c.phone, note: note.trim() });
      toast(channel === "WHATSAPP" ? `WhatsApp opened for ${c.name}` : `Call to ${c.name} recorded`, "s");
      onDone(); closeModal();
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <ModalFrame title={`Chase — ${cart.customer.name}`} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-o" disabled={busy} onClick={() => go("CALL")}>Log a call</button><button className="b b-p" disabled={busy} onClick={() => go("WHATSAPP")}>Open WhatsApp</button></>}>
    {cart.lastChase && <Note style={{ marginBottom: 11 }}>
      Already chased {cart.chases === 1 ? "once" : `${cart.chases} times`} — last on {fDate(cart.lastChase.at)} by {cart.lastChase.by}{cart.lastChase.toName ? ` to ${cart.lastChase.toName}` : ""}.
      {cart.lastChase.note ? <> Note: “{cart.lastChase.note}”</> : null}
    </Note>}
    {!!cart.issues && <Note k="w" style={{ marginBottom: 11 }}>
      {cart.issues === 1 ? "One item" : `${cart.issues} items`} in this basket has gone short or is no longer sold. Worth checking before you ring — offering something they cannot have is worse than not ringing.
    </Note>}
    <Field label="Who to reach" full hint="The firm's saved numbers">
      <select value={sel} onChange={(e) => setSel(e.target.value)}>{contacts.map((x) => <option key={x.id} value={x.id}>{x.role} — {x.name} · {x.phone}</option>)}</select>
    </Field>
    <Field label="Add a line (optional)" full><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Holding these for you till Friday" /></Field>
    <div className="sm" style={{ whiteSpace: "pre-wrap", border: "1px solid var(--bd)", borderRadius: 5, padding: "9px 11px", marginTop: 4 }}>{text}</div>
    <Note k="i" style={{ marginTop: 11 }}>Log a call records the follow-up without opening anything — for when you simply pick up the phone.</Note>
  </ModalFrame>;
}
