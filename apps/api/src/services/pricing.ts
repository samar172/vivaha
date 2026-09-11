import { priceFor, DEFAULT_GROUP_MULTIPLIERS, type PriceResult, type PriceAdjust } from "@vivaha/shared";
import { prisma, D } from "../db";
import { getMinMargin } from "./settings";
import type { ItemView } from "./items";

export async function groupMultiplier(group: string): Promise<number> {
  const g = await prisma.pricingGroup.findUnique({ where: { name: group } });
  return g ? D(g.multiplier) : DEFAULT_GROUP_MULTIPLIERS[group] ?? 1.25;
}

type Priceable = Pick<ItemView, "id" | "landedCost" | "moq" | "slabs">;
type PricedCustomer = { id: string; group: string; priceAdjPct?: unknown };

// Rows come out of the database as Decimals; the engine wants numbers.
const toAdjust = (o: { mode: string; rate: unknown; pct: unknown } | null | undefined): PriceAdjust | null =>
  !o ? null : o.mode === "PERCENT" ? { mode: "PERCENT", pct: D(o.pct as number) } : { mode: "FLAT", rate: D(o.rate as number) };

const adjPctOf = (c: PricedCustomer) => (c.priceAdjPct == null ? 0 : D(c.priceAdjPct as number));

export async function priceForCustomer(item: Priceable, customer: PricedCustomer, qty: number): Promise<PriceResult> {
  const [mult, ov, minMargin] = await Promise.all([
    groupMultiplier(customer.group),
    prisma.priceOverride.findUnique({ where: { customerId_itemId: { customerId: customer.id, itemId: item.id } } }),
    getMinMargin(),
  ]);
  return priceFor(item, mult, qty, toAdjust(ov), minMargin, adjPctOf(customer));
}

// Batch variant for catalogue rendering: one multiplier + one override map.
export async function pricerFor(customer: PricedCustomer) {
  const [mult, ovs, minMargin] = await Promise.all([
    groupMultiplier(customer.group),
    prisma.priceOverride.findMany({ where: { customerId: customer.id } }),
    getMinMargin(),
  ]);
  const ovMap: Record<string, PriceAdjust> = {};
  for (const o of ovs) { const a = toAdjust(o); if (a) ovMap[o.itemId] = a; }
  const adj = adjPctOf(customer);
  return (item: Priceable, qty: number) => priceFor(item, mult, qty, ovMap[item.id] ?? null, minMargin, adj);
}
