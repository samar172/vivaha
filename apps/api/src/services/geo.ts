import type { GeoSource } from "@prisma/client";
import type { Db } from "../db";

// One place that records a location fix, so onboarding, an office edit and a
// portal check-in all leave the same kind of trace and the denormalised "last
// known" on Customer can never drift from the trail.
//
// Discrete fixes only. Nothing here runs on a timer or watches a position — a
// row appears because a person did something that captured one.
export interface Fix { lat: number; lng: number; accuracy?: number | null }

export function validFix(f: Partial<Fix> | null | undefined): f is Fix {
  return !!f && typeof f.lat === "number" && typeof f.lng === "number"
    && Number.isFinite(f.lat) && Number.isFinite(f.lng)
    && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180
    // 0,0 is in the Atlantic. It is what a broken client sends, never a shop.
    && !(f.lat === 0 && f.lng === 0);
}

export async function recordFix(db: Db, customerId: string, fix: Fix, source: GeoSource, by: string) {
  const at = new Date();
  await db.customerLocation.create({
    data: { customerId, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy ?? null, source, by, at },
  });
  // The newest fix is the last known one, whatever produced it.
  await db.customer.update({
    where: { id: customerId },
    data: { lat: fix.lat, lng: fix.lng, geoAccuracy: fix.accuracy ?? null, geoAt: at },
  });
}

// Metres between two fixes — used to tell the office how far a firm was from
// its own shop when it last ordered.
export function metresBetween(a: Fix, b: Fix): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
