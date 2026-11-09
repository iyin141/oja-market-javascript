import Link from "next/link";
import type { ReactNode } from "react";
import { Masthead } from "./Masthead";
import { Notice } from "./ui";

export function Footer() {
  const cols: [string, [string, string][]][] = [
    ["Shop", [["/search", "All products"], ["/search?sort=newest", "New arrivals"], ["/cart", "Cart"]]],
    ["Sell", [["/register?vendor=1", "Become a vendor"], ["/seller", "Seller centre"]]],
    ["Help", [["/orders", "Track an order"], ["/login", "Sign in"]]],
  ];
  return (
    <footer className="bg-primary text-on-primary mt-space-xl">
      <div className="px-margin md:px-margin-desktop py-space-xl grid grid-cols-2 md:grid-cols-4 gap-space-lg">
        <div><p className="font-headline-md text-headline-md">Oja Market</p><p className="font-body-sm text-body-sm text-on-primary/70 mt-1">Independent vendors. Escrow-protected checkout.</p></div>
        {cols.map(([h, links]) => (
          <div key={h}><p className="font-title-sm text-title-sm mb-space-sm">{h}</p>
            <ul className="flex flex-col gap-space-xs">{links.map(([href, l]) => <li key={l}><Link href={href} className="font-body-sm text-body-sm text-on-primary/80 hover:text-on-primary">{l}</Link></li>)}</ul></div>
        ))}
      </div>
    </footer>
  );
}

/** Page chrome: masthead, optional offline banner, content, footer. */
export function Shell({ children, live = true, wide = true }: { children: ReactNode; live?: boolean; wide?: boolean }) {
  return (
    <>
      <Masthead />
      <Notice live={live} />
      <main className={`${wide ? "max-w-[1400px]" : "max-w-3xl"} mx-auto px-margin md:px-margin-desktop py-space-lg min-h-[60vh]`}>{children}</main>
      <Footer />
    </>
  );
}
