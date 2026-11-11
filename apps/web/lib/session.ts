"use client";
import { apiStrict } from "./api";
import { useSession } from "./store";

/**
 * Access token lives in sessionStorage (15 min JWT); the refresh token is an httpOnly cookie set by the API.
 * Tradeoff: sessionStorage is readable by injected scripts, so keep CSP strict; the long-lived secret never is.
 */
export interface Me { id: string; email: string; name: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" | "AGENT" }

export const getToken = (): string | null => useSession.getState().token;
export const getUser = (): Me | null => useSession.getState().user;
export function setSession(token: string, user?: Me) {
  useSession.setState((s) => ({ token, user: user ?? s.user }));
  window.dispatchEvent(new Event("oja-session"));
}
export function clearSession() {
  useSession.setState({ token: null, user: null });
  window.dispatchEvent(new Event("oja-session"));
}

export async function login(email: string, password: string) {
  const r = await apiStrict<{ accessToken: string; user: Me }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  setSession(r.accessToken, r.user);
  return r.user;
}
export async function register(name: string, email: string, password: string) {
  const r = await apiStrict<{ accessToken: string; user: Me }>("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) });
  setSession(r.accessToken, r.user);
  return r.user;
}
export async function logout() {
  try { await apiStrict("/auth/logout", { method: "POST" }); } catch { /* best effort */ }
  clearSession();
}
