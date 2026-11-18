import { notFound } from "next/navigation";
import { EMPTY_SEARCH, FIXTURE_DETAIL, FIXTURE_PRODUCTS, FIXTURE_SEARCH, pick } from "./fixtures";
import { USE_FIXTURES } from "./env";
import type { Category, ProductDetail, ProductSummary, SearchResult } from "./types";
import { useSession } from "./store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  console.warn("!!! [oja-web] NEXT_PUBLIC_API_URL is not set in this production build: the app will call http://localhost:4100. Set it at build time (it is inlined into the bundle). !!!");
}

/** `data` is the fallback when `live` is false. `status`: HTTP status, 0 = network failure/timeout. */
export interface Result<T> { data: T; live: boolean; status?: number }
/** Error from apiStrict. status 0 = the API could not be reached. */
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
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

/** Fetch JSON from the API. On failure (down, CORS, timeout, non-2xx) returns `fallback`, live=false and the status. */
export async function api<T>(path: string, fallback: T, init: Init = {}): Promise<Result<T>> {
  const { token, ...rest } = init;
  try {
    const res = await authed(path, token, { cache: "no-store", signal: AbortSignal.timeout(4000), ...rest });
    if (!res.ok) return { data: fallback, live: false, status: res.status };
    return { data: (await res.json()) as T, live: true, status: res.status };
  } catch {
    return { data: fallback, live: false, status: 0 };
  }
}

/** Strict variant for mutations: throws a readable ApiError instead of falling back. */
export async function apiStrict<T>(path: string, init: Init = {}): Promise<T> {
  const { token, ...rest } = init;
  let res: Response;
  try { res = await authed(path, token, rest); }
  catch { throw new ApiError(0, "Could not reach the Oja Market API. Check your connection and try again."); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.detail ?? body.title ?? `Request failed (${res.status})`);
  return body as T;
}

export const getProducts = () => api<ProductSummary[]>("/products?limit=24", pick([], FIXTURE_PRODUCTS));
export const getCategories = () => api<Category[]>("/categories", []);

export interface SearchParams { q?: string; sort?: string; categoryId?: string; vendorId?: string; minPrice?: string; maxPrice?: string; inStock?: boolean }
export function getSearch(p: SearchParams) {
  const u = new URLSearchParams({ q: p.q ?? "", sort: p.sort || "relevance" });
  for (const k of ["categoryId", "vendorId", "minPrice", "maxPrice"] as const) if (p[k]) u.set(k, p[k]!);
  if (p.inStock) u.set("inStock", "1"); // the API coerces any non-empty string to true, so only ever send it when on
  return api<SearchResult>(`/search?${u}`, pick(EMPTY_SEARCH, FIXTURE_SEARCH(p.q ?? "")));
}

/** 404 from the API shows the not-found page. If the API is unreachable, data is null (render an honest error, not fake products). */
export async function getProduct(slug: string) {
  const r = await api<ProductDetail | null>(`/products/${encodeURIComponent(slug)}`, USE_FIXTURES ? FIXTURE_DETAIL(slug) : null);
  if (r.status === 404 && !USE_FIXTURES) notFound();
  return r;
}
