import Link from "next/link";
import { Shell } from "@/components/Shell";
import { PageTitle, ProductTile } from "@/components/ui";
import { getSearch } from "@/lib/api";
import { formatKobo } from "@/lib/money";

export const dynamic = "force-dynamic";
const SORTS: [string, string][] = [["relevance", "Best match"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["rating", "Customer rating"], ["newest", "Newest"]];

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string }> }) {
  const { q = "", sort = "relevance" } = await searchParams;
  const { data, live } = await getSearch(q, sort);
  const href = (s: string) => `/search?q=${encodeURIComponent(q)}&sort=${s}`;
  return (
    <Shell live={live}>
      <PageTitle title={q ? `Results for "${q}"` : "All products"} sub={`${data.total.toLocaleString()} products from verified vendors`}
        actions={
          <nav aria-label="Sort" className="flex flex-wrap items-center gap-space-xs font-label-sm text-label-sm">
            <span className="text-text-secondary">Sort by</span>
            {SORTS.map(([k, l]) => <Link key={k} href={href(k)} aria-current={sort === k} className={`px-space-sm py-1 rounded-full ${sort === k ? "bg-secondary text-on-secondary" : "bg-surface-container text-text-primary"}`}>{l}</Link>)}
          </nav>
        } />
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-space-lg [&>*]:min-w-0">
        <aside className="flex flex-col gap-space-md" aria-label="Filters">
          <div className="bg-surface-card rounded-xl p-space-md shadow-sm">
            <h2 className="font-title-sm text-title-sm mb-space-sm">Category</h2>
            <ul className="flex flex-col gap-space-xs">
              {data.facets.categories.map((c) => <li key={c.id} className="flex justify-between font-body-sm text-body-sm"><span>{c.name}</span><span className="text-text-secondary">{c.count}</span></li>)}
            </ul>
          </div>
          <div className="bg-surface-card rounded-xl p-space-md shadow-sm">
            <h2 className="font-title-sm text-title-sm mb-space-sm">Vendors</h2>
            <ul className="flex flex-col gap-space-xs">
              {data.facets.vendors.map((v) => <li key={v.id} className="flex justify-between font-body-sm text-body-sm"><span>{v.name}</span><span className="text-text-secondary">{v.count}</span></li>)}
            </ul>
          </div>
          {data.facets.price.min && data.facets.price.max && (
            <div className="bg-surface-card rounded-xl p-space-md shadow-sm font-body-sm text-body-sm">
              <h2 className="font-title-sm text-title-sm mb-space-sm">Price range</h2>
              {formatKobo(data.facets.price.min)} to {formatKobo(data.facets.price.max)}
            </div>
          )}
        </aside>
        <section aria-label="Results">
          {data.items.length === 0
            ? <p className="bg-surface-card rounded-xl p-space-xl text-center text-text-secondary">No products match your search. Try fewer words.</p>
            : <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-space-md">{data.items.map((p) => <ProductTile key={p.id} p={p} />)}</div>}
        </section>
      </div>
    </Shell>
  );
}
