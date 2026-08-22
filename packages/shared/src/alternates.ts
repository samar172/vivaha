// F-04: alternate item ranking when the asked-for design is short.
export interface AltCandidate {
  id: string; lineId: string; attrs: Record<string, string>; uom: string; landedCost: number;
  available: number; rate: number;
}
export interface AltResult { id: string; avail: number; rate: number; score: number; fit: number; margin: number }

export function rankAlternates(
  src: AltCandidate,
  cands: AltCandidate[],
  reqQty: number,
  returnedItemIds: string[] = []
): AltResult[] {
  const L = src.lineId;
  const srcPrice = src.rate;
  const scored = cands
    .filter((x) => x.id !== src.id && x.lineId === L && x.available > 0 && !returnedItemIds.includes(x.id))
    .map((x) => {
      const av = x.available, pr = x.rate;
      let sameGroup = 0, sameSpec = 0, sameSize = 0;
      const a = x.attrs, s = src.attrs;
      if (a.community !== undefined || s.community !== undefined) {
        sameGroup = a.community === s.community && a.occasion === s.occasion ? 1 : 0;
        sameSpec = a.paper === s.paper ? 1 : 0;
        sameSize = a.size === s.size && a.fold === s.fold ? 1 : 0;
      } else if (a.machine !== undefined || s.machine !== undefined) {
        sameGroup = a.machine === s.machine && a.grade === s.grade ? 1 : 0;
        sameSpec = a.brand === s.brand ? 1 : 0;
        sameSize = x.uom === src.uom ? 1 : 0;
      } else {
        sameGroup = a.material === s.material ? 1 : 0;
        sameSpec = a.thickness === s.thickness ? 1 : 0;
        sameSize = a.finish === s.finish ? 1 : 0;
      }
      const prox = srcPrice > 0 ? Math.max(0, 1 - Math.abs(pr - srcPrice) / srcPrice / 0.15) : 0;
      const fit = av >= reqQty ? 1 : av >= reqQty * 0.5 ? 0.4 : 0;
      const score = 40 * sameGroup + 25 * prox + 15 * sameSpec + 10 * sameSize + 10 * fit;
      return { id: x.id, avail: av, rate: pr, score, fit, margin: pr > 0 ? (pr - x.landedCost) / pr : 0 };
    });
  scored.sort((a, b) => b.score - a.score || b.margin - a.margin);
  return scored.slice(0, 5);
}
