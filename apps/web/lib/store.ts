"use client";
import { create } from "zustand";
import type { CartLine } from "./types";
import type { Me } from "./session";

const ss = () => { try { return window.sessionStorage; } catch { return undefined; } };
const ls = () => { try { return window.localStorage; } catch { return undefined; } };
const isBrowser = typeof window !== "undefined";
const json = <T,>(raw: string | null | undefined, d: T): T => { try { return raw ? (JSON.parse(raw) as T) : d; } catch { return d; } };

/** Session (access token + user): kept in sessionStorage under the same keys the app used before zustand. */
interface SessionState { token: string | null; user: Me | null }
export const useSession = create<SessionState>(() => ({
  token: isBrowser ? ss()?.getItem("oja.token") ?? null : null,
  user: isBrowser ? json<Me | null>(ss()?.getItem("oja.user"), null) : null,
}));
if (isBrowser) {
  useSession.subscribe((s) => {
    try {
      s.token ? ss()?.setItem("oja.token", s.token) : ss()?.removeItem("oja.token");
      s.user ? ss()?.setItem("oja.user", JSON.stringify(s.user)) : ss()?.removeItem("oja.user");
    } catch { /* private mode */ }
  });
}

/** Cart: kept in localStorage ("oja.cart"). Starts empty so server and first client render match; call hydrate() in an effect. */
interface CartState { lines: CartLine[]; ready: boolean; hydrate: () => void; set: (l: CartLine[]) => void }
export const useCartStore = create<CartState>((set, get) => ({
  lines: [],
  ready: false,
  hydrate: () => { if (!get().ready) set({ lines: json<CartLine[]>(ls()?.getItem("oja.cart"), []), ready: true }); },
  set: (lines) => { set({ lines, ready: true }); try { ls()?.setItem("oja.cart", JSON.stringify(lines)); } catch { /* storage blocked */ } },
}));
if (isBrowser) {
  window.addEventListener("storage", (e) => { if (e.key === "oja.cart") useCartStore.setState({ lines: json<CartLine[]>(e.newValue, []) }); });
}
