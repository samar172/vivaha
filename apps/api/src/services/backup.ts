import { Prisma } from "@prisma/client";
import { prisma } from "../db";

// Parent-first. Reversed, this is also the safe delete order — it is the same
// order the seed truncates in, kept in one place so the two cannot drift.
export const BACKUP_MODELS = [
  "Setting", "Sequence", "RolePermission", "BusinessLine", "PricingGroup", "Godown", "Vendor", "AttributeDef",
  "Item", "PriceSlab", "ItemCode", "Customer", "User", "AuditLog", "Notification", "NotificationRead",
  "CustomerContact", "CustomerMachine", "PriceOverride", "StockBalance", "StockTxn",
  "Purchase", "PurchaseLine", "VendorPayment", "Transfer", "Order", "OrderLine", "OrderEvent",
  "Dispatch", "Invoice", "InvoiceLine", "LedgerEntry", "Payment", "ReturnRequest", "JobWork",
  "KitVersion", "KitVersionItem", "Kit", "Cart", "Ad", "Referral", "StockoutSearch",
] as const;
export type BackupModel = (typeof BACKUP_MODELS)[number];

const delegate = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

// Bump when a migration changes the shape of what is dumped, so an older file
// is refused loudly rather than restored into columns that no longer exist.
export const BACKUP_FORMAT = 3;

type Row = Record<string, unknown>;
type Client = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type AnyDelegate = { findMany: (a?: unknown) => Promise<Row[]>; createMany: (a: unknown) => Promise<unknown>; update: (a: unknown) => Promise<unknown> };
const model = (db: Client, m: string) => (db as unknown as Record<string, AnyDelegate>)[delegate(m)];

// The newest moment the data actually reaches. Two backups of the same database
// share it; a file whose watermark is behind the live one is an older snapshot,
// and restoring it would silently roll the business back.
export async function dataThrough(): Promise<string | null> {
  const [order, invoice, txn, ledger, audit] = await Promise.all([
    prisma.order.aggregate({ _max: { updatedAt: true } }),
    prisma.invoice.aggregate({ _max: { date: true } }),
    prisma.stockTxn.aggregate({ _max: { at: true } }),
    prisma.ledgerEntry.aggregate({ _max: { date: true } }),
    prisma.auditLog.aggregate({ _max: { createdAt: true } }),
  ]);
  const times = [order._max.updatedAt, invoice._max.date, txn._max.at, ledger._max.date, audit._max.createdAt]
    .filter((d): d is Date => !!d)
    .map((d) => d.getTime());
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

export async function dumpAll() {
  const data: Record<string, Row[]> = {};
  const counts: Record<string, number> = {};
  for (const m of BACKUP_MODELS) {
    const rows = await model(prisma, m).findMany();
    data[m] = rows;
    counts[m] = rows.length;
  }
  return { data, counts, through: await dataThrough() };
}

// JSON has no date type, so every timestamp comes back as a string. Which
// columns are actually DateTime is read from Prisma's own schema metadata
// rather than guessed from the shape of the value — an audit note that happens
// to contain a timestamp is a string and has to stay one.
const DATE_FIELDS: Record<string, string[]> = Object.fromEntries(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, m.fields.filter((f) => f.type === "DateTime").map((f) => f.name)])
);

function reviveDates(modelName: string, row: Row): Row {
  const fields = DATE_FIELDS[modelName];
  if (!fields?.length) return row;
  const out: Row = { ...row };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === "string") out[f] = new Date(v);
  }
  return out;
}

// Foreign keys that cannot be satisfied at insert time, because the row they
// point at is either in the same table or in a table that itself points back:
//   ItemCode.replacedById -> ItemCode  (a code replaced by a later code)
//   Customer.salesExecId  -> User      (and User.customerId -> Customer)
// These land as NULL and are re-linked once every table is in place.
const DEFERRED_LINKS: Record<string, string[]> = {
  ItemCode: ["replacedById"],
  Customer: ["salesExecId"],
};

export interface RestoreReport { inserted: Record<string, number>; skipped: string[] }

// Wipes and rebuilds every table inside one transaction: either the whole file
// lands or the database is left exactly as it was.
export async function restoreAll(data: Record<string, Row[]>): Promise<RestoreReport> {
  const inserted: Record<string, number> = {};
  const skipped: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const m of [...BACKUP_MODELS].reverse()) {
      await tx.$executeRawUnsafe(`TRUNCATE TABLE "${m}" CASCADE`);
    }
    for (const m of BACKUP_MODELS) {
      const rows = data[m];
      if (!rows) { skipped.push(m); continue; }
      if (!rows.length) { inserted[m] = 0; continue; }
      const defer = DEFERRED_LINKS[m];
      const prepared = rows.map((r) => {
        const base = defer ? { ...r, ...Object.fromEntries(defer.map((f) => [f, null])) } : r;
        return reviveDates(m, base);
      });
      await model(tx, m).createMany({ data: prepared });
      inserted[m] = rows.length;
    }
    // Everything is present now, so the links held back above can be restored.
    for (const [m, fields] of Object.entries(DEFERRED_LINKS)) {
      for (const r of data[m] ?? []) {
        const patch = Object.fromEntries(fields.filter((f) => r[f] != null).map((f) => [f, r[f]]));
        if (Object.keys(patch).length) await model(tx, m).update({ where: { id: r.id }, data: patch });
      }
    }
  }, { timeout: 120_000, maxWait: 20_000 });

  return { inserted, skipped };
}
