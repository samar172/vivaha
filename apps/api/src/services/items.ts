import { Prisma } from "@prisma/client";
import { available, band, sumBuckets, type Band } from "@vivaha/shared";
import { prisma, D } from "../db";

// Enriched item view: availability across godowns, per-godown split, band.
export type ItemWithSlabs = Prisma.ItemGetPayload<{ include: { slabs: true; line: true; vendor: true } }>;

export interface GodownSplit { godownId: string; onHand: number; reserved: number; hold: number; damaged: number; quarantined: number; available: number }
export interface ItemView {
  id: string; sku: string; designNo: string | null; name: string; nameHi: string; lineId: string; attrs: Record<string, string>;
  uom: string; packUom: string; perPack: number; moq: number; landedCost: number; hsn: string; gstPct: number; vendorId: string | null;
  status: string; season: string | null; batchTracked: boolean; wastagePct: number | null; setupCharge: number | null; artSeed: number; imageUrl: string | null;
  slabs: { fromQty: number; toQty: number; rate: number }[];
  onHand: number; reserved: number; hold: number; damaged: number; quarantined: number; available: number;
  godowns: GodownSplit[]; band: Band; inTransitEta: string | null;
}

export async function loadItemViews(where: Prisma.ItemWhereInput = {}, godownId?: string | null): Promise<ItemView[]> {
  const [items, balances, inTransit] = await Promise.all([
    prisma.item.findMany({ where, include: { slabs: { orderBy: { fromQty: "asc" } }, line: true }, orderBy: { sku: "asc" } }),
    prisma.stockBalance.findMany(),
    prisma.purchase.findMany({ where: { status: "IN_TRANSIT" }, include: { lines: true } }),
  ]);
  const byItem: Record<string, typeof balances> = {};
  for (const b of balances) (byItem[b.itemId] = byItem[b.itemId] || []).push(b);
  const etaByItem: Record<string, Date> = {};
  for (const p of inTransit) for (const l of p.lines) if (p.eta && (!etaByItem[l.itemId] || p.eta < etaByItem[l.itemId])) etaByItem[l.itemId] = p.eta;
  return items.map((it) => {
    const all = byItem[it.id] || [];
    const tot = sumBuckets(all);
    const gmap: Record<string, GodownSplit> = {};
    for (const b of all) {
      const g = (gmap[b.godownId] = gmap[b.godownId] || { godownId: b.godownId, onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0, available: 0 });
      g.onHand += b.onHand; g.reserved += b.reserved; g.hold += b.hold; g.damaged += b.damaged; g.quarantined += b.quarantined; g.available += available(b);
    }
    const scoped = godownId && godownId !== "ALL" ? gmap[godownId] ?? { onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0, available: 0 } : tot;
    const eta = etaByItem[it.id] ? etaByItem[it.id].toISOString() : null;
    return {
      id: it.id, sku: it.sku, designNo: it.designNo, name: it.name, nameHi: it.nameHi, lineId: it.lineId, attrs: (it.attrs as Record<string, string>) || {},
      uom: it.uom, packUom: it.packUom, perPack: it.perPack, moq: it.moq, landedCost: D(it.landedCost), hsn: it.hsn, gstPct: it.gstPct, vendorId: it.vendorId,
      status: it.status, season: it.season, batchTracked: it.batchTracked, wastagePct: it.wastagePct == null ? null : D(it.wastagePct), setupCharge: it.setupCharge == null ? null : D(it.setupCharge),
      artSeed: it.artSeed, imageUrl: it.imageUrl,
      slabs: it.slabs.map((s) => ({ fromQty: s.fromQty, toQty: s.toQty, rate: D(s.rate) })),
      onHand: scoped.onHand, reserved: scoped.reserved, hold: scoped.hold, damaged: scoped.damaged, quarantined: scoped.quarantined, available: scoped.available,
      godowns: Object.values(gmap),
      band: band(it.line, tot.available, it.uom, eta),
      inTransitEta: eta,
    };
  });
}

export async function loadItemView(id: string, godownId?: string | null): Promise<ItemView | null> {
  const v = await loadItemViews({ id }, godownId);
  return v[0] ?? null;
}
