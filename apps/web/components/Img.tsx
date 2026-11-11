"use client";
import { useState, type ReactNode } from "react";

/** Static picture from public/img/<name>.webp. Shows `fallback` until the file exists (or if it fails to load). */
export function Img({ name, alt = "", className = "", fallback = null }: { name: string; alt?: string; className?: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/img/${name}.webp`} alt={alt} className={className} onError={() => setFailed(true)} />;
}
