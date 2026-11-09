"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useCart } from "@/lib/cart";
import { formatKobo, mulKobo } from "@/lib/money";
import type { CartLine } from "@/lib/types";
import { ConfirmDialog, QtyStepper } from "./interactive";
import { btn, Icon, PageTitle, VendorGroup } from "./ui";

export function groupByVendor(lines: CartLine[]) {
  const m = new Map<string, { vendorId: string; vendorName: string; lines: CartLine[]; subtotal: bigint }>();
  for (const l of lines) {
    const g = m.get(l.vendorId) ?? { vendorId: l.vendorId, vendorName: l.vendorName, lines: [], subtotal: 0n };
    g.lines.push(l); g.subtotal += mulKobo(l.priceKobo, l.qty); m.set(l.vendorId, g);
  }
  return [...m.values()];
}

export function CartView() {
  const { lines, ready, count, totalKobo, setQty, remove } = useCart();
  const [pending, setPending] = useState<CartLine | null>(null);
  const groups = useMemo(() => groupByVendor(lines), [lines]);
  if (!ready) return <p className="text-text-secondary" role="status">Loading your cart...</p>;
  if (!lines.length) {
    return (
      <div className="bg-surface-card rounded-xl p-space-xl text-center flex flex-col items-center gap-space-sm">
        <Icon name="shopping_cart" className="text-[48px] text-text-secondary" />
        <h1 className="font-headline-md text-headline-md">Your cart is empty</h1>
        <Link href="/search" className={btn.primary}>Browse products</Link>
      </div>
    );
  }
  return (
    <>
      <PageTitle title="Shopping cart" sub={`${count} item${count === 1 ? "" : "s"} from ${groups.length} vendor${groups.length === 1 ? "" : "s"}`} />
      <div className="grid lg:grid-cols-[1fr_340px] gap-space-lg items-start">
        <div className="flex flex-col gap-space-md">
          {groups.map((g) => (
            <VendorGroup key={g.vendorId} name={g.vendorName} subtotalKobo={g.subtotal}>
              {g.lines.map((l) => (
                <div key={l.variantId} className="py-space-md flex flex-col sm:flex-row gap-space-md sm:items-center justify-between">
                  <div className="flex gap-space-md items-center">
                    <div className="w-16 h-16 rounded-lg bg-surface-container-low flex items-center justify-center shrink-0"><Icon name="inventory_2" className="text-[32px] text-primary-container/40" /></div>
                    <div className="flex flex-col"><Link href={`/p/${l.slug}`} className="font-label-md text-label-md text-text-primary font-semibold hover:text-secondary">{l.title}</Link>
                      <span className="font-caption text-caption text-text-secondary">{formatKobo(l.priceKobo)} each</span></div>
                  </div>
                  <div className="flex items-center gap-space-md">
                    <QtyStepper value={l.qty} onChange={(n) => (n <= 0 ? setPending(l) : setQty(l.variantId, n))} max={l.available ?? 99} label={l.title} />
                    <span className="font-title-sm text-title-sm font-bold w-24 text-right">{formatKobo(mulKobo(l.priceKobo, l.qty))}</span>
                    <button type="button" onClick={() => setPending(l)} aria-label={`Remove ${l.title}`} className="text-text-secondary hover:text-status-danger"><Icon name="delete" className="text-[20px]" /></button>
                  </div>
                </div>
              ))}
            </VendorGroup>
          ))}
        </div>
        <aside className="bg-surface-card rounded-xl p-space-md shadow-sm flex flex-col gap-space-sm sticky top-32">
          <h2 className="font-title-sm text-title-sm">Order summary</h2>
          {groups.map((g) => <div key={g.vendorId} className="flex justify-between font-body-sm text-body-sm"><span className="text-text-secondary">{g.vendorName}</span><span>{formatKobo(g.subtotal)}</span></div>)}
          <div className="flex justify-between border-t border-border-subtle pt-space-sm font-title-sm text-title-sm"><span>Total</span><span>{formatKobo(totalKobo)}</span></div>
          <p className="font-caption text-caption text-text-secondary">Final prices are recomputed by the server at checkout.</p>
          <Link href="/checkout" className={btn.primary}>Proceed to checkout</Link>
        </aside>
      </div>
      <ConfirmDialog open={!!pending} danger title="Remove item?" confirmLabel="Remove" body={pending ? `Remove "${pending.title}" from your cart?` : ""}
        onCancel={() => setPending(null)} onConfirm={() => { if (pending) remove(pending.variantId); setPending(null); }} />
    </>
  );
}
