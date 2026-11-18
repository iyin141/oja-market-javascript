import Form from "next/form";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { btn, Icon, inputCls, PageTitle, ProductTile } from "@/components/ui";
import { getSearch } from "@/lib/api";
import { formatKobo } from "@/lib/money";

export const dynamic = "force-dynamic";
const SORTS: [string, string][] = [["relevance", "Best match"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["rating", "Customer rating"], ["newest", "Newest"]];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sp = { q?: string; sort?: string; categoryId?: string; vendorId?: string; min?: string; max?: string; inStock?: string };
/** URL price filters are whole naira (min/max); the API takes kobo. Anything that is not a plain number is ignored. */
const nairaToKobo = (v?: string) => (v && /^\d{1,12}$/.test(v) ? String(BigInt(v) * 100n) : undefined);

export default async function Search({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const q = sp.q ?? "", sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : "relevance";
  const categoryId = sp.categoryId && UUID.test(sp.categoryId) ? sp.categoryId : undefined;
  const vendorId = sp.vendorId && UUID.test(sp.vendorId) ? sp.vendorId : undefined;
  const min = nairaToKobo(sp.min) ? sp.min : undefined, max = nairaToKobo(sp.max) ? sp.max : undefined;
  const inStock = sp.inStock === "1";
  const { data, live } = await getSearch({ q, sort, categoryId, vendorId, minPrice: nairaToKobo(min), maxPrice: nairaToKobo(max), inStock });

  const state: Record<string, string | undefined> = { q, sort, categoryId, vendorId, min, max, inStock: inStock ? "1" : undefined };
  /** Link to this search with some parameters changed (undefined removes one). */
  const href = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...state, ...over })) if (v) u.set(k, v);
    return `/search?${u}`;
  };
  const catName = data.facets.categories.find((c) => c.id === categoryId)?.name ?? "Category";
  const vendName = data.facets.vendors.find((v) => v.id === vendorId)?.name ?? "Vendor";
  const chips: [string, string][] = [];
  if (categoryId) chips.push([`Category: ${catName}`, href({ categoryId: undefined })]);
  if (vendorId) chips.push([`Vendor: ${vendName}`, href({ vendorId: undefined })]);
  if (min || max) chips.push([`Price: ${min ? `from NGN ${Number(min).toLocaleString()}` : ""}${min && max ? " " : ""}${max ? `up to NGN ${Number(max).toLocaleString()}` : ""}`, href({ min: undefined, max: undefined })]);
  if (inStock) chips.push(["In stock only", href({ inStock: undefined })]);
  const row = (active: boolean) => `flex justify-between font-body-sm text-body-sm ${active ? "text-secondary font-semibold" : "hover:text-secondary"}`;

  return (
    <Shell live={live}>
      <PageTitle title={q ? `Results for "${q}"` : "All products"} sub={`${data.total.toLocaleString()} products from verified vendors`}
        actions={
          <nav aria-label="Sort" className="flex flex-wrap items-center gap-space-xs font-label-sm text-label-sm">
            <span className="text-text-secondary">Sort by</span>
            {SORTS.map(([k, l]) => <Link key={k} href={href({ sort: k })} aria-current={sort === k} className={`px-space-sm py-1 rounded-full ${sort === k ? "bg-secondary text-on-secondary" : "bg-surface-container text-text-primary"}`}>{l}</Link>)}
          </nav>
        } />
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-space-xs mb-space-md font-label-sm text-label-sm" aria-label="Active filters">
          {chips.map(([label, to]) => (
            <Link key={label} href={to} aria-label={`Remove filter ${label}`} className="inline-flex items-center gap-1 px-space-sm py-1 rounded-full bg-secondary/10 text-secondary">{label}<Icon name="close" className="text-[16px]" /></Link>
          ))}
          <Link href={href({ categoryId: undefined, vendorId: undefined, min: undefined, max: undefined, inStock: undefined })} className="text-text-secondary underline">Clear all</Link>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-space-lg [&>*]:min-w-0">
        <aside className="flex flex-col gap-space-md" aria-label="Filters">
          <div className="bg-surface-card rounded-xl p-space-md shadow-sm">
            <h2 className="font-title-sm text-title-sm mb-space-sm">Category</h2>
            <ul className="flex flex-col gap-space-xs">
              {data.facets.categories.map((c) => <li key={c.id}><Link href={href({ categoryId: c.id === categoryId ? undefined : c.id })} aria-current={c.id === categoryId} className={row(c.id === categoryId)}><span>{c.name}</span><span className="text-text-secondary">{c.count}</span></Link></li>)}
              {data.facets.categories.length === 0 && <li className="text-text-secondary font-body-sm">None</li>}
            </ul>
          </div>
          <div className="bg-surface-card rounded-xl p-space-md shadow-sm">
            <h2 className="font-title-sm text-title-sm mb-space-sm">Vendors</h2>
            <ul className="flex flex-col gap-space-xs">
              {data.facets.vendors.map((v) => <li key={v.id}><Link href={href({ vendorId: v.id === vendorId ? undefined : v.id })} aria-current={v.id === vendorId} className={row(v.id === vendorId)}><span>{v.name}</span><span className="text-text-secondary">{v.count}</span></Link></li>)}
              {data.facets.vendors.length === 0 && <li className="text-text-secondary font-body-sm">None</li>}
            </ul>
          </div>
          <div className="bg-surface-card rounded-xl p-space-md shadow-sm font-body-sm text-body-sm">
            <h2 className="font-title-sm text-title-sm mb-space-sm">Price (naira)</h2>
            {data.facets.price.min && data.facets.price.max && <p className="text-text-secondary mb-space-xs">Available: {formatKobo(data.facets.price.min)} to {formatKobo(data.facets.price.max)}</p>}
            <Form action="/search" className="flex flex-col gap-space-xs">
              {Object.entries({ q, sort, categoryId, vendorId, inStock: inStock ? "1" : undefined }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
              <div className="flex items-center gap-space-xs">
                <input name="min" inputMode="numeric" pattern="[0-9]*" defaultValue={min} placeholder="Min" aria-label="Minimum price in naira" className={inputCls} />
                <span>-</span>
                <input name="max" inputMode="numeric" pattern="[0-9]*" defaultValue={max} placeholder="Max" aria-label="Maximum price in naira" className={inputCls} />
              </div>
              <button className={btn.ghost}>Apply price</button>
            </Form>
            <Link href={href({ inStock: inStock ? undefined : "1" })} aria-pressed={inStock} className={`mt-space-sm flex items-center gap-space-xs ${inStock ? "text-secondary font-semibold" : ""}`}>
              <Icon name={inStock ? "check_box" : "check_box_outline_blank"} className="text-[20px]" />In stock only
            </Link>
          </div>
        </aside>
        <section aria-label="Results">
          {data.items.length === 0
            ? <p className="bg-surface-card rounded-xl p-space-xl text-center text-text-secondary">{live ? "No products match your search. Try fewer words or clear some filters." : "Search is unavailable right now."}</p>
            : <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-space-md">{data.items.map((p) => <ProductTile key={p.id} p={p} />)}</div>}
        </section>
      </div>
    </Shell>
  );
}
