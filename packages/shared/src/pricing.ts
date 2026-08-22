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

export interface PriceResult {
  rate: number;
  src: "override" | "slab";
  slab: number;
  mult: number;
  floor: number;
  belowFloor: boolean;
  margin: number;
}

export function priceFor(
  item: PriceableItem,
  groupMultiplier: number,
  qty: number,
  override?: number | null,
  minMargin = DEFAULT_MIN_MARGIN
): PriceResult {
  const slab = slabRate(item.slabs, qty || item.moq);
  const mult = groupMultiplier ?? 1.25;
  let rate: number, src: PriceResult["src"];
  if (override != null) { rate = override; src = "override"; }
  else { rate = Math.round(slab * mult); src = "slab"; }
  const floor = marginFloor(item.landedCost, minMargin);
  return { rate, src, slab, mult, floor, belowFloor: rate < floor, margin: rate > 0 ? (rate - item.landedCost) / rate : 0 };
}

// Weighted-average landed cost after a goods receipt (freight apportioned).
export function recomputeLandedCost(oldCost: number, onHandBefore: number, qty: number, rate: number, freight: number): number {
  const total = Math.max(1, onHandBefore + qty);
  return Math.round((oldCost * Math.max(0, onHandBefore) + (qty * rate + freight)) / total);
}
