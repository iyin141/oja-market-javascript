"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useCart } from "@/lib/cart";
import { getProducts, refreshAccess } from "@/lib/api";
import { getToken, getUser, logout, type Me } from "@/lib/session";
import { Img } from "./Img";
import { Icon } from "./ui";

const NAV: [string, string][] = [["/search", "All Products"], ["/search?sort=rating", "Best Rated"], ["/search?sort=newest", "New Arrivals"]];

/** First vendor that really has listed products, looked up once per page load (null when the API has none or is down). */
let topVendor: Promise<{ slug: string; name: string } | null> | undefined;
const loadTopVendor = () => (topVendor ??= getProducts().then((r) => (r.live && r.data[0] ? { slug: r.data[0].vendorSlug, name: r.data[0].vendorName } : null)).catch(() => null));

export function Masthead() {
  const router = useRouter();
  const { count } = useCart();
  const [q, setQ] = useState("");
  const [user, setUser] = useState<Me | null>(null);
  const [top, setTop] = useState<{ slug: string; name: string } | null>(null);
  useEffect(() => { void loadTopVendor().then(setTop); }, []);
  useEffect(() => {
    const sync = () => setUser(getUser());
    sync();
    // New tab: the access token lives per tab, so restore the session from the refresh cookie.
    if (!getToken()) void refreshAccess();
    window.addEventListener("oja-session", sync);
    return () => window.removeEventListener("oja-session", sync);
  }, []);
  const submit = (e: FormEvent) => { e.preventDefault(); router.push(`/search?q=${encodeURIComponent(q)}`); };
  const home = user?.role === "ADMIN" ? "/admin" : user?.role === "VENDOR" ? "/seller" : user?.role === "AGENT" ? "/agent" : "/orders";
  return (
    <header className="sticky top-0 z-50 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="bg-surface-card flex items-center justify-between gap-space-md px-margin md:px-margin-desktop h-16">
        <Link href="/" className="flex items-center gap-space-xs shrink-0">
          <Img name="logo" alt="" className="h-8 w-8 rounded-md object-cover" fallback={<Icon name="storefront" className="text-secondary text-[28px]" />} />
          <span className="font-headline-lg text-headline-lg text-primary tracking-tight">Oja Market</span>
        </Link>
        <form onSubmit={submit} role="search" className="flex-1 max-w-2xl hidden md:flex items-center bg-surface-container-low rounded-full pl-space-md pr-space-xs py-space-xs">
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" className="w-full bg-transparent font-body-sm text-body-sm text-text-primary outline-none placeholder:text-text-secondary" placeholder="Search products, vendors, brands..." />
          <button className="h-9 px-space-md rounded-full bg-secondary text-on-secondary flex items-center" aria-label="Search"><Icon name="search" className="text-[20px]" /></button>
        </form>
        <nav className="flex items-center gap-space-md">
          {user ? (
            <>
              <Link href={home} className="sm:hidden flex items-center" aria-label={user.role === "CUSTOMER" ? "Orders" : "Dashboard"}><Icon name="person" className="text-text-primary text-[26px]" /></Link>
              <Link href={home} className="hidden sm:flex flex-col text-left"><span className="font-caption text-caption text-text-secondary">Hello, {user.name.split(" ")[0]}</span><span className="font-label-sm text-label-sm text-text-primary">{user.role === "CUSTOMER" ? "Orders" : "Dashboard"}</span></Link>
              <button type="button" onClick={async () => { await logout(); router.push("/login"); }} className="font-label-sm text-label-sm text-text-secondary hover:text-primary">Sign out</button>
            </>
          ) : (
            <>
            <Link href="/login" className="hidden sm:flex flex-col text-left"><span className="font-caption text-caption text-text-secondary">Hello, Sign in</span><span className="font-label-sm text-label-sm text-text-primary">Account</span></Link>
            <Link href="/login" className="sm:hidden flex items-center" aria-label="Sign in"><Icon name="person" className="text-text-primary text-[26px]" /></Link>
            </>
          )}
          <Link href="/cart" className="relative flex items-center rounded-full px-space-sm py-space-xs hover:bg-surface-container" aria-label={`Cart, ${count} items`}>
            <Icon name="shopping_cart" className="text-text-primary text-[26px]" />
            {count > 0 && <span className="absolute -top-1 left-5 h-5 min-w-[20px] px-1 rounded-full bg-tertiary-fixed-dim text-on-tertiary-fixed font-label-sm text-label-sm flex items-center justify-center">{count}</span>}
          </Link>
        </nav>
      </div>
      <form onSubmit={submit} role="search" className="md:hidden bg-surface-card px-margin pb-space-sm">
        <div className="flex items-center bg-surface-container-low rounded-full pl-space-md pr-space-xs py-space-xs">
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" className="w-full min-w-0 bg-transparent font-body-sm text-body-sm text-text-primary outline-none placeholder:text-text-secondary" placeholder="Search products, vendors..." />
          <button className="h-9 px-space-md rounded-full bg-secondary text-on-secondary flex items-center" aria-label="Search"><Icon name="search" className="text-[20px]" /></button>
        </div>
      </form>
      <div className="bg-primary-container text-on-primary px-margin md:px-margin-desktop h-10 flex items-center gap-space-lg overflow-x-auto">
        {[...NAV, ...(top ? [[`/store/${top.slug}`, `Shop ${top.name}`] as [string, string]] : [])].map(([href, label]) => <Link key={label} href={href} className="font-label-md text-label-md text-on-primary/90 hover:text-on-primary whitespace-nowrap">{label}</Link>)}
        <Link href="/register?vendor=1" className="ml-auto flex items-center gap-space-xs font-label-md text-label-md text-tertiary-fixed-dim whitespace-nowrap"><Icon name="storefront" className="text-[18px]" />Sell on Oja Market</Link>
      </div>
    </header>
  );
}
