const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

export class ApiError extends Error {
  status: number; details?: unknown;
  /** The same refusal in Hindi, when the server had one for it. */
  messageHi?: string;
  constructor(status: number, message: string, details?: unknown, messageHi?: string) { super(message); this.status = status; this.details = details; this.messageHi = messageHi; }
}

export async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
  if (!res.ok) return null;
  const data = await res.json();
  accessToken = data.accessToken;
  return accessToken;
}

interface Opts extends Omit<RequestInit, "body"> { body?: unknown; skipAuthRetry?: boolean }
export async function apiFetch<T = unknown>(path: string, options: Opts = {}): Promise<T> {
  const { body, skipAuthRetry, headers, ...rest } = options;
  const doFetch = () => fetch(`${API_URL}${path}`, { ...rest, credentials: "include", headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let res = await doFetch();
  if (res.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await doFetch(); else onUnauthorized?.();
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof data === "object" && data && "error" in data ? String(data.error) : "Request failed", typeof data === "object" ? (data as { details?: unknown }).details : undefined, typeof data === "object" && data && "errorHi" in data && data.errorHi ? String((data as { errorHi?: unknown }).errorHi) : undefined);
  return data as T;
}
export const get = <T = unknown>(path: string) => apiFetch<T>(path);
export const post = <T = unknown>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body: body ?? {} });
export const patch = <T = unknown>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body: body ?? {} });
export const put = <T = unknown>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body: body ?? {} });
export const del = <T = unknown>(path: string) => apiFetch<T>(path, { method: "DELETE" });
