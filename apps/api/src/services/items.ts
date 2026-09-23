import { Prisma } from "@prisma/client";
import { available, band, sumBuckets, type Band } from "@vivaha/shared";
import { prisma, D } from "../db";

// Enriched item view: availability across godowns, per-godown split, band.
export type ItemWithSlabs = Prisma.ItemGetPayload<{ include: { slabs: true; line: true; vendor: true } }>;

/** What sits on one rack inside a godown, so a picker can be told where to go. */
export interface RackSplit { rack: string; onHand: number; available: number; firstIn: string | null }
export interface GodownSplit {
  godownId: string; onHand: number; reserved: number; hold: number; damaged: number; quarantined: number; available: number;
  /** When the oldest pile still available here landed — what first-in-first-out
   *  sorts on. Null when nothing available, or nothing on file about its age. */
  oldestAt: string | null;
  racks: RackSplit[];
}
export interface ItemView {
  id: string; sku: string; designNo: string | null; name: string; nameHi: string; lineId: string; attrs: Record<string, string>;
  uom: string; packUom: string; perPack: number; moq: number; landedCost: number; hsn: string; gstPct: number; vendorId: string | null;
  /** The item's own markup, replacing the buying firm's group multiplier. */
  multiplier: number | null;
  status: string; season: string | null; batchTracked: boolean; wastagePct: number | null; setupCharge: number | null; artSeed: number; imageUrl: string | null;
  slabs: { fromQty: number; toQty: number; rate: number }[];
  onHand: number; reserved: number; hold: number; damaged: number; quarantined: number; available: number;
  godowns: GodownSplit[]; band: Band; inTransitEta: string | null;
  code: string | null; codeKind: "OWN" | "MANUFACTURER" | null; codeCount: number;
  /** Every page of the card, in the order it opens. imageUrl is page one. */
  images: { id: string; url: string; label: string }[];
}

export async function loadItemViews(where: Prisma.ItemWhereInput = {}, godownId?: string | null): Promise<ItemView[]> {
  const [items, balances, inTransit] = await Promise.all([
    prisma.item.findMany({ where, include: { slabs: { orderBy: { fromQty: "asc" } }, line: true, codes: { select: { code: true, kind: true, status: true } }, images: { orderBy: { sortOrder: "asc" }, select: { id: true, url: true, label: true } } }, orderBy: { sku: "asc" } }),
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
      const g = (gmap[b.godownId] = gmap[b.godownId] || { godownId: b.godownId, onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0, available: 0, oldestAt: null, racks: [] });
      g.onHand += b.onHand; g.reserved += b.reserved; g.hold += b.hold; g.damaged += b.damaged; g.quarantined += b.quarantined;
      const av = available(b);
      g.available += av;
      const r = g.racks.find((x) => x.rack === b.rack) ?? (g.racks[g.racks.push({ rack: b.rack, onHand: 0, available: 0, firstIn: null }) - 1]);
      r.onHand += b.onHand; r.available += av;
      if (b.firstIn && (!r.firstIn || b.firstIn.toISOString() < r.firstIn)) r.firstIn = b.firstIn.toISOString();
      // Only stock that can actually be given out sets the age of the pile —
      // a rack holding nothing but damaged goods must not make this godown
      // look like the oldest one and pull an allocation towards it.
      if (av > 0 && b.firstIn && (!g.oldestAt || b.firstIn.toISOString() < g.oldestAt)) g.oldestAt = b.firstIn.toISOString();
    }
    for (const g of Object.values(gmap)) g.racks.sort((a, b) => a.rack.localeCompare(b.rack, undefined, { numeric: true }));
    const scoped = godownId && godownId !== "ALL" ? gmap[godownId] ?? { onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0, available: 0 } : tot;
    const eta = etaByItem[it.id] ? etaByItem[it.id].toISOString() : null;
    return {
      id: it.id, sku: it.sku, designNo: it.designNo, name: it.name, nameHi: it.nameHi, lineId: it.lineId, attrs: (it.attrs as Record<string, string>) || {},
      uom: it.uom, packUom: it.packUom, perPack: it.perPack, moq: it.moq, landedCost: D(it.landedCost), hsn: it.hsn, gstPct: it.gstPct, vendorId: it.vendorId,
      multiplier: it.multiplier == null ? null : D(it.multiplier),
      status: it.status, season: it.season, batchTracked: it.batchTracked, wastagePct: it.wastagePct == null ? null : D(it.wastagePct), setupCharge: it.setupCharge == null ? null : D(it.setupCharge),
      artSeed: it.artSeed, imageUrl: it.imageUrl, images: it.images,
      // The code the office prints today, plus the manufacturer label it replaced.
      code: it.codes.find((c) => c.status === "ACTIVE" && c.kind === "OWN")?.code
        ?? it.codes.find((c) => c.status === "ACTIVE")?.code ?? null,
      codeKind: (it.codes.find((c) => c.status === "ACTIVE" && c.kind === "OWN") ? "OWN"
        : it.codes.find((c) => c.status === "ACTIVE")?.kind ?? null) as "OWN" | "MANUFACTURER" | null,
      codeCount: it.codes.length,
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
