// BR-30: place of supply from the GSTIN state code; CGST/SGST split intra-state,
// IGST inter-state; one block per GST rate so mixed-rate invoices stay correct.
export const HOME_STATE = "08";

export interface TaxBlock { inter: boolean; igst: number; cgst: number; sgst: number; total: number }
export function taxOf(gstin: string | null | undefined, taxable: number, gstPct: number, homeState = HOME_STATE): TaxBlock {
  const inter = !!gstin && gstin.length >= 2 && gstin.slice(0, 2) !== homeState;
  const t = Math.round(taxable * gstPct) / 100;
  return inter ? { inter: true, igst: t, cgst: 0, sgst: 0, total: t } : { inter: false, igst: 0, cgst: t / 2, sgst: t / 2, total: t };
}

export interface TaxableLine { amount: number; gstPct: number }
export interface InvoiceTotals {
  blocks: (TaxBlock & { gstPct: number; taxable: number })[];
  taxable: number; cgst: number; sgst: number; igst: number; tax: number; total: number;
}
export function invoiceTotals(lines: TaxableLine[], gstin: string | null | undefined, homeState = HOME_STATE): InvoiceTotals {
  const groups: Record<string, TaxableLine[]> = {};
  lines.forEach((l) => { (groups[l.gstPct] = groups[l.gstPct] || []).push(l); });
  let taxable = 0, cgst = 0, sgst = 0, igst = 0;
  const blocks = Object.keys(groups).map((g) => {
    const tv = groups[g].reduce((s, l) => s + l.amount, 0);
    const t = taxOf(gstin, tv, Number(g), homeState);
    taxable += tv; cgst += t.cgst; sgst += t.sgst; igst += t.igst;
    return { gstPct: Number(g), taxable: tv, ...t };
  });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { blocks, taxable: r2(taxable), cgst: r2(cgst), sgst: r2(sgst), igst: r2(igst), tax: r2(cgst + sgst + igst), total: r2(taxable + cgst + sgst + igst) };
}

export function isInterState(gstin: string | null | undefined, homeState = HOME_STATE) {
  return !!gstin && gstin.length >= 2 && gstin.slice(0, 2) !== homeState;
}
