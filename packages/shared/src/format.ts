export const money = (n: number | string | null | undefined) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
// A rate is not an amount. ₹13.20 a card is a different number from ₹13 a card,
// and on ten thousand cards it is two thousand rupees of difference — so a rate
// is never shown rounded to the rupee, whatever it is being shown next to.
// Trailing paise are kept because a price list reads as a price list: 13.20,
// not 13.2, and 10.00 rather than 10 in a column of them.
export const rate = (n: number | string | null | undefined) =>
  "₹" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money2 = (n: number | string | null | undefined) =>
  "₹" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n: number | string | null | undefined) => (Number(n) || 0).toLocaleString("en-IN");
export const fDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
export const fDT = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " " + new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
export const daysTo = (d: string | Date, today: Date = new Date()) => Math.round((new Date(d).getTime() - today.getTime()) / 864e5);
export const dueLbl = (d: string | Date, today: Date = new Date()) => { const n = daysTo(d, today); return n < 0 ? Math.abs(n) + " d ago" : n === 0 ? "today" : "in " + n + " d"; };
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
