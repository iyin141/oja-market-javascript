import Link from "next/link";
import { Img } from "./Img";
import { productImageKey } from "@/lib/images";
import type { ReactNode } from "react";
import { formatKobo, type KoboLike } from "@/lib/money";
import type { SubOrderStatus } from "@/lib/types";
import { USE_FIXTURES } from "@/lib/env";

export const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span aria-hidden="true" className={`material-symbols-outlined ${className}`}>{name}</span>
);

export function StarRating({ value, count }: { value: number; count?: number }) {
  const full = Math.round(value);
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-status-warning font-label-sm text-label-sm" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" className={`text-[15px] ${i <= full ? "" : "text-surface-container-highest"}`} />
      ))}
      <span className="text-text-primary font-bold">{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-text-secondary font-normal font-caption text-caption">({count.toLocaleString()})</span>}
    </span>
  );
}

export function PriceBlock({ kobo, was, size = "md" }: { kobo: KoboLike; was?: KoboLike; size?: "md" | "lg" }) {
  const hasDiscount = was !== undefined && BigInt(was) > BigInt(kobo);
  return (
    <span className="flex items-baseline gap-space-xs flex-wrap">
      <span className={`${size === "lg" ? "font-display text-display" : "font-title-sm text-title-sm"} text-text-primary font-bold`}>{formatKobo(kobo)}</span>
      {hasDiscount && <span className="font-caption text-caption text-text-secondary line-through">{formatKobo(was!)}</span>}
    </span>
  );
}

const TONE: Record<string, string> = {
  success: "bg-status-success/10 text-status-success", warning: "bg-status-warning/10 text-status-warning",
  danger: "bg-status-danger/10 text-status-danger", info: "bg-status-info/10 text-status-info", neutral: "bg-surface-container text-text-secondary",
};
const STATUS_TONE: Record<SubOrderStatus | "MIXED", [string, string]> = {
  PENDING_PAYMENT: ["warning", "Awaiting payment"], PAID: ["info", "Paid"], AWAITING_COLLECTION: ["info", "Pay on delivery"], PACKED: ["info", "Packed"],
  SHIPPED: ["info", "Shipped"], DELIVERED: ["success", "Delivered"], RETURN_REQUESTED: ["warning", "Return requested"], REFUNDED: ["neutral", "Refunded"],
  SETTLED: ["success", "Settled"], EXPIRED: ["neutral", "Expired"], CANCELLED: ["danger", "Cancelled"], MIXED: ["info", "In progress"],
};
export function StatusChip({ status, label, tone }: { status?: SubOrderStatus | "MIXED"; label?: string; tone?: keyof typeof TONE }) {
  const [t, l] = status ? STATUS_TONE[status] : [tone ?? "neutral", label ?? ""];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-label-sm text-label-sm ${TONE[t]}`}>{label ?? l}</span>;
}

export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: string }) {
  return (
    <div className="bg-surface-card rounded-xl p-space-md shadow-sm flex flex-col gap-space-xs">
      <div className="flex items-center justify-between text-text-secondary font-label-sm text-label-sm">
        <span>{label}</span>{icon && <Icon name={icon} className="text-[20px] text-secondary" />}
      </div>
      <div className="font-headline-lg text-headline-lg text-text-primary">{value}</div>
      {hint && <div className="font-caption text-caption text-text-secondary">{hint}</div>}
    </div>
  );
}

export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; className?: string }
export function DataTable<T>({ columns, rows, rowKey, empty = "Nothing here yet." }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: string }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-left font-body-sm text-body-sm">
        <thead>
          <tr className="border-b border-border-subtle text-text-secondary font-label-sm text-label-sm">
            {columns.map((c) => <th key={c.key} scope="col" className={`px-space-md py-space-sm ${c.className ?? ""}`}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="px-space-md py-space-xl text-center text-text-secondary">{empty}</td></tr>}
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-border-subtle last:border-0 hover:bg-surface-container-low">
              {columns.map((c) => <td key={c.key} className={`px-space-md py-space-sm ${c.className ?? ""}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Timeline({ steps }: { steps: { label: string; done: boolean; detail?: string }[] }) {
  return (
    <ol className="flex flex-col gap-space-md">
      {steps.map((s) => (
        <li key={s.label} className="flex items-start gap-space-sm">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${s.done ? "bg-secondary text-on-secondary" : "bg-surface-container text-text-secondary"}`}>
            <Icon name={s.done ? "check" : "radio_button_unchecked"} className="text-[16px]" />
          </span>
          <span className="flex flex-col"><span className="font-label-md text-label-md text-text-primary">{s.label}</span>
            {s.detail && <span className="font-caption text-caption text-text-secondary">{s.detail}</span>}</span>
        </li>
      ))}
    </ol>
  );
}

export function ProductTile({ p }: { p: { slug: string; title: string; vendorName: string; priceKobo: string; basePriceKobo?: string; ratingAvg: number; ratingCount: number; image: string | null; icon?: string } }) {
  return (
    <Link href={`/p/${p.slug}`} className="bg-surface-card rounded-xl p-space-md shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between group">
      <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-surface-container-low mb-space-sm flex items-center justify-center">
        {p.image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.image} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          : <ProductPhoto title={p.title} icon={p.icon} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />}
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-caption text-caption text-text-secondary">{p.vendorName}</span>
        <span className="font-label-md text-label-md text-text-primary font-semibold line-clamp-2 group-hover:text-secondary">{p.title}</span>
        <StarRating value={p.ratingAvg} count={p.ratingCount} />
        <PriceBlock kobo={p.priceKobo} was={p.basePriceKobo} />
      </div>
    </Link>
  );
}

/** Group of items from one vendor (cart, checkout summary, order detail). */
export function VendorGroup({ name, subtotalKobo, children, footer }: { name: string; subtotalKobo?: KoboLike; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="bg-surface-card rounded-xl shadow-sm overflow-hidden">
      <header className="flex items-center justify-between px-space-md py-space-sm bg-surface-container-low border-b border-border-subtle">
        <span className="flex items-center gap-space-xs font-label-md text-label-md text-text-primary"><Icon name="storefront" className="text-[18px] text-secondary" />Sold by {name}</span>
        {subtotalKobo !== undefined && <span className="font-label-sm text-label-sm text-text-secondary">Subtotal {formatKobo(subtotalKobo)}</span>}
      </header>
      <div className="divide-y divide-border-subtle px-space-md">{children}</div>
      {footer && <footer className="px-space-md py-space-sm border-t border-border-subtle">{footer}</footer>}
    </section>
  );
}

export function Notice({ live }: { live: boolean }) {
  if (live) return null;
  return (
    <div role="status" className="bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-label-sm px-space-md py-space-xs text-center">
      {USE_FIXTURES ? "Showing sample data: the Oja Market API is not reachable." : "Could not load this from the Oja Market API. Try again in a moment; if it keeps happening, the service may be down."}
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-space-md mb-space-md">
      <div><h1 className="font-display text-display-mobile md:text-display text-text-primary">{title}</h1>
        {sub && <p className="font-body-sm text-body-sm text-text-secondary mt-1">{sub}</p>}</div>
      {actions}
    </div>
  );
}

export const btn = {
  primary: "inline-flex items-center justify-center gap-space-xs px-space-md py-2 rounded-full bg-secondary text-on-secondary font-label-md text-label-md hover:opacity-90 transition-opacity disabled:opacity-50",
  ghost: "inline-flex items-center justify-center gap-space-xs px-space-md py-2 rounded-full bg-surface-container text-primary font-label-md text-label-md hover:bg-surface-container-high transition-colors disabled:opacity-50",
  danger: "inline-flex items-center justify-center gap-space-xs px-space-md py-2 rounded-full bg-status-danger text-on-error font-label-md text-label-md hover:opacity-90 disabled:opacity-50",
};
export const inputCls = "w-full rounded-lg border border-border-muted bg-surface-card px-space-sm py-2 font-body-sm text-body-sm text-text-primary outline-none focus:border-secondary focus:ring-1 focus:ring-secondary";

/** Picture chosen by product title (public/img/<key>.webp); icon until the file exists. */
export function ProductPhoto({ title, icon, className }: { title: string; icon?: string; className?: string }) {
  const key = productImageKey(title);
  const fb = <Icon name={icon ?? "inventory_2"} className="text-[64px] text-primary-container/40" />;
  return key ? <Img name={key} alt={title} className={className} fallback={fb} /> : fb;
}
