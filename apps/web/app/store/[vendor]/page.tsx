import { Shell } from "@/components/Shell";
import { Icon, PageTitle, ProductTile } from "@/components/ui";
import { api } from "@/lib/api";
import { FIXTURE_PRODUCTS, pick } from "@/lib/fixtures";
import type { ProductSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Store({ params }: { params: Promise<{ vendor: string }> }) {
  const { vendor } = await params;
  const { data, live } = await api<ProductSummary[]>(`/products?vendorSlug=${encodeURIComponent(vendor)}&limit=48`, pick([], FIXTURE_PRODUCTS.filter((p) => p.vendorSlug === vendor)));
  // The API has no vendor-by-slug lookup: the name comes from the vendor's listed products.
  const name = data[0]?.vendorName ?? "Store";
  return (
    <Shell live={live}>
      <div className="rounded-xl bg-primary-container text-on-primary p-space-lg flex items-center gap-space-md mb-space-lg">
        <div className="w-16 h-16 rounded-full bg-secondary/20 flex items-center justify-center"><Icon name="storefront" className="text-[32px] text-secondary-fixed" /></div>
        <div><h1 className="font-headline-lg text-headline-lg">{name}</h1>{data.length > 0 && <p className="flex items-center gap-space-xs font-label-md text-label-md text-secondary-fixed"><Icon name="verified" className="text-[18px]" />Verified vendor</p>}</div>
      </div>
      <PageTitle title="Products" sub={`${data.length} listed`} />
      {data.length === 0 ? <p className="bg-surface-card rounded-xl p-space-xl text-center text-text-secondary">{live ? "This store does not exist or has no listed products yet." : "Products could not be loaded right now."}</p>
        : <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-space-md">{data.map((p) => <ProductTile key={p.id} p={p} />)}</div>}
    </Shell>
  );
}
