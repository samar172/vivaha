import type { BusinessLineConfig } from "./lines";

// Five buckets per item × godown × batch (BR-14). Availability is always
// computed live from these, never read from a stored "available" column.
export interface StockBuckets {
  onHand: number;
  reserved: number;
  hold: number;
  damaged: number;
  quarantined: number;
}

export function available(b: StockBuckets): number {
  return b.onHand - b.reserved - b.hold - b.damaged - b.quarantined;
}

export function sumBuckets(rows: StockBuckets[]): StockBuckets & { available: number } {
  const t = rows.reduce(
    (s, b) => ({
      onHand: s.onHand + b.onHand,
      reserved: s.reserved + b.reserved,
      hold: s.hold + b.hold,
      damaged: s.damaged + b.damaged,
      quarantined: s.quarantined + b.quarantined,
    }),
    { onHand: 0, reserved: 0, hold: 0, damaged: 0, quarantined: 0 }
  );
  return { ...t, available: available(t) };
}

// F-01 display band — protects stock depth from competitors while telling the
// retailer exactly what they need to know to book.
export type BandKind = "svc" | "out" | "eta" | "short" | "low" | "ltd" | "in";
export interface Band {
  k: BandKind;
  label: string;
  hi: string;
  cls: "ok" | "warn" | "err" | "neu";
  dot: string;
  qty: number;
  canBook: boolean;
  belowSet?: boolean;
  prebook?: boolean;
  eta?: string | null;
}

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
const num = (n: number) => n.toLocaleString("en-IN");

export function band(
  line: Pick<BusinessLineConfig, "workflow" | "minSetQty">,
  availableQty: number,
  uom: string,
  inTransitEta?: string | Date | null,
  /** The item's own minimum order. A band that ignores it can offer a Book
   *  button on a card the cart will then refuse — see below. */
  moq?: number,
): Band {
  if (line.workflow === "JOBWORK")
    return { k: "svc", label: "Service", hi: "सेवा", cls: "neu", dot: "#8A93A3", qty: 0, canBook: false };
  const D = availableQty, M = line.minSetQty;
  if (D <= 0) {
    if (inTransitEta)
      return { k: "eta", label: "Arriving " + fmtDate(inTransitEta), hi: fmtDate(inTransitEta) + " तक आएगा", cls: "neu", dot: "#8A93A3", qty: 0, canBook: false, prebook: true, eta: new Date(inTransitEta).toISOString() };
    return { k: "out", label: "Out of stock", hi: "स्टॉक ख़त्म", cls: "err", dot: "#BE123C", qty: 0, canBook: false };
  }
  // There is stock, but not enough to make up one order of it.
  //
  // The bands are measured against the line's full-set quantity, which is not
  // the same number as the item's own minimum order — so a card with 116 left
  // against an MOQ of 250 read as "Limited, 116 pcs" with a working Book
  // button, and the cart then refused it: "only 116 available". A dead end the
  // retailer walks into by doing exactly what the screen invited.
  //
  // It cannot be booked, so it does not say it can, and it says why.
  if (moq && D < moq) {
    return {
      k: "short", cls: "warn", dot: "#D07A2E", qty: D, canBook: false,
      label: `Only ${num(D)} left — under the minimum order of ${num(moq)}`,
      hi: `सिर्फ़ ${num(D)} बचे — कम से कम ${num(moq)} चाहिए`,
    };
  }
  if (D >= 3 * M) return { k: "in", label: "In stock", hi: "स्टॉक में है", cls: "ok", dot: "#15803D", qty: D, canBook: true };
  if (D >= M) return { k: "ltd", label: "Limited — " + num(D) + " " + uom.toLowerCase(), hi: "सीमित — " + num(D) + " बाकी", cls: "warn", dot: "#B45309", qty: D, canBook: true };
  return { k: "low", label: "Only " + num(D) + " left — below full set", hi: "सिर्फ़ " + num(D) + " — पूरा सेट नहीं", cls: "warn", dot: "#D07A2E", qty: D, canBook: true, belowSet: true };
}

// A location inside a godown is one code: "R-1" for a rack with no shelves,
// "R-1/A" for a shelf on it. Kept as one string rather than as a third column
// so the stock engine — which holds, reserves and ships against a location —
// did not have to learn another level of geography to say where a bundle is.
export const RACK_SUB_SEP = "/";
export const locationCode = (rack: string, sub?: string | null) =>
  (sub ?? "").trim() ? `${rack}${RACK_SUB_SEP}${(sub as string).trim()}` : rack;
/** Splits a stored location back into the rack and the shelf on it. */
export const splitLocation = (loc: string): { rack: string; sub: string } => {
  const i = loc.indexOf(RACK_SUB_SEP);
  return i < 0 ? { rack: loc, sub: "" } : { rack: loc.slice(0, i), sub: loc.slice(i + 1) };
};
