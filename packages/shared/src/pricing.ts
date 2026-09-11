// F-02: quantity slab × customer-group multiplier, with a per-customer override
// that outranks both, and a margin floor that stops silent under-pricing.
export interface PriceSlab { fromQty: number; toQty: number; rate: number }
export interface PriceableItem { id: string; landedCost: number; moq: number; slabs: PriceSlab[] }

export const DEFAULT_MIN_MARGIN = 0.18;
export const DEFAULT_GROUP_MULTIPLIERS: Record<string, number> = {
  Cash: 1.2, Regular: 1.25, Credit: 1.35, Dealer: 1.18, Distributor: 1.12, Premium: 1.15,
};

export function slabRate(slabs: PriceSlab[], qty: number): number {
  const s = slabs.find((x) => qty >= x.fromQty && qty <= x.toQty);
  return s ? s.rate : slabs[0] ? slabs[0].rate : 0;
}

export function nextSlab(slabs: PriceSlab[], qty: number): PriceSlab | null {
  return slabs.find((x) => x.fromQty > (qty || 0)) ?? null;
}

export function marginFloor(landedCost: number, minMargin = DEFAULT_MIN_MARGIN): number {
  return Math.round(landedCost * (1 + minMargin));
}

// A per-item arrangement with one firm. FLAT freezes the rupee figure; PERCENT
// keeps a negotiated discount riding on top of the published slab, so it stays
// correct the next time the price list moves.
export type PriceAdjust =
  | { mode: "FLAT"; rate: number }
  | { mode: "PERCENT"; pct: number };

export interface PriceResult {
  rate: number;
  /** Where the final rate came from — shown to the operator so a price is never unexplained. */
  src: "override" | "override-pct" | "customer" | "slab";
  slab: number;
  mult: number;
  /** The band the quantity fell in, so a screen can say which slab applied. */
  slabFrom: number;
  slabTo: number;
  /** The published rate before any firm-specific arrangement. */
  listRate: number;
  /** Firm-wide percentage adjustment that was applied, if any. */
  adjPct: number;
  floor: number;
  belowFloor: boolean;
  margin: number;
}

const pctOff = (base: number, pct: number) => Math.round(base * (1 - pct / 100));

export function priceFor(
  item: PriceableItem,
  groupMultiplier: number,
  qty: number,
  override?: PriceAdjust | number | null,
  minMargin = DEFAULT_MIN_MARGIN,
  customerAdjPct = 0
): PriceResult {
  const q = qty || item.moq;
  const band = item.slabs.find((x) => q >= x.fromQty && q <= x.toQty) ?? item.slabs[0];
  const slab = band ? band.rate : 0;
  const mult = groupMultiplier ?? 1.25;

  // The published rate: quantity slab times the firm's group multiplier.
  const listRate = Math.round(slab * mult);
  // A firm-wide arrangement applies to everything they buy...
  const adjPct = customerAdjPct || 0;
  const afterAdj = adjPct ? pctOff(listRate, adjPct) : listRate;

  // ...and a per-item one outranks it.
  let rate = afterAdj;
  let src: PriceResult["src"] = adjPct ? "customer" : "slab";
  if (override != null) {
    if (typeof override === "number") { rate = override; src = "override"; }
    else if (override.mode === "FLAT") { rate = override.rate; src = "override"; }
    else { rate = pctOff(listRate, override.pct); src = "override-pct"; }
  }

  const floor = marginFloor(item.landedCost, minMargin);
  return {
    rate, src, slab, mult,
    slabFrom: band?.fromQty ?? 0, slabTo: band?.toQty ?? 0,
    listRate, adjPct,
    floor, belowFloor: rate < floor, margin: rate > 0 ? (rate - item.landedCost) / rate : 0,
  };
}

// Weighted-average landed cost after a goods receipt (freight apportioned).
export function recomputeLandedCost(oldCost: number, onHandBefore: number, qty: number, rate: number, freight: number): number {
  const total = Math.max(1, onHandBefore + qty);
  return Math.round((oldCost * Math.max(0, onHandBefore) + (qty * rate + freight)) / total);
}
