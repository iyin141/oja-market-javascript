import { FIXTURE_DETAIL, FIXTURE_PRODUCTS, FIXTURE_SEARCH } from "./fixtures";
import type { ProductDetail, ProductSummary, SearchResult } from "./types";
import { useSession } from "./store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

export interface Result<T> { data: T; live: boolean }
type Init = RequestInit & { token?: string | null };

function headers(token: string | null | undefined, extra?: HeadersInit): HeadersInit {
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((extra as Record<string, string>) ?? {}) };
}

// One refresh at a time. The API rotates the refresh cookie on every use and treats a second use of the old one as
// theft (it revokes the whole family), so parallel 401s must share a single /auth/refresh call.
let inflight: Promise<string | null> | null = null;

/** New access token from the refresh cookie (also restores the session in a new tab), or null when signed out. */
export function refreshAccess(): Promise<string | null> {
  inflight ??= (async () => {
    try {
      const r = await fetch(API_URL + "/auth/refresh", { method: "POST", credentials: "include" });
      if (!r.ok) {
        if (useSession.getState().token) { useSession.setState({ token: null, user: null }); window.dispatchEvent(new Event("oja-session")); }
        return null;
      }
      const { accessToken } = (await r.json()) as { accessToken: string };
      const me = await fetch(API_URL + "/me", { headers: headers(accessToken) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      useSession.setState((st) => ({ token: accessToken, user: me ?? st.user }));
      window.dispatchEvent(new Event("oja-session"));
      return accessToken;
    } catch {
      return null;
    } finally {
      setTimeout(() => { inflight = null; }, 0);
    }
  })();
  return inflight;
}

/** fetch with the bearer token; on 401 refreshes once and retries with the new token. */
async function authed(path: string, token: string | null | undefined, rest: RequestInit): Promise<Response> {
  const res = await fetch(API_URL + path, { credentials: "include", ...rest, headers: headers(token, rest.headers) });
  if (res.status !== 401 || !token || path.startsWith("/auth/")) return res;
  const fresh = await refreshAccess();
  return fresh ? fetch(API_URL + path, { credentials: "include", ...rest, headers: headers(fresh, rest.headers) }) : res;
}

/** Fetch JSON from the API. On any failure (down, CORS, timeout, non-2xx) returns the fixture and live=false. */
export async function api<T>(path: string, fallback: T, init: Init = {}): Promise<Result<T>> {
  const { token, ...rest } = init;
  try {
    const res = await authed(path, token, { cache: "no-store", signal: AbortSignal.timeout(4000), ...rest });
    if (!res.ok) throw new Error(String(res.status));
    return { data: (await res.json()) as T, live: true };
  } catch {
    return { data: fallback, live: false };
  }
}

/** Strict variant for mutations: throws a readable error instead of falling back. */
export async function apiStrict<T>(path: string, init: Init = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await authed(path, token, rest);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail ?? body.title ?? `Request failed (${res.status})`);
  return body as T;
}

export const getProducts = () => api<ProductSummary[]>("/products?limit=24", FIXTURE_PRODUCTS);
export const getSearch = (q: string, sort = "relevance") => api<SearchResult>(`/search?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}`, FIXTURE_SEARCH(q));
export const getProduct = (slug: string) => api<ProductDetail>(`/products/${encodeURIComponent(slug)}`, FIXTURE_DETAIL(slug));
