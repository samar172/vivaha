import { prisma } from "../db";
import { availAll } from "../services/stock";
import { audit } from "../services/audit";
import { notify } from "../services/notify";

// The other half of not losing the sale. A firm asked for two thousand, found
// sixteen hundred, and said "tell me when it's back". Stock lands a week later
// from a goods receipt, a transfer or a recovery from damaged — and nobody
// remembers the conversation.
//
// This watches for it. A request is raised once, when there is enough stock to
// cover what the firm actually asked for, to the executive who covers them so
// somebody rings — this is a business done on the phone, and a notification the
// customer never opens is not a callback. The portal also shows the firm their
// own waiting items.
//
// Deliberately not hooked into the receive path: stock arrives through four
// different routes and a sweeper that reads the balances cannot miss one.
export async function sweepBackInStock(): Promise<number> {
  const waiting = await prisma.stockoutSearch.findMany({
    where: { notifyWanted: true, notifiedAt: null, customerId: { not: null } },
    include: {
      item: { select: { id: true, sku: true, name: true, uom: true } },
      customer: { select: { id: true, name: true, salesExecId: true, contactName: true } },
    },
    orderBy: { at: "asc" },
  });
  if (!waiting.length) return 0;

  // One availability read per item, however many firms are waiting on it.
  const byItem = new Map<string, number>();
  for (const w of waiting) {
    if (!byItem.has(w.itemId)) byItem.set(w.itemId, await availAll(prisma, w.itemId));
  }

  let raised = 0;
  for (const w of waiting) {
    const avail = byItem.get(w.itemId) ?? 0;
    // Enough to cover what they asked for. Telling a firm their two thousand is
    // back when forty turned up is how a callback becomes an apology.
    if (avail < w.reqQty) continue;

    await prisma.$transaction(async (tx) => {
      await tx.stockoutSearch.update({ where: { id: w.id }, data: { notifiedAt: new Date() } });
      const text = `${w.item.sku} is back — ${w.customer!.name} wanted ${w.reqQty.toLocaleString("en-IN")} ${w.item.uom.toLowerCase()} and ${avail.toLocaleString("en-IN")} is available now`;
      const link = `/customers/${w.customerId}`;
      if (w.customer!.salesExecId) await notify(tx, { text, kind: "OK", userId: w.customer!.salesExecId, link });
      else await notify(tx, { text, kind: "OK", role: "SALES_EXECUTIVE", link });
      await audit(tx, { actor: "System", action: "Back-in-stock callback raised", entityType: "Item", entityId: w.item.sku, oldValue: `short by ${w.reqQty - w.availQty}`, newValue: `${avail} available`, reason: `${w.customer!.name} asked to be told` });
    });
    raised++;
  }
  return raised;
}

export function startBackInStockSweeper(intervalMs = 60_000) {
  const run = () => sweepBackInStock().catch((e) => console.error("backInStock", e));
  run();
  return setInterval(run, intervalMs);
}
