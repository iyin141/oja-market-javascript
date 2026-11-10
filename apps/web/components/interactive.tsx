"use client";
import { useState, type ReactNode } from "react";
import { addToCart } from "@/lib/cart";
import { btn, Icon, PriceBlock } from "./ui";
import type { ProductDetail } from "@/lib/types";
import { ConfirmModal } from "./Modal";

export function QtyStepper({ value, onChange, max = 99, label }: { value: number; onChange: (n: number) => void; max?: number; label: string }) {
  const cls = "w-8 h-8 rounded-full bg-surface-card hover:bg-surface-container-high text-text-primary flex items-center justify-center transition-colors shadow-sm active:scale-95 disabled:opacity-40";
  return (
    <div className="inline-flex items-center gap-space-xs bg-surface-container rounded-full p-1" role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" className={cls} onClick={() => onChange(value - 1)} aria-label="Decrease quantity"><Icon name="remove" className="text-[16px]" /></button>
      <span className="w-10 text-center font-label-md text-label-md text-text-primary font-bold" aria-live="polite">{value}</span>
      <button type="button" className={cls} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="Increase quantity"><Icon name="add" className="text-[16px]" /></button>
    </div>
  );
}

export function Tabs({ tabs }: { tabs: { id: string; label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0].id);
  return (
    <div>
      <div role="tablist" className="flex gap-space-md border-b border-border-subtle overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={active === t.id} aria-controls={`panel-${t.id}`}
            onClick={() => setActive(t.id)}
            className={`px-space-xs py-space-sm font-label-md text-label-md whitespace-nowrap border-b-2 -mb-px transition-colors ${active === t.id ? "border-secondary text-secondary" : "border-transparent text-text-secondary hover:text-text-primary"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} className="pt-space-md">{t.content}</div>
      ))}
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return <ConfirmModal open={open} title={title} message={body} confirmLabel={confirmLabel} tone={danger ? "danger" : "primary"} onConfirm={onConfirm} onCancel={onCancel} />;
}

/** Variant picker, quantity and add-to-cart. Stock comes from the API (`available`). */
export function BuyBox({ product }: { product: ProductDetail }) {
  const [vid, setVid] = useState(product.variants[0]?.id);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const v = product.variants.find((x) => x.id === vid) ?? product.variants[0];
  if (!v) return <p className="text-text-secondary">This product has no purchasable variants yet.</p>;
  const soldOut = v.available <= 0;
  const add = () => {
    addToCart({ variantId: v.id, slug: product.slug, title: `${product.title}${product.variants.length > 1 ? ` (${v.name})` : ""}`, vendorId: product.vendor.id, vendorName: product.vendor.storeName, priceKobo: v.effectivePriceKobo, qty, available: v.available });
    setAdded(true); setTimeout(() => setAdded(false), 2000);
  };
  return (
    <div className="bg-surface-card rounded-xl p-space-md shadow-sm flex flex-col gap-space-md">
      <PriceBlock kobo={v.effectivePriceKobo} was={v.priceKobo} size="lg" />
      {product.variants.length > 1 && (
        <fieldset className="flex flex-wrap gap-space-xs"><legend className="font-label-sm text-label-sm text-text-secondary mb-1">Option</legend>
          {product.variants.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === v.id} onClick={() => { setVid(x.id); setQty(1); }}
              className={`px-space-sm py-1 rounded-full border font-label-md text-label-md ${x.id === v.id ? "border-secondary bg-secondary/10 text-secondary" : "border-border-muted text-text-primary"}`}>{x.name}</button>
          ))}
        </fieldset>
      )}
      <p className={`font-label-md text-label-md ${soldOut ? "text-status-danger" : v.available <= 5 ? "text-status-warning" : "text-status-success"}`}>
        {soldOut ? "Out of stock" : v.available <= 5 ? `Only ${v.available} left` : "In stock"}
      </p>
      <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, n))} max={Math.max(1, v.available)} label={product.title} />
      <button type="button" className={btn.primary} disabled={soldOut} onClick={add}><Icon name="add_shopping_cart" className="text-[20px]" />{added ? "Added to cart" : "Add to cart"}</button>
      <p className="flex items-center gap-space-xs font-caption text-caption text-text-secondary"><Icon name="lock" className="text-[16px] text-secondary" />Escrow buyer protection. Sold by {product.vendor.storeName}.</p>
    </div>
  );
}
