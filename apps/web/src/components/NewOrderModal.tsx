"use client";
import { useEffect, useMemo, useState } from "react";
import { money, num, type Band } from "@vivaha/shared";
import { useApi, useLines, refresh } from "@/lib/hooks";
import { useUI, errMsg } from "@/lib/ui";
import { post, get } from "@/lib/api";
import { ModalFrame, Field, Note, Empty, GateDot, BandPill, Thumb } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { Customer, Order } from "@/components/types";

interface CatItem { id: string; sku: string; designNo: string | null; name: string; nameHi: string; lineId: string; uom: string; moq: number; available: number; band: Band | null; gstPct: number; artSeed: number; imageUrl: string | null; code: string | null; rate: number }
interface QuoteLine { itemId: string; sku: string; name: string; lineId: string; uom: string; artSeed: number; imageUrl: string | null; qty: number; moq: number; available: number; rate: number; slabRate: number; mult: number; priceSrc: string; amount: number; gstPct: number; short: boolean; belowMoq: boolean }
interface Quote { customer: { id: string; name: string; blockReason: string | null; gateMode: "WARN" | "BLOCK"; linesEnabled: string[] }; lines: QuoteLine[]; totals: { taxable: number; tax: number; total: number }; gate: { status: string; restricted: boolean; mode: string; headroom: number }; lineIds: string[] }

const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// Orders that arrive by telephone, over the counter, or on a list handed to a
// sales executive. Everything the portal decides — rate, slab, credit gate,
// stock — is decided by the server here too; this screen only collects.
export function NewOrderModal({ customerId }: { customerId?: string }) {
  const { closeModal, toast } = useUI();
  const { data: lines } = useLines();
  const { data: customers } = useApi<Customer[]>("/api/customers?line=ALL&q=");
  const [cid, setCid] = useState(customerId ?? "");
  const [lineId, setLineId] = useState("");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [requiredBy, setRequiredBy] = useState(inDays(14));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [quote, setQuote] = useState<{ key: string; q: Quote | null; err: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const firm = customers?.find((c) => c.id === cid);
  // The firm's own enabled lines, minus job work: that is quoted and produced
  // from Jobs, carries no stock, and could never be satisfied as a stock order.
  const enabled = useMemo(
    () => (firm?.linesEnabled ?? []).filter((id) => lines?.find((l) => l.id === id)?.workflow !== "JOBWORK"),
    [firm, lines],
  );
  // Derived, not stored: until the operator picks a line it is the firm's first.
  const effLine = lineId || enabled[0] || "";
  // Changing firm re-prices everything, so the basket cannot carry over.
  const pickFirm = (id: string) => { setCid(id); setLineId(""); setCart({}); setSel(new Set()); };

  const { data: cat } = useApi<{ linesEnabled: string[]; items: CatItem[] }>(cid && effLine ? `/api/orders/catalogue?customerId=${cid}&line=${effLine}&q=${encodeURIComponent(q)}` : null);
  const picked = useMemo(() => Object.entries(cart).filter(([, v]) => v > 0), [cart]);
  const key = useMemo(() => cid + "|" + picked.map(([i, n]) => i + ":" + n).join(","), [cid, picked]);

  // Re-quote on every basket change: the operator reads the server's number.
  // The result is stamped with the basket it priced, so a quote that has been
  // outrun by a keystroke is ignored rather than shown as the live total.
  useEffect(() => {
    if (!cid || !picked.length) return;
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await post<Quote>("/api/orders/quote", { customerId: cid, lines: picked.map(([itemId, qty]) => ({ itemId, qty })) });
        if (!dead) setQuote({ key, q: r, err: "" });
      } catch (e) { if (!dead) setQuote({ key, q: null, err: errMsg(e) }); }
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [cid, picked, key]);

  const fresh = quote?.key === key ? quote : null;
  const qt = picked.length ? fresh?.q ?? null : null;
  const qErr = picked.length ? fresh?.err ?? "" : "";

  const add = (it: CatItem) => setCart((c) => ({ ...c, [it.id]: (c[it.id] ?? 0) + it.moq }));

  // Ticking rows and adding them together. A card house ordering a season's
  // range is putting forty designs on one bill, and clicking Add forty times is
  // how the office ends up keeping the order on paper instead.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const addable = useMemo(() => (cat?.items ?? []).filter((i) => i.available >= i.moq && !cart[i.id]), [cat, cart]);
  const allTicked = addable.length > 0 && addable.every((i) => sel.has(i.id));
  const toggleOne = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel((s) => (allTicked ? new Set([...s].filter((id) => !addable.some((i) => i.id === id))) : new Set([...s, ...addable.map((i) => i.id)])));
  const addTicked = () => {
    const rows = (cat?.items ?? []).filter((i) => sel.has(i.id) && i.available >= i.moq);
    if (!rows.length) return;
    // Each lands at its own minimum, which is where a line has to start anyway.
    setCart((c) => { const n = { ...c }; for (const it of rows) n[it.id] = (n[it.id] ?? 0) + it.moq; return n; });
    setSel(new Set());
    toast(`${rows.length} item${rows.length === 1 ? "" : "s"} added — set the quantities below`, "s");
  };
  // A different firm or line means a different catalogue; the ticks do not carry.
  const ticked = sel.size;

  // A carton is scanned, not typed. The same resolver the portal scanner uses
  // accepts our own label or the manufacturer's, so a box that arrived under a
  // factory code still lands on the right item.
  const scan = async (code: string) => {
    if (!code.trim()) return;
    try {
      const r = await get<{ item: { id: string; sku: string; name: string; lineId: string } }>(`/api/codes/resolve?code=${encodeURIComponent(code.trim())}`);
      const hit = cat?.items.find((i) => i.id === r.item.id);
      if (!hit) { toast(`${r.item.sku} is on another business line — switch the line to add it`, "w"); return; }
      add(hit); setQ(""); toast(`${hit.sku} added`, "s");
    } catch { toast(`No item carries the code ${code.trim()}`, "e"); }
  };
  const setQty = (id: string, n: number) => setCart((c) => ({ ...c, [id]: Math.max(0, n) }));
  const drop = (id: string) => setCart((c) => { const n = { ...c }; delete n[id]; return n; });

  const gate = qt?.gate;
  const blocked = !!firm?.blockReason;
  const needsReason = !!gate?.restricted;
  const hardBlock = gate?.restricted && qt?.customer.gateMode === "BLOCK";
  const bad = qt?.lines.some((l) => l.short || l.belowMoq) ?? false;
  const ready = !!cid && picked.length > 0 && !!qt && !bad && !blocked && (!needsReason || !!reason.trim());

  const submit = async () => {
    setBusy(true);
    try {
      const o = await post<Order>("/api/orders", { customerId: cid, lines: picked.map(([itemId, qty]) => ({ itemId, qty })), requiredBy, note: note.trim() || undefined, overrideReason: reason.trim() || undefined });
      toast(`${o.id} booked for ${firm?.name} — awaiting approval`, "s");
      closeModal();
      refresh("/api/");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <ModalFrame title="New order" onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={!ready || busy} onClick={submit}>{busy ? "Booking…" : "Book order"}</button></>}>

    <div className="fg">
      <Field label="Firm" hint={firm ? `${firm.tehsil} · ${firm.group} · limit ${money(firm.creditLimit)}` : "Who is buying"}>
        <select value={cid} onChange={(e) => pickFirm(e.target.value)}>
          <option value="">Select a firm…</option>
          {customers?.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.tehsil}</option>)}
        </select>
      </Field>
      <Field label="Business line" hint="One line per order — the hold window is set by the line">
        <select value={effLine} onChange={(e) => { setLineId(e.target.value); setCart({}); setSel(new Set()); }} disabled={!firm}>
          {(enabled.length ? enabled : lines?.filter((l) => l.workflow !== "JOBWORK").map((l) => l.id) ?? []).map((id) => <option key={id} value={id}>{lines?.find((l) => l.id === id)?.name ?? id}</option>)}
        </select>
      </Field>
      <Field label="Required by"><input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} /></Field>
      <Field label="Note (optional)" hint="Goes on the order's first event — e.g. how it came in"><input placeholder="e.g. Phoned in by Mr Sharma" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </div>

    {blocked && <Note k="w" style={{ marginTop: 11 }}><b>{firm!.name} is blocked</b> — {firm!.blockReason}. Clear the block from Customers before booking.</Note>}

    {cid && !blocked && <>
      <div className="st" style={{ marginTop: 15 }}>Add items</div>
      <div className="tsr" style={{ marginBottom: 8 }}><Icon n="search" s={13} /><input placeholder="SKU, design number, name — or scan a label and press Enter" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scan(q); } }} /></div>
      {!!addable.length && <div className="tbar" style={{ marginBottom: 7 }}>
        <label className="sm" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input className="ck" type="checkbox" checked={allTicked} onChange={toggleAll} /> Select all {addable.length} available
        </label>
        <button className="b b-p b-s" style={{ marginLeft: "auto" }} disabled={!ticked} onClick={addTicked}>Add {ticked || ""} selected</button>
      </div>}
      <div className="gw" style={{ maxHeight: 190, overflowY: "auto" }}>
        <table className="dg"><thead><tr><th style={{ width: 30 }}></th><th>Item</th><th className="n">MOQ</th><th className="n">Available</th><th className="n">Rate</th><th></th></tr></thead><tbody>
          {cat?.items.length ? cat.items.map((it) => <tr key={it.id} style={{ cursor: "default" }}>
            <td>{it.available >= it.moq && !cart[it.id] ? <input className="ck" type="checkbox" checked={sel.has(it.id)} onChange={() => toggleOne(it.id)} /> : null}</td>
            <td className="w"><div style={{ display: "flex", gap: 7, alignItems: "center" }}><Thumb it={it} w={26} h={34} /><div><div>{it.name}</div><div className="sm"><span className="rid">{it.sku}</span>{it.designNo ? ` · ${it.designNo}` : ""}</div></div></div></td>
            <td className="n tab">{num(it.moq)}</td>
            <td className="n tab">{num(it.available)} <BandPill b={it.band} /></td>
            <td className="n tab">{money(it.rate)}<div className="sm">at MOQ</div></td>
            <td>{cart[it.id] ? <span className="sm">Added</span> : <button className="b b-o b-s" disabled={it.available < it.moq} onClick={() => add(it)}>Add</button>}</td>
          </tr>) : <tr><td colSpan={6}><Empty t="No items" d="Nothing active in this line matches that search." /></td></tr>}
        </tbody></table>
      </div>

      <div className="st" style={{ marginTop: 15 }}>Order lines</div>
      {picked.length ? <div className="gw">
        <table className="dg"><thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Amount</th><th></th></tr></thead><tbody>
          {picked.map(([id, qty]) => {
            const l = qt?.lines.find((x) => x.itemId === id);
            const it = cat?.items.find((x) => x.id === id);
            return <tr key={id} style={{ cursor: "default" }}>
              <td className="w">{l?.name ?? it?.name ?? id}<div className="sm"><span className="rid">{l?.sku ?? it?.sku}</span>{l?.short ? <span style={{ color: "var(--er)" }}> · only {num(l.available)} available</span> : l?.belowMoq ? <span style={{ color: "var(--er)" }}> · below MOQ {num(l.moq)}</span> : null}</div></td>
              <td className="n"><input type="number" style={{ width: 88, textAlign: "right" }} value={qty} onChange={(e) => setQty(id, Number(e.target.value))} /></td>
              <td className="n tab">{l ? <>{money(l.rate)}<div className="sm">{l.priceSrc}</div></> : "…"}</td>
              <td className="n tab" style={{ fontWeight: 600 }}>{l ? money(l.amount) : "…"}</td>
              <td><button className="b b-g b-s" onClick={() => drop(id)}><Icon n="x" s={11} /></button></td>
            </tr>;
          })}
        </tbody></table>
      </div> : <Empty t="No lines yet" d="Add an item above to start the order." />}

      {qErr && <Note k="w" style={{ marginTop: 10 }}>{qErr}</Note>}

      {qt && <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "start" }}>
        <div>
          <Note k={gate?.restricted ? "w" : "i"}>
            <GateDot status={gate!.status} /> <b>Credit {gate!.restricted ? (gate!.mode === "BLOCK" ? "gate — BLOCK" : "gate — warning") : "OK"}</b>
            {gate!.restricted ? ` · this order takes ${qt.customer.name} past its limit.` : ` · headroom ${money(gate!.headroom)} after this order.`}
          </Note>
          {needsReason && <Field label="Reason for booking past the gate (required)" full>
            <input placeholder="e.g. Long-standing firm, cheque in hand" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>}
          {hardBlock && <Note k="w" style={{ marginTop: 8 }}>This firm is gated <b>BLOCK</b> — only a role with <b>credit.override</b> (Accounts Manager or Super Admin) can raise this order.</Note>}
        </div>
        <div style={{ minWidth: 210 }}>
          <div className="df"><span className="k">Taxable</span><span className="v m">{money(qt.totals.taxable)}</span></div>
          <div className="df"><span className="k">GST</span><span className="v m">{money(qt.totals.tax)}</span></div>
          <div className="df" style={{ borderTop: "1px solid var(--bd-soft)", marginTop: 5, paddingTop: 7 }}><span className="k"><b>Total</b></span><span className="v m" style={{ fontWeight: 700 }}>{money(qt.totals.total)}</span></div>
        </div>
      </div>}

      <Note k="i" style={{ marginTop: 12 }}>Booking holds the stock and puts the order in <b>Awaiting approval</b>, exactly like a portal booking — it does not skip the approval step.</Note>
    </>}
  </ModalFrame>;
}
