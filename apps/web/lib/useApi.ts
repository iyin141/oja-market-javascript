"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { USE_FIXTURES } from "./env";
import { getToken } from "./session";

/**
 * Authenticated GET. `fallback` is what you get when signed out or the request fails (pass `pick(empty, fixture)`:
 * fixtures only exist behind NEXT_PUBLIC_USE_FIXTURES). `live` is false only when the request really failed;
 * `status` is the HTTP status (0 = network failure, 401 = signed out).
 */
export function useApi<T>(path: string, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | undefined>();
  const load = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    if (!token) { setData(fallback); setLive(!USE_FIXTURES); setStatus(401); setLoading(false); return; }
    const r = await api<T>(path, fallback, { token });
    setData(r.data); setLive(r.live); setStatus(r.status); setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    load();
    window.addEventListener("oja-session", load);
    return () => window.removeEventListener("oja-session", load);
  }, [load]);
  return { data, live, loading, status, reload: load };
}
