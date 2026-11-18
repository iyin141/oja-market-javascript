import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Icon, ProductTile } from "@/components/ui";
import { getCategories, getProducts } from "@/lib/api";
import type { ProductSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Material icon by category name; anything unknown gets a generic one. */
const ICONS: [RegExp, string][] = [
  [/electron|phone|gadget|computer/i, "devices"], [/fashion|cloth|wear|shoe/i, "checkroom"], [/home|kitchen|furniture/i, "chair"],
  [/beauty|health|care/i, "spa"], [/grocer|food|pantry/i, "shopping_basket"], [/sport|fitness/i, "sports_soccer"], [/book|stationery/i, "menu_book"], [/toy|kid|baby/i, "toys"],
];
const iconFor = (name: string) => ICONS.find(([re]) => re.test(name))?.[1] ?? "category";

export default async function Home() {
  const [{ data: products, live }, { data: categories }] = await Promise.all([getProducts(), getCategories()]);
  // Vendors come from the products the API returned, in first-seen order, so any real vendor appears.
  const groups = new Map<string, { name: string; items: ProductSummary[] }>();
  for (const p of products) {
    const g = groups.get(p.vendorSlug) ?? { name: p.vendorName, items: [] };
    if (g.items.length < 4) g.items.push(p);
    groups.set(p.vendorSlug, g);
  }
  const byVendor = [...groups].slice(0, 6);
  return (
    <Shell live={live}>
      <section className="rounded-xl bg-primary-container text-on-primary p-space-xl md:p-[3rem] flex flex-col gap-space-md relative overflow-hidden">
        <span className="inline-flex items-center gap-space-xs self-start px-space-sm py-1 rounded-full bg-secondary/20 text-secondary-fixed font-label-sm text-label-sm"><Icon name="verified" className="text-[16px]" />Verified vendor showcase</span>
        <h1 className="font-display-mobile md:font-display text-display-mobile md:text-display max-w-2xl">Discover curated goods from independent Nigerian vendors</h1>
        <p className="font-body-md text-body-md text-on-primary/80 max-w-xl">Pay once, many vendors ship. Your money stays in escrow until your order arrives.</p>
        <div className="flex flex-wrap gap-space-sm">
          <Link href="/search" className="inline-flex items-center gap-space-xs px-space-lg py-3 rounded-full bg-tertiary-fixed-dim text-on-tertiary-fixed font-label-md text-label-md">Shop all products<Icon name="arrow_forward" className="text-[18px]" /></Link>
          <span className="inline-flex items-center gap-space-xs text-on-primary/80 font-label-md text-label-md"><Icon name="lock" className="text-[18px]" />Direct vendor escrow protection</span>
        </div>
      </section>

      {categories.length > 0 && (
        <section className="mt-space-xl">
          <h2 className="font-headline-md text-headline-md text-text-primary mb-space-md">Shop by department</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-space-md">
            {categories.map((c) => (
              <Link key={c.id} href={`/search?categoryId=${c.id}`} className="bg-surface-card rounded-xl p-space-md shadow-sm hover:shadow-md flex flex-col items-center gap-space-xs text-center">
                <Icon name={iconFor(c.name)} className="text-[36px] text-secondary" />
                <span className="font-label-md text-label-md text-text-primary">{c.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {products.length === 0 && live && <p className="mt-space-xl bg-surface-card rounded-xl p-space-xl text-center text-text-secondary">No products are listed yet. Check back soon.</p>}
      {byVendor.map(([slug, { name, items }]) => (
        <section key={slug} className="mt-space-xl">
          <div className="flex items-end justify-between mb-space-md">
            <h2 className="font-headline-md text-headline-md text-text-primary">From {name}</h2>
            <Link href={`/store/${slug}`} className="flex items-center gap-space-xs font-label-md text-label-md text-secondary">Visit store<Icon name="arrow_forward" className="text-[18px]" /></Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">{items.map((p) => <ProductTile key={p.id} p={p} />)}</div>
        </section>
      ))}
    </Shell>
  );
}
