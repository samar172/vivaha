// F-02: quantity slab × customer-group multiplier, with a per-customer override
// that outranks both, and a margin floor that stops silent under-pricing.
export interface PriceSlab { fromQty: number; toQty: number; rate: number }
export interface PriceableItem {
  id: string; landedCost: number; moq: number; slabs: PriceSlab[];
  /** Set on the item to fix its markup whoever is buying; null follows the
   *  firm's pricing group, which is the normal case. */
  multiplier?: number | null;
}

// Money is kept to the paisa, everywhere except the one place a bill is
// actually rounded — the invoice total. A rate of ₹13.20 that the engine
// rounded to ₹13 is not a display quirk: it is a different price, and on a
// carton of ten thousand cards it is two thousand rupees. Every intermediate
// figure here — the list rate, a percentage off it, the margin floor, the
// landed cost — is held to two places for that reason.
export const paise = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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
  return paise(landedCost * (1 + minMargin));
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
  /** True when the multiplier came from the item rather than the firm's group. */
  multFromItem: boolean;
  /** The published rate before any firm-specific arrangement. */
  listRate: number;
  /** Firm-wide percentage adjustment that was applied, if any. */
  adjPct: number;
  floor: number;
  belowFloor: boolean;
  margin: number;
}

const pctOff = (base: number, pct: number) => paise(base * (1 - pct / 100));

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
  // An item may carry its own multiplier, which replaces the firm's group one.
  // Some designs sell at a fixed markup whoever is buying — an exclusive block,
  // a licensed motif — and before this the only way to say so was to give every
  // firm a per-item override one at a time.
  const mult = item.multiplier != null && item.multiplier > 0 ? item.multiplier : (groupMultiplier ?? 1.25);

  // The published rate: quantity slab times the multiplier, to the paisa.
  const listRate = paise(slab * mult);
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
    rate: paise(rate), src, slab, mult,
    slabFrom: band?.fromQty ?? 0, slabTo: band?.toQty ?? 0,
    multFromItem: item.multiplier != null && item.multiplier > 0,
    listRate, adjPct,
    floor, belowFloor: paise(rate) < floor, margin: rate > 0 ? (rate - item.landedCost) / rate : 0,
  };
}

// Weighted-average landed cost after a goods receipt (freight apportioned).
export function recomputeLandedCost(oldCost: number, onHandBefore: number, qty: number, rate: number, freight: number): number {
  const total = Math.max(1, onHandBefore + qty);
  // To the paisa. Rounding a landed cost to the rupee moved the margin floor
  // under every item it touched, and a floor is the one number that must not
  // drift on its own.
  return paise((oldCost * Math.max(0, onHandBefore) + (qty * rate + freight)) / total);
}
