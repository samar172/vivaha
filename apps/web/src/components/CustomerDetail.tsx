"use client";
import { useState } from "react";
import { money, money2, num, fDate, fDT } from "@vivaha/shared";
import { useRouter } from "next/navigation";
import { useApi, useLines, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post, put, patch, del } from "@/lib/api";
import { DF, Section, ModalFrame, Field, Note, Bar, Timeline } from "./ui";
import { PageHead } from "./PageHead";
import { useFooter } from "./Shell";
import { Icon } from "./icons";
import type { Customer, ItemView } from "./types";

const SPEC: Record<string, string> = { colours: "Colours", ink: "Ink brand", company: "Machine company", roller: "Roller cloth", chem: "Chemicals brand", industry: "Industry", model: "Model" };
type Full = Customer & { multiplier: number; outstanding: number; statement: { id: string; date: string; particular: string; debit: number; credit: number; bal: number }[]; ageing: { buckets: number[]; labels: string[] }; orders: { id: string; total: number; status: string; createdAt: string }[]; overrides: { itemId: string; sku: string; name: string; rate: number; slabRate: number; groupRate: number; floor: number; mode?: "FLAT" | "PERCENT"; pct?: number | null }[] };

// A firm opens on its own page rather than in a side drawer, the same way a
// card does. There is a lot here — its numbers and staff, its credit gate, its
// machines, its ageing, its ledger and its orders — and in a 420px drawer all
// of it was one long scroll with the list it came from hidden behind.
export function CustomerDetail({ id }: { id: string }) {
  const { data: c } = useApi<Full>(`/api/customers/${id}`);
  const { openModal, toast } = useUI(); const { can } = useAuth(); const { data: lines } = useLines();
  const router = useRouter();
  // The footer's count belongs to whatever list was last shown; a detail page
  // has none of its own, so clear it rather than inherit one.
  useFooter(null);
  if (!c) return <div className="wa"><div className="sm">Loading…</div></div>;
  const g = c.gate, a = c.ageing;
  const unblock = async () => { try { await post(`/api/customers/${id}/unblock`); toast("Block lifted", "s"); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <>
    <PageHead
      crumb={["Sales", "Customers", c.name]}
      title={c.name}
      sub={<>{c.contactName} · {c.tehsil}, Rajasthan · {c.group} · <span className="tab">{c.referCode}</span></>}
      actions={<>
        <button className="b b-o" onClick={() => router.push("/customers")}><Icon n="chevronL" s={13} /> Back to customers</button>
        {can("cust.edit") && <button className="b b-p" onClick={() => openModal(<CustomerForm customer={c} />, "w")}>Edit firm</button>}
        {can("cust.price") && <button className="b b-o" onClick={() => openModal(<OverrideModal c={c} />)}>Pricing</button>}
        {can("payment.create") && <button className="b b-o" onClick={() => openModal(<PaymentModal customerId={id} />)}>Record payment</button>}
        {can("cust.block") && (c.blockReason
          ? <button className="b b-o" onClick={unblock}>Lift block</button>
          : <button className="b b-d" onClick={() => openModal(<BlockModal c={c} />, "n")}>Temporary block</button>)}
      </>}
    />
    <div className="wa">
      {c.blockReason && <Note k="w" style={{ marginBottom: 13 }}><b>Blocked</b> by {c.blockedBy} on {fDate(c.blockedAt)} — {c.blockReason}{c.blockUntil ? ` · auto-lift ${fDate(c.blockUntil)}` : ""}</Note>}
      <div className="idg">
        <div>
          <div className="pn"><div className="pnb">
            <Section t="Firm">
              <DF k="Contact" v={c.contactName} /><DF k="Phone" v={c.phone} /><DF k="Tehsil / district" v={c.tehsil + ", Rajasthan"} /><DF k="Address" v={`${c.address}, ${c.tehsil}`} />
              <DF k="GSTIN" v={c.gstin ?? "—"} mono /><DF k="Firm type" v={c.firmType} /><DF k="Pricing group" v={`${c.group} · ×${c.multiplier}`} />
              {!!c.priceAdjPct && <DF k="Firm discount" v={`${c.priceAdjPct}% off the group rate`} />}
              <DF k="Refer code" v={c.referCode} mono /><DF k="Sales executive" v={c.salesExec?.name ?? "—"} />
              <DF k="Deals in" v={c.linesEnabled.map((l) => lines?.find((x) => x.id === l)?.name ?? l).join(", ")} />
            </Section>
          </div></div>
          <div className="pn"><div className="pnb">
            <Section t="Numbers & staff">{c.contacts.map((ct) => <DF key={ct.id} k={<>{ct.name} <span className="sm">{ct.role}</span></>} v={<>{ct.phone} {ct.hasLogin && <span className="bd b-ok" style={{ marginLeft: 4 }}>login</span>}</>} mono />)}<div className="sm" style={{ marginTop: 6 }}>Owner authority may approve a credit-breaching order; Staff cannot — it routes to the owner.</div></Section>
          </div></div>
          <div className="pn"><div className="pnb">
            <LocationSection id={id} />
          </div></div>
          <div className="pn"><div className="pnb">
            <Section t="Machines owned">{c.machines.length ? c.machines.map((m) => <div key={m.id} style={{ border: "1px solid var(--bd)", borderRadius: 5, padding: "8px 10px", marginBottom: 6 }}><div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{m.type}</div>{Object.keys(m.spec).map((k) => <div className="df" key={k} style={{ fontSize: 13 }}><span className="k">{SPEC[k] ?? k}</span><span className="v">{m.spec[k]}</span></div>)}</div>) : <div className="sm">No machines recorded. This firm buys finished goods only.</div>}<div className="sm">Machine profile drives consumables reorder prediction and targeted ad slots.</div></Section>
          </div></div>
        </div>

        <div>
          <div className="pn"><div className="pnb">
            <Section t="Credit gate · time or amount, whichever first">
              <DF k="Credit limit" v={money(c.creditLimit)} mono /><DF k="Outstanding" v={<span style={{ color: g.amountBreach ? "var(--er)" : undefined }}>{money(g.out)}</span>} mono /><DF k="Credit days" v={c.creditDays || "Advance"} mono /><DF k="Oldest unpaid" v={<span style={{ color: g.timeBreach ? "var(--er)" : undefined }}>{g.oldestAge ? g.oldestAge + " days" : "—"}</span>} mono /><DF k="Gate mode" v={c.gateMode} />
              <div style={{ marginTop: 8 }}><Bar pct={g.util * 100} color={g.restricted ? "var(--er)" : g.util > .85 ? "var(--wa)" : "var(--ok)"} /></div>
              <div className="sm" style={{ marginTop: 5 }}>{Math.round(g.util * 100)}% of limit used{g.restricted ? ` — ${g.amountBreach ? "amount breached" : ""}${g.amountBreach && g.timeBreach ? " and " : ""}${g.timeBreach ? "credit days exceeded" : ""}` : ""}</div>
            </Section>
            <Section t="Ageing">{a.labels.map((l, i) => <DF key={l} k={l} v={<span style={{ color: i >= 3 && a.buckets[i] ? "var(--er)" : undefined }}>{money(a.buckets[i])}</span>} mono />)}</Section>
          </div></div>
          <div className="pn"><div className="pnb">
            <Section t="Recent ledger">{c.statement.slice(-8).reverse().map((e) => <DF key={e.id} k={<span style={{ fontSize: 13 }}>{fDate(e.date)} · {e.particular}</span>} v={<span style={{ color: e.credit ? "var(--ok)" : undefined }}>{e.credit ? "−" + money(e.credit) : money(e.debit)}</span>} mono />)}</Section>
          </div></div>
          <div className="pn"><div className="pnb">
            <Section t={`Orders · ${c.orders.length}`}><Timeline rows={c.orders.slice(0, 8).map((o) => ({ t: <><span className="wo">{o.id}</span> {money(o.total)} · {o.status.replace(/_/g, " ")}</>, n: fDT(o.createdAt) }))} /></Section>
          </div></div>
        </div>
      </div>
    </div>
  </>;
}

interface Loc { id: string; lat: number; lng: number; accuracy: number | null; source: "ONBOARDING" | "OFFICE_EDIT" | "PORTAL_CHECKIN"; by: string; at: string }

const SOURCE_LABEL: Record<Loc["source"], string> = {
  ONBOARDING: "Pinned at onboarding",
  OFFICE_EDIT: "Updated from the office",
  PORTAL_CHECKIN: "Checked in on the portal",
};

// Where this firm has actually been seen. Two different questions get answered
// here and they are not the same: where the shop was when it was signed up, and
// where the firm was the last time it used the portal. The distance between
// them is the interesting part — two hundred metres is the shop, forty
// kilometres is somewhere else.
function LocationSection({ id }: { id: string }) {
  const { data } = useApi<{ rows: Loc[]; driftM: number | null }>(`/api/customers/${id}/locations`);
  if (!data) return <Section t="Shop location"><div className="sm">Loading…</div></Section>;
  const { rows, driftM } = data;
  if (!rows.length) return <Section t="Shop location">
    <div className="sm">No location on record. It is captured when a firm is onboarded — or when they open the portal, if they allow it — and refusing has never stopped anything.</div>
  </Section>;

  const latest = rows[0];
  const onboard = rows.filter((r) => r.source === "ONBOARDING").at(-1);
  const checkins = rows.filter((r) => r.source === "PORTAL_CHECKIN").length;
  const map = (r: Loc) => `https://www.google.com/maps?q=${r.lat},${r.lng}`;
  const far = driftM != null && driftM > 2000;

  return <Section t="Shop location">
    <DF k="Last seen" v={<a href={map(latest)} target="_blank" rel="noreferrer" className="tab">{latest.lat.toFixed(5)}, {latest.lng.toFixed(5)}</a>} />
    <DF k="How" v={<>{SOURCE_LABEL[latest.source]}{latest.accuracy ? ` · ±${Math.round(latest.accuracy)} m` : ""}</>} />
    <DF k="When" v={fDT(latest.at)} />
    {onboard && onboard.id !== latest.id && <DF k="Onboarded at" v={<a href={map(onboard)} target="_blank" rel="noreferrer" className="tab">{onboard.lat.toFixed(5)}, {onboard.lng.toFixed(5)}</a>} />}
    {driftM != null && <DF k="Distance from the shop" v={<span style={{ color: far ? "var(--wa)" : undefined, fontWeight: far ? 700 : undefined }}>{driftM < 1000 ? `${driftM} m` : `${(driftM / 1000).toFixed(1)} km`}</span>} />}
    {far && <Note k="w" style={{ marginTop: 8 }}>The last check-in was {(driftM! / 1000).toFixed(1)} km from where this shop was pinned. Worth knowing before a delivery is routed — not necessarily wrong, firms order from the road.</Note>}
    <div className="sm" style={{ marginTop: 7 }}>{checkins ? `${num(checkins)} portal check-in${checkins === 1 ? "" : "s"} on record. ` : ""}A fix is only ever taken when someone onboards this firm, edits it here, or the firm opens the portal — never in the background.</div>
    {rows.length > 1 && <details style={{ marginTop: 8 }}>
      <summary className="sm" style={{ cursor: "pointer" }}>Show all {rows.length} fixes</summary>
      <table className="dg" style={{ fontSize: 13, marginTop: 7 }}><thead><tr><th>When</th><th>How</th><th>Where</th><th>By</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id} style={{ cursor: "default" }}>
          <td className="sm">{fDT(r.at)}</td>
          <td className="sm">{SOURCE_LABEL[r.source]}</td>
          <td><a href={map(r)} target="_blank" rel="noreferrer" className="tab">{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</a></td>
          <td className="sm">{r.by || "—"}</td>
        </tr>)}
      </tbody></table>
    </details>}
  </Section>;
}

function BlockModal({ c }: { c: Customer }) {
  const { closeModal, closeDrawer, toast } = useUI(); const [r, setR] = useState(""); const [d, setD] = useState("");
  const go = async () => { if (!r.trim()) return toast("A reason is required", "e"); try { await post(`/api/customers/${c.id}/block`, { reason: r, until: d || undefined }); toast("Block applied — ordering suspended, ledger stays open", "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title={"Temporary block — " + c.name} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-d" onClick={go}>Apply block</button></>}><Note k="w" style={{ marginBottom: 13 }}>A block suspends <b>new orders only</b>. Ledger, statements and payment stay open so the firm can clear dues and be unblocked — BR-05.</Note><Field label="Reason (required)"><textarea value={r} onChange={(e) => setR(e.target.value)} placeholder="e.g. Two cheques returned, awaiting clearance" /></Field><Field label="Auto-lift on (optional)"><input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field></ModalFrame>;
}

// Captured once, when the executive is standing in the shop. Never a background
// watch: one fix, on a button press, with the firm's consent in the room.
// Refusal is an ordinary outcome — the firm saves regardless.
function GeoCapture({ lat, lng, accuracy, at, onFix }: { lat: number | null; lng: number | null; accuracy: number | null; at?: string | null; onFix: (lat: number, lng: number, acc: number | null) => void }) {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const has = lat != null && lng != null;
  const capture = () => {
    if (!navigator.geolocation) return toast("This browser cannot report a location", "e");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { onFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? null); setBusy(false); toast("Location captured — saved with the firm", "s"); },
      (err) => { setBusy(false); toast(err.code === err.PERMISSION_DENIED ? "Location permission refused — the firm will save without a pin" : "Could not get a location fix — the firm will save without a pin", "w"); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };
  return <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
    <button className="b b-o b-s" disabled={busy} onClick={capture}><Icon n="pin" s={13} /> {busy ? "Getting a fix…" : has ? "Update location" : "Capture location"}</button>
    <div className="sm">
      {has
        ? <>Pinned at <span className="tab">{lat!.toFixed(5)}, {lng!.toFixed(5)}</span>{accuracy ? ` · ±${Math.round(accuracy)} m` : ""}{at ? ` · ${fDate(at)}` : ""} · <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">open map</a></>
        : "No location saved. Capture it while you are at the shop — it is optional, and refusing permission does not block anything."}
    </div>
  </div>;
}

function OverrideModal({ c }: { c: Full }) {
  const { closeModal, toast } = useUI(); const { data: items } = useApi<{ items: ItemView[] }>("/api/items"); const { data: full, mutate } = useApi<Full>(`/api/customers/${c.id}`);
  const { data: lines } = useLines();
  // Cards are sold from one published list; only the negotiated lines carry
  // per-firm pricing, and the line master is what says which is which.
  const negotiable = (id: string) => lines?.find((l) => l.id === id)?.allowCustomPricing !== false;
  const its = (items?.items ?? []).filter((i) => i.status === "ACTIVE" && c.linesEnabled.includes(i.lineId) && negotiable(i.lineId));
  const [iid, setIid] = useState(""); const [mode, setMode] = useState<"FLAT" | "PERCENT">("FLAT");
  const [rate, setRate] = useState(55); const [pct, setPct] = useState(5); const [reason, setReason] = useState("");
  const [adj, setAdj] = useState(full?.priceAdjPct ?? c.priceAdjPct ?? 0);
  const list = full?.overrides ?? c.overrides;
  const sel = its.find((i) => i.id === (iid || its[0]?.id));

  const add = async () => {
    try {
      const body = mode === "FLAT" ? { mode, rate: Number(rate), reason } : { mode, pct: Number(pct), reason };
      const r = await put<{ belowFloor: boolean; floor: number; effective: number; listRate: number }>(`/api/customers/${c.id}/overrides/${iid || its[0]?.id}`, body);
      toast(r.belowFloor ? `Set at ${money(r.effective)} — below floor ${money(r.floor)}, logged in audit` : `Set at ${money(r.effective)} against a list rate of ${money(r.listRate)}`, r.belowFloor ? "w" : "s");
      mutate(); refresh("/api/customers");
    } catch (e) { toast(errMsg(e), "e"); }
  };
  const rm = async (itemId: string) => { await del(`/api/customers/${c.id}/overrides/${itemId}`); toast("Override removed", "s"); mutate(); refresh("/api/customers"); };
  const saveAdj = async () => {
    try { await patch(`/api/customers/${c.id}`, { priceAdjPct: Number(adj) }); toast(adj ? `${adj}% off everything this firm buys` : "Firm-wide discount cleared", "s"); mutate(); refresh("/api/"); }
    catch (e) { toast(errMsg(e), "e"); }
  };

  return <ModalFrame title={"Pricing — " + c.name} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Close</button><button className="b b-p" disabled={!its.length} onClick={add}>Set item price</button></>}>
    <div className="st">Firm-wide</div>
    <div className="sm" style={{ marginBottom: 8 }}>Applies to everything this firm buys, on top of the <b>{c.group}</b> group multiplier of ×{c.multiplier}. A per-item arrangement below outranks it.</div>
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 15 }}>
      <Field label="Discount off the group rate (%)"><input type="number" value={adj} onChange={(e) => setAdj(Number(e.target.value))} /></Field>
      <button className="b b-o" style={{ marginBottom: 2 }} onClick={saveAdj}>Save</button>
    </div>

    <div className="st">Per item</div>
    <Note style={{ marginBottom: 13 }}>A per-item price outranks the quantity slab, the group multiplier and the firm-wide discount. It still cannot go below the margin floor without an authorised override. <b>Cards are not listed</b> — that line is sold from a fixed price list, so its rates are changed on the item itself.</Note>
    {list.length ? <table className="dg" style={{ marginBottom: 13 }}><thead><tr><th>Item</th><th className="n">Slab rate</th><th className="n">Group rate</th><th className="n">Agreed</th><th></th></tr></thead><tbody>{list.map((o) => <tr key={o.itemId} style={{ cursor: "default" }}><td>{o.sku} {o.name}</td><td className="n tab">{money(o.slabRate)}</td><td className="n tab">{money(o.groupRate)}</td><td className="n tab" style={{ fontWeight: 700, color: o.rate < o.floor ? "var(--er)" : "var(--ac)" }}>{money(o.rate)}{o.mode === "PERCENT" && o.pct != null ? <div className="sm">{o.pct}% off list</div> : null}</td><td><button className="b b-g b-s" onClick={() => rm(o.itemId)}>Remove</button></td></tr>)}</tbody></table> : <div className="sm" style={{ marginBottom: 13 }}>No per-item pricing set for this firm.</div>}
    {its.length ? <>
      <div className="fg">
        <Field label="Item" full><select value={iid || its[0]?.id || ""} onChange={(e) => setIid(e.target.value)}>{its.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></Field>
        <Field label="How it was agreed"><select value={mode} onChange={(e) => setMode(e.target.value as "FLAT" | "PERCENT")}><option value="FLAT">A fixed rate</option><option value="PERCENT">A discount off list</option></select></Field>
        {mode === "FLAT"
          ? <Field label="Agreed rate (₹ per unit)"><input type="number" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></Field>
          : <Field label="Discount (%)" hint="Follows the price list, so it stays right when rates move"><input type="number" value={pct} onChange={(e) => setPct(Number(e.target.value))} /></Field>}
        <Field label="Reason" full><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Volume commitment for the season" /></Field>
      </div>
      {sel && <div className="sm" style={{ marginTop: 7 }}>{sel.sku} landed cost {money(sel.landedCost)} · MOQ {sel.moq} {sel.uom}</div>}
    </> : <div className="sm">This firm deals only in lines that use the fixed price list.</div>}
  </ModalFrame>;
}

export function PaymentModal({ customerId }: { customerId?: string }) {
  const { closeModal, closeDrawer, toast } = useUI(); const { data: custs } = useApi<Customer[]>("/api/customers");
  const [f, setF] = useState(() => ({ customerId: customerId ?? "", amount: 25000, method: "UPI", ref: "REF" + (880900 + Math.floor(Math.random() * 900)), date: new Date().toISOString().slice(0, 10) }));
  const go = async () => { try { const r = await post<{ receiptNo: string; outstanding: number; autoLifted: boolean }>("/api/ledger/payments", { ...f, customerId: f.customerId || custs?.[0]?.id, amount: Number(f.amount) }); toast(`Receipt ${r.receiptNo} posted · outstanding now ${money(r.outstanding)}${r.autoLifted ? " · block auto-lifted" : ""}`, "s"); closeModal(); closeDrawer(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="Record payment" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Post receipt</button></>}>
    <div className="fg"><Field label="Firm" full><select value={f.customerId || custs?.[0]?.id || ""} onChange={(e) => setF({ ...f, customerId: e.target.value })}>{custs?.map((c) => <option key={c.id} value={c.id}>{c.name} — outstanding {money(c.gate.out)}</option>)}</select></Field><Field label="Amount (₹)"><input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></Field><Field label="Method"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option>UPI</option><option>NEFT</option><option>Cheque</option><option>Cash</option></select></Field><Field label="Reference"><input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field><Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field></div>
    <Note style={{ marginTop: 11 }}>Receipts allocate oldest-invoice-first by default. Any unallocated amount sits as on-account credit.</Note>
  </ModalFrame>;
}

const ROLES = ["Owner", "Staff", "Office", "Accounts", "Other"];
const MACHINE_TYPES = ["Offset", "Screen", "Flex", "UV", "Digital", "Binding", "Other"];
type FormContact = { id?: string; name: string; role: string; phone: string; authority: "Owner" | "Staff" };
type FormMachine = { type: string; spec: Record<string, string> };

// One screen for the whole firm: who they are, every number they answer on,
// their staff, and the machines on their floor. Creating and editing are the
// same form — an edit that could not reach half the record is how the machine
// list went stale in the first place.
export function CustomerForm({ customer }: { customer?: Customer } = {}) {
  const { closeModal, closeDrawer, toast } = useUI(); const { data: lines } = useLines(); const { data: tehsils } = useApi<string[]>("/api/masters/tehsils"); const { data: execs } = useApi<{ id: string; name: string }[]>("/api/masters/sales-execs"); const { data: groups } = useApi<{ name: string; multiplier: number }[]>("/api/masters/pricing-groups");
  const edit = !!customer;
  const [f, setF] = useState({
    name: customer?.name ?? "", contactName: customer?.contactName ?? "", phone: customer?.phone ?? "",
    tehsil: customer?.tehsil ?? "Bikaner", gstin: customer?.gstin ?? "", firmType: customer?.firmType ?? "Registered",
    address: customer?.address ?? "", linesEnabled: customer?.linesEnabled ?? ["L1"], group: customer?.group ?? "Regular",
    salesExecId: customer?.salesExecId ?? "", creditLimit: customer?.creditLimit ?? 150000, creditDays: customer?.creditDays ?? 30,
    gateMode: (customer?.gateMode ?? "WARN") as "WARN" | "BLOCK",
    priceAdjPct: customer?.priceAdjPct ?? 0,
    lat: customer?.lat ?? null as number | null, lng: customer?.lng ?? null as number | null, geoAccuracy: customer?.geoAccuracy ?? null as number | null,
  });
  const [contacts, setContacts] = useState<FormContact[]>(
    customer?.contacts?.length
      ? customer.contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, phone: c.phone, authority: (c.authority === "Owner" ? "Owner" : "Staff") as "Owner" | "Staff" }))
      : [],
  );
  const [machines, setMachines] = useState<FormMachine[]>(customer?.machines?.map((m) => ({ type: m.type, spec: { ...m.spec } })) ?? []);

  const setC = (i: number, patch: Partial<FormContact>) => setContacts((cs) => cs.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  const setM = (i: number, patch: Partial<FormMachine>) => setMachines((ms) => ms.map((m, n) => (n === i ? { ...m, ...patch } : m)));
  const setSpec = (i: number, k: string, v: string) => setMachines((ms) => ms.map((m, n) => (n === i ? { ...m, spec: { ...m.spec, [k]: v } } : m)));

  const go = async () => {
    if (!f.name || !f.contactName || !f.phone) return toast("Firm name, owner name and phone are required", "e");
    const clean = contacts.filter((c) => c.name.trim() && c.phone.trim());
    if (contacts.length !== clean.length) return toast("Every extra number needs a name and a phone — remove the blank rows", "e");
    const body = { ...f, salesExecId: f.salesExecId || null, gstin: f.gstin || undefined, contacts: clean, machines: machines.filter((m) => m.type) };
    try {
      if (edit) { await patch(`/api/customers/${customer!.id}`, body); toast("Customer updated", "s"); closeDrawer(); }
      else { await post("/api/customers", body); toast("Customer created — refer code issued", "s"); }
      closeModal(); refresh("/api/");
    } catch (e) { toast(errMsg(e), "e"); }
  };

  return <ModalFrame title={edit ? `Edit — ${customer!.name}` : "New customer"} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>{edit ? "Save changes" : "Save customer"}</button></>}>
    <div className="fg"><Field label="Firm name *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Marwar Card Bhandar" /></Field><Field label="Owner name *"><input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field><Field label="Phone *" hint="The firm's primary number — more can be added below"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 94141 00000" /></Field><Field label="Tehsil / gram panchayat *"><select value={f.tehsil} onChange={(e) => setF({ ...f, tehsil: e.target.value })}>{tehsils?.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="GSTIN"><input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} placeholder="08ABCDE1234F1Z5" /></Field><Field label="Firm type"><select value={f.firmType} onChange={(e) => setF({ ...f, firmType: e.target.value })}><option>Registered</option><option>Composition</option><option>Unregistered</option></select></Field>
      <Field label="Address" full><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Shop / street / landmark" /></Field>
      <Field label="Deals in (drives which lines they see in the portal)" full><div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "7px 0" }}>{lines?.map((l) => <label key={l.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}><input type="checkbox" className="ck" checked={f.linesEnabled.includes(l.id)} onChange={(e) => setF({ ...f, linesEnabled: e.target.checked ? [...f.linesEnabled, l.id] : f.linesEnabled.filter((x) => x !== l.id) })} />{l.name}</label>)}</div></Field>
      <Field label="Pricing group"><select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>{groups?.map((g) => <option key={g.name} value={g.name}>{g.name} — ×{g.multiplier}</option>)}</select></Field><Field label="Sales executive"><select value={f.salesExecId} onChange={(e) => setF({ ...f, salesExecId: e.target.value })}><option value="">—</option>{execs?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Credit limit (₹)" hint="Suggested ₹1,80,000 from machine capacity"><input type="number" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: Number(e.target.value) })} /></Field><Field label="Credit days" hint="Time or amount, whichever breaches first"><input type="number" value={f.creditDays} onChange={(e) => setF({ ...f, creditDays: Number(e.target.value) })} /></Field>
      <Field label="Firm discount (%)" hint="Off the group rate, on everything they buy. Per-item prices are set from the drawer."><input type="number" value={f.priceAdjPct} onChange={(e) => setF({ ...f, priceAdjPct: Number(e.target.value) })} /></Field>
      <Field label="Gate mode" full><select value={f.gateMode} onChange={(e) => setF({ ...f, gateMode: e.target.value as "WARN" | "BLOCK" })}><option value="WARN">WARN — allow with a recorded reason</option><option value="BLOCK">BLOCK — needs an authorised override</option></select></Field></div>

    <div className="st" style={{ marginTop: 16 }}>Shop location</div>
    <GeoCapture
      lat={f.lat} lng={f.lng} accuracy={f.geoAccuracy} at={customer?.geoAt ?? null}
      onFix={(lat, lng, geoAccuracy) => setF((x) => ({ ...x, lat, lng, geoAccuracy }))}
    />

    <div className="st" style={{ marginTop: 16 }}>Numbers &amp; staff</div>
    <div className="sm" style={{ marginBottom: 7 }}>The owner above is saved automatically. Add the office, accounts or a staff member here — a bill can then be sent to whichever of them handles bills.</div>
    {contacts.map((c, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.3fr 1fr auto", gap: 7, marginBottom: 7, alignItems: "center" }}>
      <input placeholder="Name" value={c.name} onChange={(e) => setC(i, { name: e.target.value })} />
      <select value={c.role} onChange={(e) => setC(i, { role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
      <input placeholder="+91 94141 00000" value={c.phone} onChange={(e) => setC(i, { phone: e.target.value })} />
      <select value={c.authority} onChange={(e) => setC(i, { authority: e.target.value as "Owner" | "Staff" })} title="Owner authority may approve a credit-breaching order"><option value="Staff">Staff authority</option><option value="Owner">Owner authority</option></select>
      <button className="b b-g b-s" onClick={() => setContacts((cs) => cs.filter((_, n) => n !== i))} title="Remove"><Icon n="x" s={11} /></button>
    </div>)}
    <button className="b b-o b-s" onClick={() => setContacts((cs) => [...cs, { name: "", role: "Staff", phone: "", authority: "Staff" }])}>+ Add number</button>

    <div className="st" style={{ marginTop: 16 }}>Machines &amp; equipment</div>
    <div className="sm" style={{ marginBottom: 7 }}>What is on this firm&apos;s floor. Drives consumables reorder prediction and targeted ad slots — and answers which firm is running which machine.</div>
    {machines.map((m, i) => <div key={i} style={{ border: "1px solid var(--bd)", borderRadius: 5, padding: "9px 10px", marginBottom: 7 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 7, alignItems: "center" }}>
        <select value={m.type} onChange={(e) => setM(i, { type: e.target.value })}>{MACHINE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <input placeholder="Make / company" value={m.spec.company ?? ""} onChange={(e) => setSpec(i, "company", e.target.value)} />
        <input placeholder="Model" value={m.spec.model ?? ""} onChange={(e) => setSpec(i, "model", e.target.value)} />
        <input placeholder="Serial no" value={m.spec.serial ?? ""} onChange={(e) => setSpec(i, "serial", e.target.value)} />
        <button className="b b-g b-s" onClick={() => setMachines((ms) => ms.filter((_, n) => n !== i))} title="Remove"><Icon n="x" s={11} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, marginTop: 7 }}>
        <select value={m.spec.status ?? "Running"} onChange={(e) => setSpec(i, "status", e.target.value)}><option>Running</option><option>Idle</option><option>Under repair</option><option>Retired</option></select>
        <input placeholder="Colours" value={m.spec.colours ?? ""} onChange={(e) => setSpec(i, "colours", e.target.value)} />
        <input placeholder="Ink brand" value={m.spec.ink ?? ""} onChange={(e) => setSpec(i, "ink", e.target.value)} />
      </div>
    </div>)}
    <button className="b b-o b-s" onClick={() => setMachines((ms) => [...ms, { type: "Offset", spec: { status: "Running" } }])}>+ Add machine</button>

    <Note style={{ marginTop: 13 }}>Mandatory minimum is firm name, one contact with a phone, and tehsil. Everything else can follow — a half-captured customer is worth more than an abandoned form.</Note>
  </ModalFrame>;
}
export { money2 };
