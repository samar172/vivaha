import type { Db } from "../db";

// Gapless, race-safe numbering: a single UPDATE ... RETURNING under the
// caller's transaction. Financial-year series for invoices and credit notes.
export async function nextSeq(db: Db, name: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("name", "value") VALUES (${name}, 1)
    ON CONFLICT ("name") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

export function fyCode(d: Date = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}

// A counter that begins at a configured number rather than at 1. The first
// call returns `start` itself; afterwards it behaves like any other sequence.
export async function nextSeqFrom(db: Db, name: string, start: number): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("name", "value") VALUES (${name}, ${Math.max(1, start)})
    ON CONFLICT ("name") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

// Each business line bills on its own series — a flex invoice and a card
// invoice are never the same number — and each series restarts every financial
// year. The prefix and the number to start from are set in Settings against the
// line, so a new line needs no code.
export interface InvoiceSeries { id: string; invoicePrefix: string; invoiceStart: number }
export const nextInvoiceNo = async (db: Db, line: InvoiceSeries) =>
  `${line.invoicePrefix}/${fyCode()}/${String(await nextSeqFrom(db, `INV-${line.id}-${fyCode()}`, line.invoiceStart)).padStart(4, "0")}`;
export const nextCreditNoteNo = async (db: Db) => `CN/${fyCode()}/${String(await nextSeq(db, "CN-" + fyCode())).padStart(3, "0")}`;
export const nextOrderNo = async (db: Db) => `ORD-${await nextSeq(db, "ORD")}`;
export const nextPurchaseNo = async (db: Db) => `PO-${await nextSeq(db, "PO")}`;
export const nextTransferNo = async (db: Db) => `TRF-${await nextSeq(db, "TRF")}`;
export const nextReturnNo = async (db: Db) => `RET-${await nextSeq(db, "RET")}`;
export const nextReceiptNo = async (db: Db) => `RCPT-${await nextSeq(db, "RCPT")}`;
export const nextSettlementNo = async (db: Db) => `STL-${String(await nextSeq(db, "STL")).padStart(4, "0")}`;
export const nextJobNo = async (db: Db) => `JOB-${await nextSeq(db, "JOB")}`;
export const nextCustomerNo = async (db: Db) => `CUST-${await nextSeq(db, "CUST")}`;
export const nextItemNo = async (db: Db, prefix: string) => `${prefix}-${await nextSeq(db, "ITM-" + prefix)}`;
export const nextReferralNo = async (db: Db) => `REF-${String(await nextSeq(db, "REF")).padStart(2, "0")}`;
