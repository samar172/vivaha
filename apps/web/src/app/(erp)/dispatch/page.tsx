"use client";
import { money, fDate, dueLbl, daysTo } from "@vivaha/shared";
import { useApi } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { useUI } from "@/lib/ui";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { Pill, LineChip, Empty, Panel } from "@/components/ui";
import { OrderDrawer, useOrderActions } from "@/components/OrderDrawer";
import type { Order } from "@/components/types";
import { Icon } from "@/components/icons";

export default function DispatchPage() {
  const { line } = useAppState(); const { openDrawer, toast } = useUI(); const A = useOrderActions();
  const { data } = useApi<{ orders: Order[] }>(`/api/orders?tab=dispatch&line=${line}`, { refreshInterval: 20000 });
  const rows = (data?.orders ?? []).slice().sort((a, b) => new Date(a.requiredBy).getTime() - new Date(b.requiredBy).getTime());
  useFooter(rows.length);
  const byT: Record<string, Order[]> = {}; rows.forEach((o) => (byT[o.customer.tehsil] = byT[o.customer.tehsil] || []).push(o));
  return <>
    <PageHead crumb={["Sales", "Dispatch"]} title="Dispatch queue" sub="Sorted by required-by date and grouped by destination tehsil, so one consignment can serve a route" actions={<><button className="b b-o" onClick={() => toast("Consignment manifest printed", "s")}><Icon n="download" s={13} /> Manifest</button><button className="b b-o" onClick={() => toast("Package labels sent to printer", "s")}><Icon n="printer" s={13} /> Labels</button></>} />
    <div className="wa">{!rows.length && <div className="gw"><Empty t="Dispatch queue is clear" d="No orders staged for shipping in this line." /></div>}
      {Object.keys(byT).sort().map((t) => <Panel key={t} t={<><Icon n="pin" s={13} /> {t}</>} h={`${byT[t].length} consignment${byT[t].length === 1 ? "" : "s"} · ${money(byT[t].reduce((s, o) => s + o.total, 0))}`}><div className="gw" style={{ border: "none", borderRadius: 0 }}><table className="dg"><thead><tr><th>Order</th><th>Firm</th><th>Lines</th><th className="n">Value</th><th>Required by</th><th>Status</th><th>Godowns</th><th></th></tr></thead><tbody>
        {byT[t].map((o) => { const rd = daysTo(o.requiredBy); const gds = [...new Set(o.lines.flatMap((l) => Object.keys(l.alloc)))]; return <tr key={o.id} onClick={() => openDrawer(<OrderDrawer id={o.id} />)}><td><span className="rid">{o.id}</span></td><td className="w">{o.customer.name}</td><td>{[...new Set(o.lines.map((l) => l.lineId))].map((l) => <LineChip key={l} id={l} />)}</td><td className="n tab">{money(o.total)}</td><td style={{ color: rd <= 7 ? "var(--er)" : "inherit" }}>{fDate(o.requiredBy)} <span className="sm">{dueLbl(o.requiredBy)}</span></td><td><Pill s={o.status} /></td><td className="sm">{gds.join(", ") || "—"}</td><td>{A.actionBtn(o)}</td></tr>; })}
      </tbody></table></div></Panel>)}
    </div>
  </>;
}
