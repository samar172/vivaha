import { creditGate, ageing, ledgerWithBalance, outstanding, type LedgerLine, type CreditGate } from "@vivaha/shared";
import { prisma, D } from "../db";

export async function ledgerLines(customerId: string): Promise<(LedgerLine & { id: string })[]> {
  const rows = await prisma.ledgerEntry.findMany({ where: { customerId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ id: r.id, date: r.date, type: r.type, ref: r.ref, particular: r.particular, debit: D(r.debit), credit: D(r.credit) }));
}

export async function gateFor(customer: { id: string; creditLimit: unknown; creditDays: number; gateMode: "WARN" | "BLOCK" }, orderValue = 0): Promise<CreditGate> {
  const lines = await ledgerLines(customer.id);
  return creditGate({ creditLimit: D(customer.creditLimit as number), creditDays: customer.creditDays, gateMode: customer.gateMode }, lines, orderValue);
}

export async function customerFinance(customer: { id: string; creditLimit: unknown; creditDays: number; gateMode: "WARN" | "BLOCK" }, orderValue = 0) {
  const lines = await ledgerLines(customer.id);
  const c = { creditLimit: D(customer.creditLimit as number), creditDays: customer.creditDays, gateMode: customer.gateMode };
  return { gate: creditGate(c, lines, orderValue), ageing: ageing(lines), outstanding: outstanding(lines), statement: ledgerWithBalance(lines) };
}

// Batch variant: compute gates for many customers with one query.
export async function gatesForAll(customers: { id: string; creditLimit: unknown; creditDays: number; gateMode: "WARN" | "BLOCK" }[]) {
  const rows = await prisma.ledgerEntry.findMany({ where: { customerId: { in: customers.map((c) => c.id) } }, orderBy: { date: "asc" } });
  const by: Record<string, LedgerLine[]> = {};
  for (const r of rows) (by[r.customerId] = by[r.customerId] || []).push({ date: r.date, type: r.type, ref: r.ref, particular: r.particular, debit: D(r.debit), credit: D(r.credit) });
  const out: Record<string, { gate: CreditGate; ageing: number[] }> = {};
  for (const c of customers) {
    const l = by[c.id] || [];
    out[c.id] = { gate: creditGate({ creditLimit: D(c.creditLimit as number), creditDays: c.creditDays, gateMode: c.gateMode }, l), ageing: ageing(l).buckets };
  }
  return out;
}
