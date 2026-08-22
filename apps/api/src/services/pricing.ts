import { priceFor, DEFAULT_GROUP_MULTIPLIERS, type PriceResult } from "@vivaha/shared";
import { prisma, D } from "../db";
import { getMinMargin } from "./settings";
import type { ItemView } from "./items";

export async function groupMultiplier(group: string): Promise<number> {
  const g = await prisma.pricingGroup.findUnique({ where: { name: group } });
  return g ? D(g.multiplier) : DEFAULT_GROUP_MULTIPLIERS[group] ?? 1.25;
}

export async function priceForCustomer(item: Pick<ItemView, "id" | "landedCost" | "moq" | "slabs">, customer: { id: string; group: string }, qty: number): Promise<PriceResult> {
  const [mult, ov, minMargin] = await Promise.all([
    groupMultiplier(customer.group),
    prisma.priceOverride.findUnique({ where: { customerId_itemId: { customerId: customer.id, itemId: item.id } } }),
    getMinMargin(),
  ]);
  return priceFor(item, mult, qty, ov ? D(ov.rate) : null, minMargin);
}

// Batch variant for catalogue rendering: one multiplier + one override map.
export async function pricerFor(customer: { id: string; group: string }) {
  const [mult, ovs, minMargin] = await Promise.all([
    groupMultiplier(customer.group),
    prisma.priceOverride.findMany({ where: { customerId: customer.id } }),
    getMinMargin(),
  ]);
  const ovMap: Record<string, number> = {};
  for (const o of ovs) ovMap[o.itemId] = D(o.rate);
  return (item: Pick<ItemView, "id" | "landedCost" | "moq" | "slabs">, qty: number) => priceFor(item, mult, qty, ovMap[item.id] ?? null, minMargin);
}
