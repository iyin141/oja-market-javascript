import { FIXTURE_DETAIL, FIXTURE_PRODUCTS, FIXTURE_SEARCH } from "./fixtures";
import type { ProductDetail, ProductSummary, SearchResult } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

export interface Result<T> { data: T; live: boolean }
type Init = RequestInit & { token?: string | null };

function headers(token: string | null | undefined, extra?: HeadersInit): HeadersInit {
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((extra as Record<string, string>) ?? {}) };
}

/** Fetch JSON from the API. On any failure (down, CORS, timeout, non-2xx) returns the fixture and live=false. */
export async function api<T>(path: string, fallback: T, init: Init = {}): Promise<Result<T>> {
  const { token, ...rest } = init;
  try {
    const res = await fetch(API_URL + path, { cache: "no-store", credentials: "include", signal: AbortSignal.timeout(4000), ...rest, headers: headers(token, rest.headers) });
    if (!res.ok) throw new Error(String(res.status));
    return { data: (await res.json()) as T, live: true };
  } catch {
    return { data: fallback, live: false };
  }
}

/** Strict variant for mutations: throws a readable error instead of falling back. */
export async function apiStrict<T>(path: string, init: Init = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(API_URL + path, { credentials: "include", ...rest, headers: headers(token, rest.headers) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail ?? body.title ?? `Request failed (${res.status})`);
  return body as T;
}

export const getProducts = () => api<ProductSummary[]>("/products?limit=24", FIXTURE_PRODUCTS);
export const getSearch = (q: string, sort = "relevance") => api<SearchResult>(`/search?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}`, FIXTURE_SEARCH(q));
export const getProduct = (slug: string) => api<ProductDetail>(`/products/${encodeURIComponent(slug)}`, FIXTURE_DETAIL(slug));
