// A business line is a config record — "adding a fifth line is a row in this
// table, not a code change." Everything that differs between lines lives here.
export type PricingModel = "SLAB" | "AREA" | "QUOTE";
export type LineWorkflow = "FULFIL" | "JOBWORK";

export interface BusinessLineConfig {
  id: string;
  code: string;
  name: string;
  nameHi: string;
  icon: string;
  color: string;
  bg: string;
  uom: string;
  packUoms: string[];
  minSetQty: number;
  holdMins: number;
  gstPct: number;
  stockDims: string[];
  batchTracked: boolean;
  pricingModel: PricingModel;
  workflow: LineWorkflow;
  facets: string[];
  sortOrder: number;
}

export const isServiceLine = (l: Pick<BusinessLineConfig, "workflow">) => l.workflow === "JOBWORK";
