import { DEFAULT_MIN_MARGIN, HOME_STATE } from "@vivaha/shared";
import { prisma } from "../db";

export interface CompanySettings {
  name: string; address: string; gstin: string; state: string; phone: string;
  /** What goes on a carton label. A printed label is read across a godown, so
   *  it carries the mark and not the whole name — "VC", not "VIVAHA CARDS". */
  mark?: string;
  /** The front of every own code the office issues: VC-AAKASH-1201. */
  codePrefix?: string;
}
const DEFAULT_COMPANY: CompanySettings = {
  name: "Vivaha Cards", address: "Plot 14, Junagarh Road Industrial Area, Bikaner 334001", gstin: "08AAQCV7781K1ZR", state: HOME_STATE, phone: "+91 151 220 0000",
  mark: "VC", codePrefix: "VC",
};

/** The initials of a firm's name, for when nobody has set a mark: "Jain Card
 *  Gallery" becomes JCG. Two or three letters is what fits on a label. */
export const initialsOfName = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "VC";

export async function getCompanyMark() {
  const c = await getCompany();
  return (c.mark || initialsOfName(c.name)).trim();
}
export async function getCodePrefix() {
  const c = await getCompany();
  return (c.codePrefix || c.mark || initialsOfName(c.name)).trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}
export async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
}
export const getMinMargin = () => getSetting<number>("MIN_MARGIN", DEFAULT_MIN_MARGIN);
export const getCompany = () => getSetting<CompanySettings>("COMPANY", DEFAULT_COMPANY);
// The language the office panel reads its warnings in. English by default,
// because that is what the ERP was written in; a floor that works in Hindi can
// switch the whole panel with one setting.
export const getPanelLang = () => getSetting<"en" | "hi">("PANEL_LANG", "en");
export const getHomeState = async () => (await getCompany()).state;
