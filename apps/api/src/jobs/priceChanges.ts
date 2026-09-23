import { Prisma } from "@prisma/client";
import { prisma, D } from "../db";
import { audit } from "../services/audit";
import { notify } from "../services/notify";

// Price changes keyed in advance, applied when their date arrives.
//
// A price list is agreed before it starts — "from the first of next month" —
// and the office should be able to key it the day it is agreed rather than
// remember to do it on the morning. Until the date arrives the item keeps the
// rates it has, so every order in between is priced on what was published.
//
// Applied here rather than read at quote time on purpose: once it lands, the
// item's own rates are the truth, exactly as if somebody had typed them that
// morning, and every screen, report and export that already reads slabs keeps
// working without learning what a pending change is.

export interface Slab { fromQty: number; toQty: number; rate: number }

export async function applyDuePriceChanges(now = new Date()): Promise<number> {
  const due = await prisma.priceChange.findMany({
    where: { status: "PENDING", effectiveFrom: { lte: now } },
    include: { item: { select: { id: true, sku: true, name: true, landedCost: true, purchasePrice: true, multiplier: true, slabs: { orderBy: { fromQty: "asc" } } } } },
    // Oldest first: two changes queued for one item must land in the order they
    // were meant to, so the later one is what the item ends up on.
    orderBy: { effectiveFrom: "asc" },
  });
  if (!due.length) return 0;

  for (const ch of due) {
    const slabs = (ch.slabs as unknown as Slab[]) ?? [];
    const wasFirst = ch.item.slabs[0] ? D(ch.item.slabs[0].rate) : 0;
    const nowFirst = slabs[0]?.rate ?? wasFirst;
    await prisma.$transaction(async (tx) => {
      if (slabs.length) {
        await tx.priceSlab.deleteMany({ where: { itemId: ch.itemId } });
        await tx.priceSlab.createMany({ data: slabs.map((s) => ({ itemId: ch.itemId, fromQty: s.fromQty, toQty: s.toQty, rate: s.rate })) });
      }
      await tx.item.update({
        where: { id: ch.itemId },
        data: {
          ...(ch.purchasePrice != null ? { purchasePrice: ch.purchasePrice } : {}),
          // A change may deliberately clear the item's own multiplier and hand
          // it back to the firm's pricing group, so undefined and null differ.
          ...(ch.multiplier !== null ? { multiplier: ch.multiplier } : { multiplier: null }),
          ...(ch.priceBasis ? { priceBasis: ch.priceBasis } : {}),
          ...(ch.manualBase != null ? { manualBase: ch.manualBase } : {}),
        },
      });
      await tx.priceChange.update({ where: { id: ch.id }, data: { status: "APPLIED", appliedAt: new Date() } });
      if (slabs.length && nowFirst !== wasFirst) {
        await tx.itemPriceHistory.create({ data: {
          itemId: ch.itemId, field: "slab1", oldValue: wasFirst, newValue: nowFirst,
          by: ch.by, reason: ch.reason || `Scheduled price list, effective ${ch.effectiveFrom.toISOString().slice(0, 10)}`,
        } as unknown as Prisma.ItemPriceHistoryUncheckedCreateInput });
      }
      await audit(tx, {
        actor: ch.by, action: "Scheduled price change applied", entityType: "Item", entityId: ch.item.sku,
        oldValue: `₹${wasFirst}`, newValue: `₹${nowFirst}`,
        reason: ch.reason || `Effective ${ch.effectiveFrom.toISOString().slice(0, 10)}`,
      });
    });
  }

  const first = due[0];
  await notify(prisma, {
    text: due.length === 1
      ? `New price in force for ${first.item.name}`
      : `New prices in force for ${due.length} items`,
    kind: "INFO", role: "SALES_EXECUTIVE", link: "/prices",
  });
  return due.length;
}

export function startPriceChangeSweeper(intervalMs = 60_000) {
  const run = () => applyDuePriceChanges().catch((e) => console.error("priceChanges", e));
  run();
  return setInterval(run, intervalMs);
}
