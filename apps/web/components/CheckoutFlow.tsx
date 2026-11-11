"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiStrict } from "@/lib/api";
import { clearCart, useCart } from "@/lib/cart";
import { formatKobo, mulKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import { groupByVendor } from "./CartView";
import { btn, Icon, inputCls, PageTitle, VendorGroup } from "./ui";

const STEPS = ["Address", "Payment", "Review"] as const;
const COD_LIMIT_KOBO = 15_000_000n;

export function CheckoutFlow() {
  const router = useRouter();
  const { lines, ready, totalKobo } = useCart();
  const [step, setStep] = useState(0);
  const [addr, setAddr] = useState({ line1: "", city: "", state: "", phone: "" });
  const [method, setMethod] = useState<"CARD" | "COD">("CARD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idem = useRef<string>(crypto.randomUUID()); // reused on retry so a double click never makes two orders
  const groups = groupByVendor(lines);
  const addrOk = addr.line1.length >= 3 && addr.city.length >= 2 && addr.state.length >= 2 && addr.phone.length >= 7;
  const codOk = totalKobo <= COD_LIMIT_KOBO;

  if (!ready) return <p role="status" className="text-text-secondary">Loading...</p>;
  if (!lines.length) return <div className="bg-surface-card rounded-xl p-space-xl text-center"><p className="mb-space-sm">Your cart is empty.</p><Link href="/search" className={btn.primary}>Browse products</Link></div>;

  async function place() {
    setError("");
    const token = getToken();
    if (!token) { router.push("/login?next=/checkout"); return; }
    setBusy(true);
    try {
      await apiStrict("/cart", { method: "PUT", token, body: JSON.stringify({ items: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) }) });
      const r = await apiStrict<{ orderId: string; authorizationUrl?: string }>("/checkout", {
        method: "POST", token, headers: { "Idempotency-Key": idem.current }, body: JSON.stringify({ paymentMethod: method, address: addr }),
      });
      clearCart();
      if (r.authorizationUrl) window.location.href = r.authorizationUrl;
      else router.push(`/orders/${r.orderId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle title="Checkout" />
      <ol className="flex items-center gap-space-md mb-space-lg" aria-label="Checkout steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={`flex items-center gap-space-xs font-label-md text-label-md ${i <= step ? "text-secondary" : "text-text-secondary"}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] ${i < step ? "bg-secondary text-on-secondary" : i === step ? "border-2 border-secondary" : "border border-border-muted"}`}>{i < step ? <Icon name="check" className="text-[14px]" /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-space-lg items-start [&>*]:min-w-0">
        <div className="bg-surface-card rounded-xl p-space-md shadow-sm">
          {step === 0 && (
            <form className="grid grid-cols-1 sm:grid-cols-2 gap-space-md [&>*]:min-w-0" onSubmit={(e) => { e.preventDefault(); if (addrOk) setStep(1); }}>
              <h2 className="font-title-sm text-title-sm sm:col-span-2">Delivery address</h2>
              <label className="sm:col-span-2 flex flex-col gap-1 font-label-sm text-label-sm">Street address<input className={inputCls} value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} autoComplete="address-line1" required /></label>
              <label className="flex flex-col gap-1 font-label-sm text-label-sm">City<input className={inputCls} value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} autoComplete="address-level2" required /></label>
              <label className="flex flex-col gap-1 font-label-sm text-label-sm">State<input className={inputCls} value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} autoComplete="address-level1" required /></label>
              <label className="sm:col-span-2 flex flex-col gap-1 font-label-sm text-label-sm">Phone<input className={inputCls} type="tel" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} autoComplete="tel" required /></label>
              <div className="sm:col-span-2 flex justify-end"><button className={btn.primary} disabled={!addrOk}>Continue to payment</button></div>
            </form>
          )}
          {step === 1 && (
            <div className="flex flex-col gap-space-md">
              <h2 className="font-title-sm text-title-sm">Payment method</h2>
              {([["CARD", "Pay now (card / bank transfer)", "credit_card"], ["COD", "Pay on delivery", "payments"]] as const).map(([m, label, icon]) => {
                const disabled = m === "COD" && !codOk;
                return (
                  <label key={m} className={`flex items-center gap-space-sm rounded-lg border p-space-md ${method === m ? "border-secondary bg-secondary/5" : "border-border-muted"} ${disabled ? "opacity-50" : "cursor-pointer"}`}>
                    <input type="radio" name="pm" checked={method === m} disabled={disabled} onChange={() => setMethod(m)} />
                    <Icon name={icon} className="text-secondary" /><span className="font-label-md text-label-md">{label}</span>
                    {disabled && <span className="font-caption text-caption text-status-danger ml-auto">Orders over {formatKobo(COD_LIMIT_KOBO)} cannot be cash on delivery</span>}
                  </label>
                );
              })}
              <div className="flex justify-between"><button className={btn.ghost} onClick={() => setStep(0)}>Back</button><button className={btn.primary} onClick={() => setStep(2)}>Review order</button></div>
            </div>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-space-md">
              <h2 className="font-title-sm text-title-sm">Review and place order</h2>
              <p className="font-body-sm text-body-sm text-text-secondary">Deliver to {addr.line1}, {addr.city}, {addr.state}. Pay by {method === "CARD" ? "card" : "cash on delivery"}.</p>
              {groups.map((g) => (
                <VendorGroup key={g.vendorId} name={g.vendorName} subtotalKobo={g.subtotal}>
                  {g.lines.map((l) => <div key={l.variantId} className="py-space-sm flex justify-between font-body-sm text-body-sm"><span>{l.qty} x {l.title}</span><span>{formatKobo(mulKobo(l.priceKobo, l.qty))}</span></div>)}
                </VendorGroup>
              ))}
              {error && <p role="alert" className="text-status-danger font-label-md text-label-md">{error}</p>}
              <div className="flex justify-between"><button className={btn.ghost} onClick={() => setStep(1)} disabled={busy}>Back</button>
                <button className={btn.primary} onClick={place} disabled={busy}>{busy ? "Placing order..." : `Place order (${formatKobo(totalKobo)})`}</button></div>
            </div>
          )}
        </div>
        <aside className="bg-surface-card rounded-xl p-space-md shadow-sm flex flex-col gap-space-xs">
          <h2 className="font-title-sm text-title-sm">Summary</h2>
          {groups.map((g) => <div key={g.vendorId} className="flex justify-between font-body-sm text-body-sm"><span className="text-text-secondary">{g.vendorName}</span><span>{formatKobo(g.subtotal)}</span></div>)}
          <div className="flex justify-between border-t border-border-subtle pt-space-sm font-title-sm text-title-sm"><span>Total</span><span>{formatKobo(totalKobo)}</span></div>
        </aside>
      </div>
    </>
  );
}
