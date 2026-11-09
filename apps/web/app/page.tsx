import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Icon, ProductTile } from "@/components/ui";
import { getProducts } from "@/lib/api";
import { FIXTURE_CATEGORIES, FIXTURE_VENDORS } from "@/lib/fixtures";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data: products, live } = await getProducts();
  const byVendor = FIXTURE_VENDORS.map((v) => ({ v, items: products.filter((p) => p.vendorSlug === v.slug).slice(0, 4) })).filter((g) => g.items.length);
  return (
    <Shell live={live}>
      <section className="rounded-xl bg-primary-container text-on-primary p-space-xl md:p-[3rem] flex flex-col gap-space-md relative overflow-hidden">
        <span className="inline-flex items-center gap-space-xs self-start px-space-sm py-1 rounded-full bg-secondary/20 text-secondary-fixed font-label-sm text-label-sm"><Icon name="verified" className="text-[16px]" />Verified vendor showcase</span>
        <h1 className="font-display-mobile md:font-display text-display-mobile md:text-display max-w-2xl">Discover curated goods from independent Nigerian vendors</h1>
        <p className="font-body-md text-body-md text-on-primary/80 max-w-xl">Pay once, many vendors ship. Your money stays in escrow until your order arrives.</p>
        <div className="flex flex-wrap gap-space-sm">
          <Link href="/search" className="inline-flex items-center gap-space-xs px-space-lg py-3 rounded-full bg-tertiary-fixed-dim text-on-tertiary-fixed font-label-md text-label-md">Shop featured deals<Icon name="arrow_forward" className="text-[18px]" /></Link>
          <span className="inline-flex items-center gap-space-xs text-on-primary/80 font-label-md text-label-md"><Icon name="lock" className="text-[18px]" />Direct vendor escrow protection</span>
        </div>
      </section>

      <section className="mt-space-xl">
        <h2 className="font-headline-md text-headline-md text-text-primary mb-space-md">Shop by department</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-space-md">
          {FIXTURE_CATEGORIES.map((c) => (
            <Link key={c.id} href={`/search?q=${encodeURIComponent(c.name.split(" ")[0])}`} className="bg-surface-card rounded-xl p-space-md shadow-sm hover:shadow-md flex flex-col items-center gap-space-xs text-center">
              <Icon name={c.icon} className="text-[36px] text-secondary" />
              <span className="font-label-md text-label-md text-text-primary">{c.name}</span>
              <span className="font-caption text-caption text-text-secondary">{c.count.toLocaleString()} items</span>
            </Link>
          ))}
        </div>
      </section>

      {byVendor.map(({ v, items }) => (
        <section key={v.id} className="mt-space-xl">
          <div className="flex items-end justify-between mb-space-md">
            <h2 className="font-headline-md text-headline-md text-text-primary">From {v.name}</h2>
            <Link href={`/store/${v.slug}`} className="flex items-center gap-space-xs font-label-md text-label-md text-secondary">Visit store<Icon name="arrow_forward" className="text-[18px]" /></Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">{items.map((p) => <ProductTile key={p.id} p={p} />)}</div>
        </section>
      ))}
    </Shell>
  );
}
