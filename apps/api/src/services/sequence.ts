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

export const nextInvoiceNo = async (db: Db) => `VC/${fyCode()}/${String(await nextSeq(db, "INV-" + fyCode())).padStart(4, "0")}`;
export const nextCreditNoteNo = async (db: Db) => `CN/${fyCode()}/${String(await nextSeq(db, "CN-" + fyCode())).padStart(3, "0")}`;
export const nextOrderNo = async (db: Db) => `ORD-${await nextSeq(db, "ORD")}`;
export const nextPurchaseNo = async (db: Db) => `PO-${await nextSeq(db, "PO")}`;
export const nextTransferNo = async (db: Db) => `TRF-${await nextSeq(db, "TRF")}`;
export const nextReturnNo = async (db: Db) => `RET-${await nextSeq(db, "RET")}`;
export const nextReceiptNo = async (db: Db) => `RCPT-${await nextSeq(db, "RCPT")}`;
export const nextJobNo = async (db: Db) => `JOB-${await nextSeq(db, "JOB")}`;
export const nextCustomerNo = async (db: Db) => `CUST-${await nextSeq(db, "CUST")}`;
export const nextItemNo = async (db: Db, prefix: string) => `${prefix}-${await nextSeq(db, "ITM-" + prefix)}`;
export const nextReferralNo = async (db: Db) => `REF-${String(await nextSeq(db, "REF")).padStart(2, "0")}`;
