"use client";
import { apiStrict } from "./api";

/**
 * Access token lives in sessionStorage (15 min JWT); the refresh token is an httpOnly cookie set by the API.
 * Tradeoff: sessionStorage is readable by injected scripts, so keep CSP strict; the long-lived secret never is.
 */
export interface Me { id: string; email: string; name: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" | "AGENT" }
const K = "oja.token", U = "oja.user";

export const getToken = (): string | null => { try { return sessionStorage.getItem(K); } catch { return null; } };
export const getUser = (): Me | null => { try { return JSON.parse(sessionStorage.getItem(U) ?? "null"); } catch { return null; } };
export function setSession(token: string, user?: Me) {
  try { sessionStorage.setItem(K, token); if (user) sessionStorage.setItem(U, JSON.stringify(user)); } catch { /* private mode */ }
  window.dispatchEvent(new Event("oja-session"));
}
export function clearSession() {
  try { sessionStorage.removeItem(K); sessionStorage.removeItem(U); } catch { /* ignore */ }
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
