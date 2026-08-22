import { DEFAULT_MIN_MARGIN, HOME_STATE } from "@vivaha/shared";
import { prisma } from "../db";

export interface CompanySettings {
  name: string; address: string; gstin: string; state: string; phone: string;
}
const DEFAULT_COMPANY: CompanySettings = {
  name: "Vivaha Cards", address: "Plot 14, Junagarh Road Industrial Area, Bikaner 334001", gstin: "08AAQCV7781K1ZR", state: HOME_STATE, phone: "+91 151 220 0000",
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}
export async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
}
export const getMinMargin = () => getSetting<number>("MIN_MARGIN", DEFAULT_MIN_MARGIN);
export const getCompany = () => getSetting<CompanySettings>("COMPANY", DEFAULT_COMPANY);
export const getHomeState = async () => (await getCompany()).state;
