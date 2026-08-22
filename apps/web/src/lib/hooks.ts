import useSWR, { mutate as globalMutate } from "swr";
import { apiFetch } from "./api";
import type { BusinessLineConfig } from "@vivaha/shared";

const fetcher = <T,>(path: string) => apiFetch<T>(path);
export function useApi<T>(path: string | null, opts?: { refreshInterval?: number }) { return useSWR<T>(path, fetcher, { revalidateOnFocus: false, ...opts }); }
export const refresh = (prefix: string) => globalMutate((key) => typeof key === "string" && key.startsWith(prefix), undefined, { revalidate: true });
export const refreshAll = () => globalMutate(() => true, undefined, { revalidate: true });

export interface Line extends BusinessLineConfig { itemCount?: number; isActive: boolean }
export interface Godown { id: string; name: string; short: string; manager: string; address: string }
export const useLines = () => useApi<Line[]>("/api/masters/lines");
export const useGodowns = () => useApi<Godown[]>("/api/masters/godowns");
export const useSettings = () => useApi<{ minMargin: number; company: { name: string; address: string; gstin: string; state: string } }>("/api/settings");
