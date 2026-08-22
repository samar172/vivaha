import type { StockTxnType } from "@prisma/client";
import { available, sumBuckets, type StockBuckets } from "@vivaha/shared";
import type { Db } from "../db";
import { badRequest } from "../utils/httpError";

// ═══ ENGINE · STOCK MOVEMENTS ═══
// Every mutation goes through here so the five buckets and the append-only
// StockTxn log can never disagree. Callers wrap these in a transaction.

export type GodownMap = Record<string, number>; // { godownId: qty }

async function rows(db: Db, itemId: string, godownId?: string) {
  return db.stockBalance.findMany({ where: { itemId, ...(godownId ? { godownId } : {}) } });
}

const fefo = <T extends { expiry: Date | null }>(a: T, b: T) =>
  (a.expiry ? a.expiry.getTime() : 9e15) - (b.expiry ? b.expiry.getTime() : 9e15);

export async function availGodown(db: Db, itemId: string, godownId: string) {
  return (await rows(db, itemId, godownId)).reduce((s, b) => s + available(b), 0);
}
export async function availAll(db: Db, itemId: string) {
  return (await rows(db, itemId)).reduce((s, b) => s + available(b), 0);
}
export async function bucketsAll(db: Db, itemId: string) {
  return sumBuckets(await rows(db, itemId));
}
export async function bucketsGodown(db: Db, itemId: string, godownId: string) {
  return sumBuckets(await rows(db, itemId, godownId));
}

async function log(db: Db, t: { type: StockTxnType; itemId: string; godownId: string; batchNo?: string | null; qty: number; ref?: string | null; reason?: string | null; by: string }) {
  await db.stockTxn.create({ data: { type: t.type, itemId: t.itemId, godownId: t.godownId, batchNo: t.batchNo ?? null, qty: t.qty, ref: t.ref ?? null, reason: t.reason ?? null, by: t.by } });
}

async function balance(db: Db, itemId: string, godownId: string, batchNo?: string | null, expiry?: Date | null) {
  const bn = batchNo || "-";
  const existing = await db.stockBalance.findUnique({ where: { itemId_godownId_batchNo: { itemId, godownId, batchNo: bn } } });
  if (existing) {
    if (expiry && !existing.expiry) return db.stockBalance.update({ where: { id: existing.id }, data: { expiry } });
    return existing;
  }
  return db.stockBalance.create({ data: { itemId, godownId, batchNo: bn, expiry: expiry ?? null } });
}

// Temporary hold (booking). Checks every godown first, then takes FEFO.
export async function tryHold(db: Db, itemId: string, map: GodownMap, ref: string, by: string): Promise<{ ok: boolean; godownId?: string }> {
  for (const gid in map) if ((await availGodown(db, itemId, gid)) < map[gid]) return { ok: false, godownId: gid };
  for (const gid in map) {
    let need = map[gid];
    const rs = (await rows(db, itemId, gid)).sort(fefo);
    for (const r of rs) {
      if (need <= 0) break;
      const take = Math.min(available(r), need);
      if (take > 0) {
        await db.stockBalance.update({ where: { id: r.id }, data: { hold: { increment: take } } });
        await log(db, { type: "HOLD", itemId, godownId: gid, batchNo: r.batchNo, qty: take, ref, by });
        need -= take;
      }
    }
  }
  return { ok: true };
}

export async function releaseHold(db: Db, itemId: string, map: GodownMap, ref: string, reason: string, by: string) {
  for (const gid in map) {
    let need = map[gid];
    for (const r of await rows(db, itemId, gid)) {
      if (need <= 0) break;
      const take = Math.min(r.hold, need);
      if (take > 0) {
        await db.stockBalance.update({ where: { id: r.id }, data: { hold: { decrement: take } } });
        await log(db, { type: "HOLD_RELEASE", itemId, godownId: gid, batchNo: r.batchNo, qty: take, ref, reason, by });
        need -= take;
      }
    }
  }
}

export async function holdToReserved(db: Db, itemId: string, map: GodownMap, ref: string, by: string) {
  for (const gid in map) {
    let need = map[gid];
    for (const r of await rows(db, itemId, gid)) {
      if (need <= 0) break;
      const take = Math.min(r.hold, need);
      if (take > 0) {
        await db.stockBalance.update({ where: { id: r.id }, data: { hold: { decrement: take }, reserved: { increment: take } } });
        await log(db, { type: "RESERVE", itemId, godownId: gid, batchNo: r.batchNo, qty: take, ref, by });
        need -= take;
      }
    }
  }
}

export async function releaseReserved(db: Db, itemId: string, map: GodownMap, ref: string, reason: string, by: string) {
  for (const gid in map) {
    let need = map[gid];
    for (const r of await rows(db, itemId, gid)) {
      if (need <= 0) break;
      const take = Math.min(r.reserved, need);
      if (take > 0) {
        await db.stockBalance.update({ where: { id: r.id }, data: { reserved: { decrement: take } } });
        await log(db, { type: "RESERVE_RELEASE", itemId, godownId: gid, batchNo: r.batchNo, qty: take, ref, reason, by });
        need -= take;
      }
    }
  }
}

// Re-allocation: move reserved qty between godowns to match a new split.
export async function reallocateReserved(db: Db, itemId: string, oldMap: GodownMap, newMap: GodownMap, ref: string, by: string) {
  const gids = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
  const dec: GodownMap = {}, inc: GodownMap = {};
  for (const g of gids) {
    const d = (newMap[g] || 0) - (oldMap[g] || 0);
    if (d < 0) dec[g] = -d; else if (d > 0) inc[g] = d;
  }
  for (const g in inc) {
    const free = await availGodown(db, itemId, g);
    if (free < inc[g]) throw badRequest(`Only ${free} available at ${g}`);
  }
  if (Object.keys(dec).length) await releaseReserved(db, itemId, dec, ref, "Re-allocation", by);
  if (Object.keys(inc).length) {
    const h = await tryHold(db, itemId, inc, ref, by);
    if (!h.ok) throw badRequest(`Stock moved at ${h.godownId} — re-check availability`);
    await holdToReserved(db, itemId, inc, ref, by);
  }
}

export async function shipReserved(db: Db, itemId: string, map: GodownMap, ref: string, by: string) {
  for (const gid in map) {
    let need = map[gid];
    const rs = (await rows(db, itemId, gid)).filter((r) => r.reserved > 0).sort(fefo);
    for (const r of rs) {
      if (need <= 0) break;
      const take = Math.min(r.reserved, need);
      if (take > 0) {
        await db.stockBalance.update({ where: { id: r.id }, data: { reserved: { decrement: take }, onHand: { decrement: take } } });
        await log(db, { type: "DISPATCH", itemId, godownId: gid, batchNo: r.batchNo, qty: take, ref, by });
        need -= take;
      }
    }
    if (need > 0) throw badRequest(`Only ${map[gid] - need} reserved at ${gid} for this line`);
  }
}

export async function receive(db: Db, itemId: string, godownId: string, qty: number, ref: string, by: string, batchNo?: string | null, expiry?: Date | null, type: StockTxnType = "GRN") {
  const b = await balance(db, itemId, godownId, batchNo, expiry);
  await db.stockBalance.update({ where: { id: b.id }, data: { onHand: { increment: qty } } });
  await log(db, { type, itemId, godownId, batchNo: b.batchNo, qty, ref, by });
}

// Outward without a reservation (transfer out, job-work base card draw).
export async function issue(db: Db, itemId: string, godownId: string, qty: number, ref: string, by: string, type: StockTxnType = "TRANSFER_OUT") {
  let need = qty;
  const rs = (await rows(db, itemId, godownId)).sort(fefo);
  if (rs.reduce((s, r) => s + available(r), 0) < qty) throw badRequest(`Quantity exceeds available stock at ${godownId}`);
  let batchUsed: string | null = null;
  for (const r of rs) {
    if (need <= 0) break;
    const take = Math.min(available(r), need);
    if (take > 0) {
      await db.stockBalance.update({ where: { id: r.id }, data: { onHand: { decrement: take } } });
      await log(db, { type, itemId, godownId, batchNo: r.batchNo, qty: take, ref, by });
      need -= take; batchUsed = batchUsed ?? r.batchNo;
    }
  }
  return batchUsed;
}

export type AdjustDir = "damage" | "quarantine" | "recover" | "writeoff";
export async function adjust(db: Db, itemId: string, godownId: string, qty: number, dir: AdjustDir, reason: string, by: string, batchNo?: string | null) {
  const rs = (await rows(db, itemId, godownId)).sort(fefo);
  const pick = batchNo ? rs.find((r) => r.batchNo === batchNo) : rs[0];
  const b = pick ?? (await balance(db, itemId, godownId, batchNo));
  const dm = rs.reduce((s, r) => s + r.damaged, 0);
  if ((dir === "damage" || dir === "quarantine") && available(b) < qty) {
    // spread across batches if the chosen one is short
    let need = qty;
    for (const r of rs) { if (need <= 0) break; const take = Math.min(available(r), need); if (take > 0) { await db.stockBalance.update({ where: { id: r.id }, data: dir === "damage" ? { damaged: { increment: take } } : { quarantined: { increment: take } } }); await log(db, { type: dir === "damage" ? "DAMAGE" : "QUARANTINE", itemId, godownId, batchNo: r.batchNo, qty: take, reason, by }); need -= take; } }
    if (need > 0) throw badRequest(`Cannot move more than the available quantity`);
    return;
  }
  if ((dir === "recover" || dir === "writeoff") && dm < qty) throw badRequest(`Cannot recover more than currently damaged (${dm})`);
  if (dir === "damage") { await db.stockBalance.update({ where: { id: b.id }, data: { damaged: { increment: qty } } }); await log(db, { type: "DAMAGE", itemId, godownId, batchNo: b.batchNo, qty, reason, by }); }
  else if (dir === "quarantine") { await db.stockBalance.update({ where: { id: b.id }, data: { quarantined: { increment: qty } } }); await log(db, { type: "QUARANTINE", itemId, godownId, batchNo: b.batchNo, qty, reason, by }); }
  else {
    let need = qty;
    for (const r of rs.filter((r) => r.damaged > 0)) {
      if (need <= 0) break;
      const take = Math.min(r.damaged, need);
      if (dir === "recover") await db.stockBalance.update({ where: { id: r.id }, data: { damaged: { decrement: take } } });
      else await db.stockBalance.update({ where: { id: r.id }, data: { damaged: { decrement: take }, onHand: { decrement: take } } });
      await log(db, { type: dir === "recover" ? "RECOVER" : "WRITE_OFF", itemId, godownId, batchNo: r.batchNo, qty: take, reason, by });
      need -= take;
    }
  }
}

export const emptyBuckets = (): StockBuckets => ({ onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0 });
