// F-03 / BR-03: the ledger is the only source of truth for outstanding.
// Time or amount, whichever breaches first.
export type LedgerType = "OPENING" | "INVOICE" | "PAYMENT" | "CREDIT";
export interface LedgerLine { id?: string; date: string | Date; type: LedgerType; ref: string; particular: string; debit: number; credit: number }

export const ageDays = (d: string | Date, today: Date = new Date()) =>
  Math.max(0, Math.floor((today.getTime() - new Date(d).getTime()) / 864e5));

export function outstanding(entries: LedgerLine[]): number {
  return entries.reduce((s, e) => s + (e.debit || 0) - (e.credit || 0), 0);
}

// FIFO: payments and credits settle the oldest debits first.
export function oldestUnpaid(entries: LedgerLine[]): LedgerLine | null {
  const inv = entries.filter((e) => e.type === "INVOICE" || e.type === "OPENING");
  let paid = entries.filter((e) => e.type === "PAYMENT" || e.type === "CREDIT").reduce((s, e) => s + e.credit, 0);
  for (const e of inv.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())) {
    if (paid >= e.debit) { paid -= e.debit; continue; }
    return e;
  }
  return null;
}

export interface CreditCustomer { creditLimit: number; creditDays: number; gateMode: "WARN" | "BLOCK" }
export type GateStatus = "ok" | "near" | "warn" | "block";
export interface CreditGate {
  out: number; oldestAge: number; oldestRef: string | null;
  amountBreach: boolean; timeBreach: boolean; restricted: boolean;
  mode: "WARN" | "BLOCK"; util: number; status: GateStatus;
}

export function creditGate(cust: CreditCustomer, entries: LedgerLine[], orderValue = 0, today: Date = new Date()): CreditGate {
  const out = outstanding(entries), ou = oldestUnpaid(entries);
  const oldestAge = ou ? ageDays(ou.date, today) : 0;
  const amountBreach = out + orderValue > cust.creditLimit;
  const timeBreach = cust.creditDays > 0 && oldestAge > cust.creditDays;
  const restricted = amountBreach || timeBreach;
  const util = cust.creditLimit > 0 ? (out + orderValue) / cust.creditLimit : 0;
  return {
    out, oldestAge, oldestRef: ou ? ou.ref : null, amountBreach, timeBreach, restricted, mode: cust.gateMode, util,
    status: restricted ? (cust.gateMode === "BLOCK" ? "block" : "warn") : util > 0.85 ? "near" : "ok",
  };
}

export const AGEING_LABELS = ["Current", "1–30", "31–60", "61–90", "90+"] as const;
export function ageing(entries: LedgerLine[], today: Date = new Date()): { buckets: number[]; labels: readonly string[] } {
  const b = [0, 0, 0, 0, 0];
  let paid = entries.filter((e) => e.type === "PAYMENT" || e.type === "CREDIT").reduce((s, e) => s + e.credit, 0);
  entries
    .filter((e) => e.type === "INVOICE" || e.type === "OPENING")
    .sort((a, c) => new Date(a.date).getTime() - new Date(c.date).getTime())
    .forEach((e) => {
      let due = e.debit;
      if (paid > 0) { const u = Math.min(paid, due); due -= u; paid -= u; }
      if (due <= 0) return;
      const a = ageDays(e.date, today);
      b[a <= 0 ? 0 : a <= 30 ? 1 : a <= 60 ? 2 : a <= 90 ? 3 : 4] += due;
    });
  return { buckets: b, labels: AGEING_LABELS };
}

export function ledgerWithBalance<T extends LedgerLine>(entries: T[]): (T & { bal: number })[] {
  let run = 0;
  return entries
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((r) => { run += (r.debit || 0) - (r.credit || 0); return { ...r, bal: run }; });
}
