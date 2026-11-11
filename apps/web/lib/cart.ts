"use client";
import { useCallback, useEffect } from "react";
import { mulKobo } from "./money";
import { useCartStore } from "./store";
import type { CartLine } from "./types";

const read = (): CartLine[] => useCartStore.getState().lines;
const write = (l: CartLine[]) => useCartStore.getState().set(l);

export function addToCart(line: CartLine) {
  const cur = [...read()];
  const i = cur.findIndex((x) => x.variantId === line.variantId);
  if (i >= 0) cur[i] = { ...cur[i], qty: Math.min(99, cur[i].qty + line.qty) };
  else cur.push(line);
  write(cur);
}
export const clearCart = () => write([]);

/** Cart state shared across components via a window event; renders empty when localStorage is unavailable. */
export function useCart() {
  const lines = useCartStore((s) => s.lines);
  const ready = useCartStore((s) => s.ready);
  useEffect(() => { useCartStore.getState().hydrate(); }, []);
  const setQty = useCallback((variantId: string, qty: number) => write(read().flatMap((l) => (l.variantId !== variantId ? [l] : qty <= 0 ? [] : [{ ...l, qty: Math.min(99, qty) }]))), []);
  const remove = useCallback((variantId: string) => write(read().filter((l) => l.variantId !== variantId)), []);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const totalKobo = lines.reduce((s, l) => s + mulKobo(l.priceKobo, l.qty), 0n);
  return { lines, ready, count, totalKobo, setQty, remove };
}
