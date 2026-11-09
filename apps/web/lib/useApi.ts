"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { getToken } from "./session";

/** Authenticated GET with fixture fallback. `live` is false when signed out or the API is unreachable. */
export function useApi<T>(path: string, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    if (!token) { setData(fallback); setLive(false); setLoading(false); return; }
    const r = await api<T>(path, fallback, { token });
    setData(r.data); setLive(r.live); setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    load();
    window.addEventListener("oja-session", load);
    return () => window.removeEventListener("oja-session", load);
  }, [load]);
  return { data, live, loading, reload: load };
}
