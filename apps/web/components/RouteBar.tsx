"use client";
import { usePathname } from "next/navigation";

/** Thin bar that sweeps across the top on every route change (keyed by path so it replays). */
export function RouteBar() {
  const path = usePathname();
  return <div key={path} className="route-bar text-primary" aria-hidden />;
}
