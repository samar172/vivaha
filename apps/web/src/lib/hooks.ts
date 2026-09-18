import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { apiFetch } from "./api";
import type { BusinessLineConfig } from "@vivaha/shared";

const fetcher = <T,>(path: string) => apiFetch<T>(path);
export function useApi<T>(path: string | null, opts?: { refreshInterval?: number; keepPreviousData?: boolean }) { return useSWR<T>(path, fetcher, { revalidateOnFocus: false, ...opts }); }

// A value that follows another after it has stopped changing. Used where a
// keystroke would otherwise become a request — and, worse, a new SWR key, whose
// empty cache blanks the screen the input is standing on.
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
export const refresh = (prefix: string) => globalMutate((key) => typeof key === "string" && key.startsWith(prefix), undefined, { revalidate: true });
export const refreshAll = () => globalMutate(() => true, undefined, { revalidate: true });

export interface Line extends BusinessLineConfig { itemCount?: number; isActive: boolean; invoicePrefix: string; invoiceStart: number; priceListAnnual?: boolean }
export interface Rack { id: string; code: string; name: string }
export interface Godown { id: string; name: string; short: string; manager: string; address: string; racks: Rack[] }
export const useLines = () => useApi<Line[]>("/api/masters/lines");
export const useGodowns = () => useApi<Godown[]>("/api/masters/godowns");
export const useSettings = () => useApi<{ minMargin: number; company: { name: string; address: string; gstin: string; state: string }; panelLang?: "en" | "hi" }>("/api/settings");
