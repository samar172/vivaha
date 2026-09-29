import { prisma } from "../db";

// How complete a firm's or a supplier's record is, as a percentage.
//
// A master that is half filled in costs money quietly: a bill cannot be raised
// without a GSTIN, a consignment cannot be chased without a phone, and a firm
// with nobody marked to receive bills has them going nowhere at all. None of
// that announces itself — it surfaces as a delay, one record at a time.
//
// Two rules keep the score honest:
//
//  * It is weighted. A missing phone number is not the same size of problem as
//    a missing map pin, and averaging them as if they were makes the number
//    useless.
//  * A field is only counted against a record when it genuinely applies. An
//    unregistered shop has no GSTIN and never will; marking it incomplete
//    forever teaches everyone to ignore the score, which is worse than not
//    having one.

export interface Check {
  key: string;
  label: string;
  weight: number;
  ok: boolean;
  /** Set when the field does not apply to this record, so it is left out of
   *  the arithmetic rather than counted as a failure. */
  na?: boolean;
  hint: string;
}

export interface Scored {
  id: string;
  name: string;
  code: string | null;
  score: number;
  missing: Check[];
  checks: Check[];
}

const pct = (got: number, possible: number) => (possible <= 0 ? 100 : Math.round((got / possible) * 100));

function score(checks: Check[]): Scored["score"] {
  const live = checks.filter((c) => !c.na);
  const possible = live.reduce((t, c) => t + c.weight, 0);
  const got = live.filter((c) => c.ok).reduce((t, c) => t + c.weight, 0);
  return pct(got, possible);
}

const has = (v: unknown) => typeof v === "string" ? v.trim().length > 0 : v != null;

export async function customerHealth() {
  const rows = await prisma.customer.findMany({
    include: { contacts: true, machines: true, users: { select: { isActive: true } } },
    orderBy: { name: "asc" },
  });

  const scored: Scored[] = rows.map((c) => {
    // A firm that has told us it is unregistered is not missing a GSTIN.
    const gstNa = c.firmType !== "Registered";
    const checks: Check[] = [
      { key: "phone", label: "Phone", weight: 5, ok: has(c.phone), hint: "Nobody can be told their order is ready" },
      { key: "billsTo", label: "A number marked for bills", weight: 5, ok: c.contacts.some((x) => x.billsTo), hint: "Bills have nowhere to go" },
      { key: "gstin", label: "GSTIN", weight: 4, ok: has(c.gstin), na: gstNa, hint: "A registered firm's bill needs it" },
      { key: "address", label: "Address", weight: 3, ok: has(c.address), hint: "A consignment cannot be addressed" },
      { key: "code", label: "Your own number", weight: 3, ok: has(c.code), hint: "The number the counter says out loud" },
      { key: "salesExec", label: "Sales executive", weight: 3, ok: has(c.salesExecId), hint: "Nobody owns the relationship" },
      { key: "contacts", label: "At least one extra number", weight: 2, ok: c.contacts.length > 0, hint: "Only the owner's number is on file" },
      { key: "credit", label: "Credit terms set", weight: 2, ok: Number(c.creditLimit) > 0, hint: "Every order will read as over the limit" },
      { key: "geo", label: "Shop location", weight: 1, ok: c.lat != null && c.lng != null, hint: "A driver has to ring for directions" },
      { key: "login", label: "Portal login", weight: 1, ok: c.users.some((u) => u.isActive), hint: "They cannot order for themselves" },
    ];
    return {
      id: c.id, name: c.name, code: c.code,
      score: score(checks),
      missing: checks.filter((x) => !x.ok && !x.na),
      checks,
    };
  });

  return { rows: scored, ...summarise(scored) };
}

export async function vendorHealth() {
  const rows = await prisma.vendor.findMany({ include: { items: { select: { id: true } }, purchases: { select: { id: true } } }, orderBy: { name: "asc" } });

  const scored: Scored[] = rows.map((v) => {
    const checks: Check[] = [
      { key: "phone", label: "Phone", weight: 5, ok: has(v.phone), hint: "A short delivery cannot be chased" },
      { key: "gstin", label: "GSTIN", weight: 4, ok: has(v.gstin), hint: "Input credit cannot be claimed against them" },
      { key: "code", label: "Your own number", weight: 3, ok: has(v.code), hint: "The number the counter says out loud" },
      { key: "city", label: "City", weight: 2, ok: has(v.city), hint: "Lead time cannot be judged" },
      { key: "terms", label: "Payment terms", weight: 2, ok: has(v.terms), hint: "Ageing has nothing to measure against" },
      { key: "items", label: "Items sourced from them", weight: 2, ok: v.items.length > 0, hint: "Nothing on the catalogue names them as its supplier" },
    ];
    return { id: v.id, name: v.name, code: v.code, score: score(checks), missing: checks.filter((x) => !x.ok && !x.na), checks };
  });

  return { rows: scored, ...summarise(scored) };
}

/** The picture across all of them: the overall percentage, and which field is
 *  the one actually holding it down. */
function summarise(rows: Scored[]) {
  const overall = rows.length ? Math.round(rows.reduce((t, r) => t + r.score, 0) / rows.length) : 100;
  const byField: Record<string, { key: string; label: string; weight: number; hint: string; ok: number; applies: number; pct: number }> = {};
  for (const r of rows) {
    for (const c of r.checks) {
      if (c.na) continue;
      const f = (byField[c.key] = byField[c.key] ?? { key: c.key, label: c.label, weight: c.weight, hint: c.hint, ok: 0, applies: 0, pct: 100 });
      f.applies += 1;
      if (c.ok) f.ok += 1;
    }
  }
  const fields = Object.values(byField).map((f) => ({ ...f, pct: pct(f.ok, f.applies) }))
    .sort((a, b) => (a.pct - b.pct) || (b.weight - a.weight));
  return {
    overall,
    counted: rows.length,
    // Bands the office can act on rather than a number to admire.
    good: rows.filter((r) => r.score >= 90).length,
    fair: rows.filter((r) => r.score >= 60 && r.score < 90).length,
    poor: rows.filter((r) => r.score < 60).length,
    fields,
  };
}
