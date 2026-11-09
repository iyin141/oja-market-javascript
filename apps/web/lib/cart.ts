"use client";
import { useCallback, useEffect, useState } from "react";
import { mulKobo } from "./money";
import type { CartLine } from "./types";

const KEY = "oja.cart";
const read = (): CartLine[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
const write = (l: CartLine[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("oja-cart"));
};

export function addToCart(line: CartLine) {
  const cur = read();
  const i = cur.findIndex((x) => x.variantId === line.variantId);
  if (i >= 0) cur[i] = { ...cur[i], qty: Math.min(99, cur[i].qty + line.qty) };
  else cur.push(line);
  write(cur);
}
export const clearCart = () => write([]);

/** Cart state shared across components via a window event; renders empty when localStorage is unavailable. */
export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => setLines(read());
    sync();
    setReady(true);
    window.addEventListener("oja-cart", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("oja-cart", sync); window.removeEventListener("storage", sync); };
  }, []);
  const setQty = useCallback((variantId: string, qty: number) => write(read().flatMap((l) => (l.variantId !== variantId ? [l] : qty <= 0 ? [] : [{ ...l, qty: Math.min(99, qty) }]))), []);
  const remove = useCallback((variantId: string) => write(read().filter((l) => l.variantId !== variantId)), []);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const totalKobo = lines.reduce((s, l) => s + mulKobo(l.priceKobo, l.qty), 0n);
  return { lines, ready, count, totalKobo, setQty, remove };
}
