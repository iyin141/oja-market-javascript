import Link from "next/link";
import { Shell } from "@/components/Shell";
import { BuyBox, Tabs } from "@/components/interactive";
import { ProductPhoto, Icon, StarRating } from "@/components/ui";
import { Reviews } from "@/components/Reviews";
import { getProduct } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data: p, live } = await getProduct(slug);
  if (!p) return <Shell live={live}><p role="alert" className="bg-surface-card rounded-xl p-space-xl text-center text-text-secondary">This product could not be loaded right now. Please try again shortly.</p></Shell>;
  const hero = p.images[0]?.url ?? p.image;
  return (
    <Shell live={live}>
      <nav aria-label="Breadcrumb" className="flex items-center gap-space-xs font-caption text-caption text-text-secondary mb-space-md">
        <Link href="/">Home</Link><Icon name="chevron_right" className="text-[16px]" /><span>{p.category.name}</span><Icon name="chevron_right" className="text-[16px]" /><span className="text-text-primary">{p.title}</span>
      </nav>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_360px] gap-space-lg [&>*]:min-w-0">
        <div className="flex flex-col gap-space-sm lg:col-span-1">
          <div className="aspect-square rounded-xl bg-surface-container-low flex items-center justify-center overflow-hidden">
            {hero
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={hero} alt={p.title} className="w-full h-full object-cover" />
              : <ProductPhoto title={p.title} icon={p.icon} className="w-full h-full object-cover" />}
          </div>
          {p.images.length > 1 && (
            <div className="flex gap-space-xs">{p.images.map((i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i.id} src={i.thumb} alt="" className="w-16 h-16 rounded-lg object-cover" />
            ))}</div>
          )}
        </div>
        <div className="flex flex-col gap-space-sm">
          <Link href={`/store/${p.vendor.slug}`} className="font-label-md text-label-md text-secondary flex items-center gap-space-xs"><Icon name="verified" className="text-[18px]" />{p.vendor.storeName}</Link>
          <h1 className="font-headline-lg text-headline-lg text-text-primary">{p.title}</h1>
          <StarRating value={p.ratingAvg} count={p.ratingCount} />
          <p className="font-caption text-caption text-text-secondary">Vendor trust score {p.vendor.score}/100</p>
          <div className="mt-space-md">
            <Tabs tabs={[
              { id: "about", label: "About this item", content: <p className="font-body-md text-body-md text-text-primary whitespace-pre-line">{p.description || "No description yet."}</p> },
              { id: "ship", label: "Shipping & returns", content: <p className="font-body-sm text-body-sm text-text-secondary">Ships from the vendor. Returns accepted within 7 days of delivery; the vendor has 48 hours to respond before a refund is issued automatically.</p> },
              { id: "reviews", label: `Reviews (${p.ratingCount})`, content: <Reviews productId={p.id} path={`/p/${p.slug}`} /> },
            ]} />
          </div>
        </div>
        <BuyBox product={p} />
      </div>
    </Shell>
  );
}
