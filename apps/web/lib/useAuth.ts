"use client";
import { useEffect, useState } from "react";
import { refreshAccess } from "./api";
import { getToken } from "./session";
import { useSession } from "./store";

/**
 * Session for gated pages. `ready` turns true once we know whether someone is signed in: the access token lives per tab
 * (sessionStorage), so a new tab first tries to restore it from the refresh cookie. Until then render a neutral state,
 * which also keeps server and first client render identical.
 */
export function useAuth() {
  const user = useSession((s) => s.user);
  const token = useSession((s) => s.token);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => { if (!getToken()) await refreshAccess(); if (alive) setReady(true); })();
    return () => { alive = false; };
  }, []);
  return { user: ready ? user : null, token, ready };
}
